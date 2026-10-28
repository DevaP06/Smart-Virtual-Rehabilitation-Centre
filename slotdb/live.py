"""Live warehouse operations on the database: setup, stock, orders, putaway, work orders, alerts and the status the dashboard shows.

Rules this module keeps:
  * every change to stock is a row in the append-only stock_movements table, in the same transaction as the change to `stock`;
  * stock never goes negative and a pick face never holds more than its capacity;
  * a bin holds one SKU and a SKU has one pick face (unique constraints), and any change to the layout is re-checked by the
    independent validator (core/validate.py) before it is kept: if a rule would break, the transaction is refused.
Functions take a SQLAlchemy session and never commit: the caller (the API route, a script) owns the transaction.
"""
import math
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sqlalchemy import and_, case, delete, func, insert, select

from core.data import CATS
from core.engine import State, World, abc_classes, cooc, partners
from core.ingest import HANDLING, HAZARDS, Report
from core.live_setup import RESERVE, estimate_sizes
from core.putaway import feasible, recommend
from core.validate import validate as rule_check

from .models import (Alert, Assignment, Bin, IdempotencyKey, JobRun, LiveMeta, OrderLine, ReorderRule, Sku, Stock, StockMovement, Task,
                     Warehouse)

MAX_QTY = 1_000_000


class LiveError(Exception):
    status = 400

    def __init__(self, message, data=None):
        super().__init__(message)
        self.message, self.data = message, data


class NotFound(LiveError):
    status = 404


class Conflict(LiveError):
    status = 409


class Stale(Conflict):
    """A work order that no longer matches the warehouse. It is closed (status 'stale'); the caller commits that, not the rest."""


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def get_wh(db, wid=None):
    wh = db.get(Warehouse, wid) if wid else db.scalar(select(Warehouse).order_by(Warehouse.id.desc()).limit(1))
    if wh is None:
        raise NotFound("No warehouse is set up yet. Open Setup and import one, or run scripts/seed_live.py for the demo warehouse.")
    return wh


def live_cfg(wh):
    return wh.config.get("live", {})


def warehouses(db):
    n_bins = dict(db.execute(select(Bin.warehouse_id, func.count()).group_by(Bin.warehouse_id)).all())
    n_skus = dict(db.execute(select(Sku.warehouse_id, func.count()).group_by(Sku.warehouse_id)).all())
    return [dict(id=w.id, name=w.name, source=w.source, created_at=iso(w.created_at), bins=n_bins.get(w.id, 0), skus=n_skus.get(w.id, 0))
            for w in db.scalars(select(Warehouse).order_by(Warehouse.id.desc()))]


# ------------------------------------------------------------------------------------------------------ engine view

_BIN_COLS = [("Location_ID", "loc_id"), ("Zone", "zone"), ("Aisle_Number", "aisle"), ("Side", "side"), ("Rack_ID", "rack_id"),
             ("Bay", "bay"), ("Shelf_Level", "level"), ("Bin", "bin_no"), ("X", "x"), ("Y", "y"), ("Z", "z"), ("AisleX", "aisle_x"),
             ("Bin_Width", "bin_w"), ("Bin_Height", "bin_h"), ("Bin_Depth", "bin_d"), ("Volumetric_Capacity", "vol_cap"),
             ("Max_Weight_Capacity", "max_weight"), ("Distance_to_Dispatch_Depot", "dist_depot"), ("Beam_ID", "beam_id"),
             ("Beam_Cap", "beam_cap"), ("Frame_Cap", "frame_cap")]
_SKU_COLS = [("SKU_ID", "sku_id"), ("Width", "width"), ("Height", "height"), ("Depth", "depth"), ("Weight", "weight"),
             ("Category", "category"), ("Hazard_Class", "hazard"), ("Handling_Type", "handling"), ("Cases", "cases"),
             ("Units_per_Case", "units_per_case"), ("Name", "name"), ("Estimated", "dims_estimated")]


def bins_frame(db, wid):
    rows = db.execute(select(*[getattr(Bin, a) for _, a in _BIN_COLS]).where(Bin.warehouse_id == wid).order_by(Bin.id)).all()
    return pd.DataFrame([tuple(r) for r in rows], columns=[n for n, _ in _BIN_COLS])


def skus_frame(db, wid):
    rows = db.execute(select(*[getattr(Sku, a) for _, a in _SKU_COLS]).where(Sku.warehouse_id == wid).order_by(Sku.id)).all()
    return pd.DataFrame([tuple(r) for r in rows], columns=[n for n, _ in _SKU_COLS])


def assignment_frame(db, wid):
    rows = db.execute(select(Assignment.sku_id, Assignment.loc_id).where(Assignment.warehouse_id == wid)).all()
    return pd.DataFrame([tuple(r) for r in rows], columns=["SKU_ID", "Location_ID"])


class Ctx:
    """The warehouse as the engine sees it right now: rule mask + occupancy (State) for the stored assignment."""

    def __init__(self, wh, skus, locs, asg, w, st):
        self.wh, self.skus, self.locs, self.asg, self.w, self.st, self.c = wh, skus, locs, asg, w, st, wh.config


def load_ctx(db, wh, extra_sku=None):
    """Build the engine's World and State from the database. `extra_sku` (a dict of Sku column values) adds a SKU that is not stored
    yet, so a new product can be scored before it is saved."""
    locs, skus, asg = bins_frame(db, wh.id), skus_frame(db, wh.id), assignment_frame(db, wh.id)
    if extra_sku is not None:
        row = {n: extra_sku[a] for n, a in _SKU_COLS}
        skus = pd.concat([skus, pd.DataFrame([row])], ignore_index=True)
    if locs.empty or skus.empty:
        raise Conflict("This warehouse has no bins or no products yet.")
    w = World(skus, locs, wh.config)
    st = State(w)
    for s, loc in zip(asg.SKU_ID, asg.Location_ID):
        if s in w.S.index and loc in w.loc_ix:
            st.place(w.loc_ix[loc], s)
    return Ctx(wh, skus, locs, asg, w, st)


def assert_rules(db, wh):
    """The independent validator over the whole stored layout. Called after every layout change: fail closed."""
    locs, skus, asg = bins_frame(db, wh.id), skus_frame(db, wh.id), assignment_frame(db, wh.id)
    v = rule_check(asg, skus[skus.SKU_ID.isin(asg.SKU_ID)], locs, wh.config)
    v.pop("unplaced_skus", None)
    broken = {k: n for k, n in v.items() if k != "total" and n}
    if broken:
        raise Conflict("That change would break a rule (" + ", ".join(f"{k}: {n}" for k, n in broken.items()) + "), so it was not applied.", broken)


# ------------------------------------------------------------------------------------------------------ demand

def _as_of(db, wid):
    return db.scalar(select(func.max(OrderLine.ts)).where(OrderLine.warehouse_id == wid))


def demand_window(db, wh, days=None):
    """(pick lines per SKU over the last `days` days of order history, as_of). Anchored on the newest order, so an idle warehouse
    still has a demand picture."""
    days = days or live_cfg(wh).get("demand_days", 56)
    as_of = _as_of(db, wh.id)
    if as_of is None:
        return pd.Series(dtype=float), None
    rows = db.execute(select(OrderLine.sku_id, func.count()).where(OrderLine.warehouse_id == wh.id, OrderLine.ts > as_of - timedelta(days=days))
                      .group_by(OrderLine.sku_id)).all()
    return pd.Series({s: float(n) for s, n in rows}, dtype=float), as_of


def unit_rates(db, wh, days=28):
    """Units sold per day, by SKU, over the last `days` days of order history."""
    as_of = _as_of(db, wh.id)
    if as_of is None:
        return {}
    rows = db.execute(select(OrderLine.sku_id, func.sum(OrderLine.qty)).where(OrderLine.warehouse_id == wh.id, OrderLine.ts > as_of - timedelta(days=days))
                      .group_by(OrderLine.sku_id)).all()
    return {s: float(n) / days for s, n in rows}


def weekly_prediction(db, wh, weeks=8, decay=0.6):
    """Predicted pick lines next week per SKU: recency-weighted average of the last `weeks` weekly counts (newest week weighs most).
    Returns (dict, n_weeks_used). The dashboard's Forecast page shows the offline LightGBM study of the same question."""
    as_of = _as_of(db, wh.id)
    if as_of is None:
        return {}, 0
    first = db.scalar(select(func.min(OrderLine.ts)).where(OrderLine.warehouse_id == wh.id))
    n = max(1, min(weeks, math.ceil((as_of - first).total_seconds() / (7 * 86400))))
    buckets = [func.sum(case((and_(OrderLine.ts > as_of - timedelta(days=7 * (k + 1)), OrderLine.ts <= as_of - timedelta(days=7 * k)), 1), else_=0))
               for k in range(n)]
    rows = db.execute(select(OrderLine.sku_id, *buckets).where(OrderLine.warehouse_id == wh.id, OrderLine.ts > as_of - timedelta(days=7 * n))
                      .group_by(OrderLine.sku_id)).all()
    wts = np.array([decay ** k for k in range(n)])
    wts = wts / wts.sum()
    return {r[0]: float(np.dot(wts, [x or 0 for x in r[1:]])) for r in rows}, n


def refresh_partners(db, wh):
    """Bought-together table from recent orders, cached in live_meta (refreshed by setup and by the nightly job)."""
    days = live_cfg(wh).get("demand_days", 56)
    as_of = _as_of(db, wh.id)
    part = {}
    if as_of is not None:
        rows = db.execute(select(OrderLine.order_id, OrderLine.sku_id).where(OrderLine.warehouse_id == wh.id, OrderLine.ts > as_of - timedelta(days=days))).all()
        df = pd.DataFrame([tuple(r) for r in rows], columns=["Order_ID", "SKU_ID"])
        part = partners(cooc(df, wh.config["max_basket"]), wh.config["topk"]) if len(df) else {}
    meta = db.scalar(select(LiveMeta).where(LiveMeta.warehouse_id == wh.id, LiveMeta.key == "partners"))
    payload = {k: [[p, int(n)] for p, n in v] for k, v in part.items()}
    if meta is None:
        db.add(LiveMeta(warehouse_id=wh.id, key="partners", value=payload))
    else:
        meta.value = payload
    return part


def get_partners(db, wh):
    meta = db.scalar(select(LiveMeta).where(LiveMeta.warehouse_id == wh.id, LiveMeta.key == "partners"))
    if meta is None or meta.value is None:
        return refresh_partners(db, wh)
    return {k: [(p, n) for p, n in v] for k, v in meta.value.items()}


def prior_velocity(skus, vel, category):
    """Demand to assume for a product with no history: median of its category's products that do sell, else of all that do, else 1."""
    sold = vel[vel > 0]
    if sold.empty:
        return 1.0
    same = sold[sold.index.isin(skus.loc[skus.Category == category, "SKU_ID"])]
    return float(same.median() if len(same) else sold.median())


# ------------------------------------------------------------------------------------------------------ setup / import

def import_warehouse(db, name, prepared, source="import", opening=None):
    """Create a warehouse from core.live_setup.prepare() output. `opening` (demo seed): list of (sku, location, qty); the location
    '@FACE' means the SKU's pick face. Starting stock from the user's stock file comes from prepared['tables']['stock']."""
    t = prepared["tables"]
    wh = Warehouse(name=str(name).strip()[:120] or "Warehouse", config=t["config"], source=source)
    db.add(wh)
    db.flush()
    wid = wh.id
    f = lambda v: float(v)
    db.execute(insert(Bin), [dict(
        warehouse_id=wid, loc_id=str(r.Location_ID), zone=str(r.Zone), aisle=int(r.Aisle_Number), side=int(r.Side), rack_id=str(r.Rack_ID),
        bay=int(r.Bay), level=int(r.Shelf_Level), bin_no=int(r.Bin), x=f(r.X), y=f(r.Y), z=f(r.Z), aisle_x=f(r.AisleX), bin_w=f(r.Bin_Width),
        bin_h=f(r.Bin_Height), bin_d=f(r.Bin_Depth), vol_cap=f(r.Volumetric_Capacity), max_weight=f(r.Max_Weight_Capacity),
        dist_depot=f(r.Distance_to_Dispatch_Depot), beam_id=str(r.Beam_ID), beam_cap=f(r.Beam_Cap), frame_cap=f(r.Frame_Cap))
        for r in t["locs"].itertuples(index=False)])
    db.execute(insert(Sku), [dict(
        warehouse_id=wid, sku_id=str(r.SKU_ID), name=(r.Name or None), width=f(r.Width), height=f(r.Height), depth=f(r.Depth), weight=f(r.Weight),
        category=str(r.Category), hazard=str(r.Hazard_Class), handling=str(r.Handling_Type), cases=int(r.Cases), units_per_case=int(r.Units_per_Case),
        dims_estimated=bool(r.Estimated), created_at=utcnow()) for r in t["skus"].itertuples(index=False)])
    asg = t["assignment"]
    db.execute(insert(Assignment), [dict(warehouse_id=wid, sku_id=str(s), loc_id=str(l), assigned_at=utcnow()) for s, l in zip(asg.SKU_ID, asg.Location_ID)])
    face = dict(zip(asg.SKU_ID, asg.Location_ID))

    rows = defaultdict(int)
    if t.get("stock") is not None:
        for s, l, q in zip(t["stock"].SKU_ID, t["stock"].Location_ID, t["stock"].Quantity):
            rows[(str(s), str(l))] += int(q)
    for s, l, q in (opening or []):
        rows[(str(s), face[str(s)] if l == "@FACE" else str(l))] += int(q)
    for s, fl in face.items():
        rows.setdefault((s, fl), 0)
    cap = {str(r.SKU_ID): int(r.Cases) * int(r.Units_per_Case) for r in t["skus"].itertuples(index=False)}
    over = [s for (s, l), q in rows.items() if l != RESERVE and q > cap[s]]
    if over:
        raise Conflict(f"Opening stock exceeds the pick-face capacity for {over[0]} (and {len(over) - 1} more).")
    now = utcnow()
    db.execute(insert(Stock), [dict(warehouse_id=wid, sku_id=s, location=l, qty=q, updated_at=now) for (s, l), q in rows.items()])
    db.execute(insert(StockMovement), [dict(warehouse_id=wid, ts=now, type="receive", sku_id=s, to_loc=l, qty=q, ref="setup", note="opening balance")
                                       for (s, l), q in rows.items() if q > 0])
    orders = t["orders"]
    if len(orders):
        db.execute(insert(OrderLine), [dict(warehouse_id=wid, order_id=str(o), sku_id=str(s), qty=int(q), ts=ts.to_pydatetime(), source="history")
                                       for o, s, q, ts in zip(orders.Order_ID, orders.SKU_ID, orders.Quantity, orders.Timestamp)])
    db.flush()
    refresh_partners(db, wh)
    return wh


# ------------------------------------------------------------------------------------------------------ stock book

def _check_qty(qty):
    if isinstance(qty, bool) or not isinstance(qty, int) or qty < 1 or qty > MAX_QTY:
        raise LiveError(f"Quantity must be a whole number from 1 to {MAX_QTY:,}.")
    return qty


class Book:
    """Stock rows for a set of SKUs, loaded once and row-locked (Postgres: SELECT ... FOR UPDATE, so two pickers cannot both take the last
    unit), so a batch of picks costs three queries instead of several per line. Every change adds its movement row."""

    def __init__(self, db, wh, sku_ids):
        self.db, self.wh = db, wh
        ids = sorted(set(sku_ids))
        self.skus = {s.sku_id: s for s in db.scalars(select(Sku).where(Sku.warehouse_id == wh.id, Sku.sku_id.in_(ids)))}
        self.face = {a.sku_id: a.loc_id for a in db.scalars(select(Assignment).where(Assignment.warehouse_id == wh.id, Assignment.sku_id.in_(ids)))}
        self.rows = {(r.sku_id, r.location): r for r in db.scalars(
            select(Stock).where(Stock.warehouse_id == wh.id, Stock.sku_id.in_(ids)).order_by(Stock.id).with_for_update())}

    def qty(self, sku, loc):
        r = self.rows.get((sku, loc))
        return r.qty if r else 0

    def cap(self, sku):
        s = self.skus[sku]
        return int(s.cases) * int(s.units_per_case)

    def _row(self, sku, loc):
        r = self.rows.get((sku, loc))
        if r is None:
            r = Stock(warehouse_id=self.wh.id, sku_id=sku, location=loc, qty=0)
            self.db.add(r)
            self.rows[(sku, loc)] = r
        return r

    def _guard_face(self, sku, loc, add):
        if loc != RESERVE:
            if self.face.get(sku) != loc:
                raise Conflict(f"{loc} is not the pick face of {sku}.")
            if self.qty(sku, loc) + add > self.cap(sku):
                raise Conflict(f"{loc} holds at most {self.cap(sku)} units of {sku}; it has {self.qty(sku, loc)}.")

    def _log(self, kind, sku, qty, frm, to, ref, note, lot=None, expiry=None, ts=None):
        self.db.add(StockMovement(warehouse_id=self.wh.id, ts=ts or utcnow(), type=kind, sku_id=sku, from_loc=frm, to_loc=to, qty=qty,
                                  ref=ref, note=note, lot=lot, expiry=expiry))

    def move(self, kind, sku, qty, frm=None, to=None, ref=None, note=None, lot=None, expiry=None, ts=None):
        """receive (to), pick (from) or move (from, to). The only way stock changes."""
        if sku not in self.skus:
            raise NotFound(f"Unknown SKU {sku}.")
        _check_qty(qty)
        if frm is not None:
            have = self.qty(sku, frm)
            if have < qty:
                raise Conflict(f"Only {have} units of {sku} at {frm}; {qty} were asked for.")
        if to is not None:
            self._guard_face(sku, to, qty)
        now = ts or utcnow()
        if frm is not None:
            r = self._row(sku, frm)
            r.qty -= qty
            r.updated_at = now
        if to is not None:
            r = self._row(sku, to)
            r.qty += qty
            r.updated_at = now
        self._log(kind, sku, qty, frm, to, ref, note, lot, expiry, now)

    def adjust(self, sku, loc, delta, note):
        """Cycle-count correction: +delta or -delta units at a location. A reason is required."""
        if sku not in self.skus:
            raise NotFound(f"Unknown SKU {sku}.")
        if isinstance(delta, bool) or not isinstance(delta, int) or delta == 0 or abs(delta) > MAX_QTY:
            raise LiveError("The correction must be a whole number other than zero.")
        if not note or not str(note).strip():
            raise LiveError("Say why the stock is being corrected (a reason is required).")
        if delta < 0:
            have = self.qty(sku, loc)
            if have + delta < 0:
                raise Conflict(f"Only {have} units of {sku} at {loc}; stock cannot go below zero.")
            self.move_adjust(sku, loc, delta, note)
        else:
            self._guard_face(sku, loc, delta)
            self.move_adjust(sku, loc, delta, note)

    def move_adjust(self, sku, loc, delta, note):
        r = self._row(sku, loc)
        r.qty += delta
        r.updated_at = utcnow()
        self._log("adjust", sku, abs(delta), loc if delta < 0 else None, loc if delta > 0 else None, "adjust", str(note).strip()[:240])


# ------------------------------------------------------------------------------------------------------ alerts, replenishment

def _raise(db, wh, open_alerts, kind, key, severity, message):
    a = open_alerts.get(key)
    if a is None:
        a = Alert(warehouse_id=wh.id, kind=kind, key=key, severity=severity, message=message[:300])
        db.add(a)
        open_alerts[key] = a
    else:
        a.message, a.severity = message[:300], severity


def _resolve(open_alerts, key):
    a = open_alerts.pop(key, None)
    if a is not None:
        a.resolved_at = utcnow()


def open_alert_map(db, wh, keys=None):
    q = select(Alert).where(Alert.warehouse_id == wh.id, Alert.resolved_at.is_(None))
    if keys is not None:
        q = q.where(Alert.key.in_(sorted(keys)))
    return {a.key: a for a in db.scalars(q)}


def reorder_point(wh, rules, rates, sku):
    r = rules.get(sku)
    if r is not None:
        return int(r.reorder_point)
    lv = live_cfg(wh)
    return int(math.ceil(rates.get(sku, 0.0) * (lv.get("lead_days", 7) + lv.get("safety_days", 2))))


def review(db, wh, book, skus, rates=None):
    """After stock changes: raise a replenishment task when a pick face runs low and the reserve can refill it, raise or clear stock
    alerts (stockout, reorder point), and nothing else. Idempotent: running it twice creates nothing new."""
    skus = sorted(set(skus))
    if not skus:
        return
    lv = live_cfg(wh)
    rates = rates if rates is not None else unit_rates(db, wh)
    rules = {r.sku_id: r for r in db.scalars(select(ReorderRule).where(ReorderRule.warehouse_id == wh.id, ReorderRule.sku_id.in_(skus)))}
    open_rep = {t.sku_id for t in db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.type == "replenish", Task.status == "open",
                                                               Task.sku_id.in_(skus)))}
    alerts = open_alert_map(db, wh, [f"{k}:{s}" for s in skus for k in ("stockout", "reorder")])
    for s in skus:
        face = book.face.get(s)
        if face is None:
            continue
        cap, fq, rq = book.cap(s), book.qty(s, face), book.qty(s, RESERVE)
        trigger = max(1, math.ceil(cap * lv.get("replen_frac", 0.3)))
        if fq <= trigger and fq < cap and rq > 0 and s not in open_rep:        # a full face never needs a refill, whatever the threshold
            db.add(Task(warehouse_id=wh.id, type="replenish", sku_id=s, from_loc=RESERVE, to_loc=face, qty=min(cap - fq, rq),
                        reason=f"Pick face is down to {fq} of {cap} units; {rq} in reserve"))
            open_rep.add(s)
        total, rp = fq + rq, reorder_point(wh, rules, rates, s)
        if total <= 0:
            _raise(db, wh, alerts, "stockout", f"stockout:{s}", "high", f"{s} is out of stock. Nothing left in the pick face or reserve.")
            _resolve(alerts, f"reorder:{s}")
        elif total <= rp:
            _raise(db, wh, alerts, "reorder", f"reorder:{s}", "warn", f"{s}: {total} units left, at or below the reorder point of {rp}. Order from the supplier.")
            _resolve(alerts, f"stockout:{s}")
        else:
            _resolve(alerts, f"reorder:{s}")
            _resolve(alerts, f"stockout:{s}")


# ------------------------------------------------------------------------------------------------------ orders (sales)

def pick_orders(db, wh, orders, allow_partial=False, source="live", ts=None):
    """Apply customer orders: units come from the SKU's pick face first, then from reserve. `orders` is a list of
    dict(order_id, lines=[(sku, qty)]). Without allow_partial an order that cannot be fully served is refused (nothing changes);
    with it the available units are picked and the shortfall is reported. Each accepted line is demand history."""
    all_skus = {s for o in orders for s, _ in o["lines"]}
    book = Book(db, wh, all_skus)
    unknown = sorted(all_skus - set(book.skus))
    if unknown:
        raise NotFound("Unknown SKU: " + ", ".join(unknown[:8]) + ("…" if len(unknown) > 8 else ""))
    unplaced = sorted(s for s in all_skus if s not in book.face)
    if unplaced:
        raise Conflict("No pick face yet for: " + ", ".join(unplaced[:8]) + ". Receive the product first.")
    now = ts or utcnow()
    out, touched = [], set()
    for o in orders:
        merged = defaultdict(int)
        for s, q in o["lines"]:
            merged[str(s)] += _check_qty(q)
        oid = str(o.get("order_id") or f"L{uuid.uuid4().hex[:10].upper()}")[:60]
        short = []
        for s, q in merged.items():
            have = book.qty(s, book.face[s]) + book.qty(s, RESERVE)
            if have < q:
                short.append(dict(sku=s, wanted=q, available=have))
        if short and not allow_partial:
            raise Conflict("Not enough stock: " + "; ".join(f"{x['sku']} wanted {x['wanted']}, have {x['available']}" for x in short[:6]), short)
        picked = []
        for s, q in sorted(merged.items()):
            face = book.face[s]
            take = min(q, book.qty(s, face) + book.qty(s, RESERVE))
            from_face = min(take, book.qty(s, face))
            if from_face:
                book.move("pick", s, from_face, frm=face, ref=oid, ts=now)
            if take - from_face:
                book.move("pick", s, take - from_face, frm=RESERVE, ref=oid, note="pick face was short: taken from reserve", ts=now)
            db.add(OrderLine(warehouse_id=wh.id, order_id=oid, sku_id=s, qty=q, ts=now, source=source))
            picked.append(dict(sku=s, wanted=q, picked=take, from_reserve=take - from_face))
            touched.add(s)
        out.append(dict(order_id=oid, lines=picked, short=short))
    review(db, wh, book, touched)
    return out


def simulate_orders(db, wh, n=25, seed=None):
    """Demo traffic: n random orders drawn from recent demand and bought-together habits, applied exactly like real ones."""
    n = max(1, min(int(n), 100))
    asg = [a for a in db.scalars(select(Assignment.sku_id).where(Assignment.warehouse_id == wh.id))]
    if not asg:
        raise Conflict("There are no products placed in this warehouse yet.")
    vel, _ = demand_window(db, wh)
    names = sorted(asg)
    wts = np.array([float(vel.get(s, 0.0)) + 0.25 for s in names])
    wts = wts / wts.sum()
    part = get_partners(db, wh)
    rng = np.random.default_rng(seed)
    placed = set(names)
    orders = []
    for _ in range(n):
        first = names[int(rng.choice(len(names), p=wts))]
        basket = {first}
        for p, _cnt in part.get(first, [])[:4]:
            if p in placed and rng.random() < 0.4:
                basket.add(p)
        for _ in range(int(rng.poisson(0.6))):
            basket.add(names[int(rng.choice(len(names), p=wts))])
        orders.append(dict(lines=[(s, int(rng.integers(1, 4))) for s in sorted(basket)]))
    res = pick_orders(db, wh, orders, allow_partial=True, source="live")
    return dict(orders=len(res), lines=sum(len(r["lines"]) for r in res), units=sum(x["picked"] for r in res for x in r["lines"]),
                short_lines=sum(len(r["short"]) for r in res))


def adjust_stock(db, wh, sku, location, delta, note):
    book = Book(db, wh, [sku])
    if sku not in book.skus:
        raise NotFound(f"Unknown SKU {sku}.")
    if location != RESERVE and location != book.face.get(sku):
        raise Conflict(f"{location} is not the pick face of {sku}. Use its pick face or RESERVE.")
    book.adjust(sku, location, delta, note)
    review(db, wh, book, [sku])
    return dict(sku=sku, location=location, qty=book.qty(sku, location))


# ------------------------------------------------------------------------------------------------------ receiving / putaway

def _new_sku_row(d):
    """Validate the master data typed into the receiving form and return the Sku column values. A missing size or weight is
    estimated from the category and flagged, never guessed silently."""
    def num(k):
        v = d.get(k)
        return None if v is None or str(v).strip() == "" else v
    sid = str(d.get("sku_id") or "").strip()
    if not sid:
        raise LiveError("Enter the SKU id.")
    row = dict(SKU_ID=sid, Width=num("width"), Height=num("height"), Depth=num("depth"), Weight=num("weight"),
               Category=str(d.get("category") or "").strip().lower())
    rep = Report()
    df, est = estimate_sizes(pd.DataFrame([row]), rep)
    if rep.errors:
        raise LiveError("Enter the size and weight, or a known category so they can be estimated (" + ", ".join(sorted(CATS)) + ").")
    out = {}
    for col, key in (("Width", "width"), ("Height", "height"), ("Depth", "depth"), ("Weight", "weight")):
        try:
            out[key] = float(df[col].iloc[0])
        except (TypeError, ValueError):
            raise LiveError(f"{key.title()} must be a number.")
        if not out[key] > 0:
            raise LiveError(f"{key.title()} must be greater than zero.")
    hazard = str(d.get("hazard") or "none").strip().lower()
    handling = str(d.get("handling") or "standard").strip().lower()
    if hazard not in HAZARDS:
        raise LiveError(f"Hazard class must be one of: {', '.join(sorted(HAZARDS))}.")
    if handling not in HANDLING:
        raise LiveError(f"Handling must be one of: {', '.join(sorted(HANDLING))}.")
    cases, upc = d.get("cases", 1), d.get("units_per_case", 1)
    if not (isinstance(cases, int) and not isinstance(cases, bool) and cases >= 1) or not (isinstance(upc, int) and not isinstance(upc, bool) and upc >= 1):
        raise LiveError("Cases per pick face and units per case must be whole numbers of at least 1.")
    return dict(sku_id=sid, name=(str(d.get("name") or "").strip()[:160] or None), category=str(df["Category"].iloc[0]) or "general", hazard=hazard,
                handling=handling, cases=cases, units_per_case=upc, dims_estimated=bool(est.iloc[0]), **out)


def _check_expiry(expiry):
    if not expiry:
        return None
    try:
        datetime.strptime(str(expiry), "%Y-%m-%d")
    except ValueError:
        raise LiveError("Expiry must be a date like 2026-12-31.")
    return str(expiry)


def receive_plan(db, wh, sku_id, qty, new_sku=None):
    """What would happen to a delivery of `qty` units of `sku_id`: top up its pick face (and send the rest to reserve), or, for a
    product with no pick face yet, the three best bins with the cost split behind the ranking. Changes nothing."""
    sku_id = str(sku_id or "").strip()
    _check_qty(qty)
    if not sku_id:
        raise LiveError("Enter the SKU id.")
    sku = db.scalar(select(Sku).where(Sku.warehouse_id == wh.id, Sku.sku_id == sku_id))
    if sku is None and not new_sku:
        return dict(mode="unknown_sku", sku=sku_id, message=f"{sku_id} is not in the product list. Enter its details to add it.")
    face = db.scalar(select(Assignment.loc_id).where(Assignment.warehouse_id == wh.id, Assignment.sku_id == sku_id))
    if sku is not None and face is not None:
        book = Book(db, wh, [sku_id])
        cap, fq = book.cap(sku_id), book.qty(sku_id, face)
        to_face = max(0, min(qty, cap - fq))
        return dict(mode="top_up", sku=sku_id, face=face, face_qty=fq, capacity=cap, to_face=to_face, to_reserve=qty - to_face, new_item=False)
    row = None
    if sku is None:
        row = _new_sku_row({**new_sku, "sku_id": sku_id})
        cap = row["cases"] * row["units_per_case"]
        cat, estimated = row["category"], row["dims_estimated"]
    else:
        cap, cat, estimated = sku.cases * sku.units_per_case, sku.category, sku.dims_estimated
    ctx = load_ctx(db, wh, extra_sku=dict(row, name=row["name"] or "") if row else None)
    vel, _ = demand_window(db, wh)
    n_lines = int(vel.get(sku_id, 0))
    pv = prior_velocity(ctx.skus, vel, cat) if n_lines < 5 else None
    options, reasons = recommend(ctx.w, ctx.st, ctx.c, vel if len(vel) else pd.Series({s: 1.0 for s in ctx.skus.SKU_ID}), get_partners(db, wh), sku_id, k=3,
                                 prior={sku_id: pv} if pv is not None else None)
    to_face = min(qty, cap)
    return dict(mode="new_face", sku=sku_id, new_item=pv is not None, assumed_velocity=pv, estimated_dims=bool(estimated), capacity=cap,
                to_face=to_face, to_reserve=qty - to_face, options=options, reasons=reasons, is_new_sku=sku is None)


def receive_confirm(db, wh, sku_id, qty, loc=None, new_sku=None, lot=None, expiry=None, ref=None):
    """Book a delivery. Existing pick face: units go to it up to its capacity, the rest to reserve. No pick face yet: `loc` (one of the
    recommended bins) becomes the pick face after the server re-checks the rules and the independent validator passes."""
    sku_id = str(sku_id or "").strip()
    _check_qty(qty)
    expiry = _check_expiry(expiry)
    lot = (str(lot).strip()[:40] or None) if lot else None
    sku = db.scalar(select(Sku).where(Sku.warehouse_id == wh.id, Sku.sku_id == sku_id))
    face = db.scalar(select(Assignment.loc_id).where(Assignment.warehouse_id == wh.id, Assignment.sku_id == sku_id)) if sku else None
    placed_now = False
    if face is None:
        if not loc:
            raise LiveError("Choose a bin for this product.")
        row = None
        if sku is None:
            if not new_sku:
                raise NotFound(f"{sku_id} is not in the product list. Enter its details to add it.")
            row = _new_sku_row({**new_sku, "sku_id": sku_id})
        ctx = load_ctx(db, wh, extra_sku=dict(row, name=row["name"] or "") if row else None)
        if not feasible(ctx.w, ctx.st, sku_id, loc):
            raise Conflict(f"{loc} is not available or would break a rule for {sku_id}. Ask for new recommendations.")
        if row is not None:
            db.add(Sku(warehouse_id=wh.id, **row))
        db.add(Assignment(warehouse_id=wh.id, sku_id=sku_id, loc_id=loc))
        db.add(Stock(warehouse_id=wh.id, sku_id=sku_id, location=loc, qty=0))
        db.flush()
        assert_rules(db, wh)
        face, placed_now = loc, True
    book = Book(db, wh, [sku_id])
    cap, fq = book.cap(sku_id), book.qty(sku_id, face)
    to_face = max(0, min(qty, cap - fq))
    ref = (str(ref).strip()[:60] if ref else None) or f"R{uuid.uuid4().hex[:8].upper()}"
    if to_face:
        book.move("receive", sku_id, to_face, to=face, ref=ref, lot=lot, expiry=expiry)
    if qty - to_face:
        book.move("receive", sku_id, qty - to_face, to=RESERVE, ref=ref, lot=lot, expiry=expiry, note="pick face full: to reserve")
    review(db, wh, book, [sku_id])
    return dict(sku=sku_id, face=face, to_face=to_face, to_reserve=qty - to_face, ref=ref, new_pick_face=placed_now)


# ------------------------------------------------------------------------------------------------------ work orders

def _task_dict(group):
    g = sorted(group, key=lambda t: t.id)
    t0 = g[0]
    if t0.type == "replenish":
        kind = "replenish"
    else:
        kind = "swap" if len(g) > 1 else "relocate"
    return dict(id=t0.id, ids=[t.id for t in g], type=t0.type, kind=kind, status=t0.status, saving=t0.saving, reason=t0.reason,
                created_at=iso(t0.created_at), done_at=iso(t0.done_at),
                items=[dict(sku=t.sku_id, from_loc=t.from_loc, to_loc=t.to_loc, qty=t.qty) for t in g])


def list_tasks(db, wh, status="open", limit=200):
    q = select(Task).where(Task.warehouse_id == wh.id)
    if status != "all":
        q = q.where(Task.status == status)
    rows = db.scalars(q.order_by(Task.id.desc()).limit(limit * 2)).all()
    groups, order = defaultdict(list), []
    for t in rows:
        k = ("g", t.group_id) if t.group_id else ("t", t.id)
        if k not in groups:
            order.append(k)
        groups[k].append(t)
    return [_task_dict(groups[k]) for k in order][:limit]


def _task_group(db, wh, task_id):
    t = db.scalar(select(Task).where(Task.warehouse_id == wh.id, Task.id == task_id))
    if t is None:
        raise NotFound(f"Work order {task_id} not found.")
    if t.group_id:
        return list(db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.group_id == t.group_id).order_by(Task.id)))
    return [t]


def _mark(tasks, status):
    now = utcnow()
    for t in tasks:
        t.status = status
        t.done_at = now if status == "done" else t.done_at


def reject_task(db, wh, task_id):
    tasks = _task_group(db, wh, task_id)
    if any(t.status != "open" for t in tasks):
        raise Conflict("This work order is not open any more.")
    _mark(tasks, "rejected")
    return _task_dict(tasks)


def complete_task(db, wh, task_id):
    """The floor did the work: apply it to stock (replenish) or to the layout (move/swap), keep the audit trail, re-check the rules."""
    tasks = _task_group(db, wh, task_id)
    if any(t.status != "open" for t in tasks):
        raise Conflict("This work order is not open any more.")
    if tasks[0].type == "replenish":
        t = tasks[0]
        book = Book(db, wh, [t.sku_id])
        face = book.face.get(t.sku_id)
        if face != t.to_loc:
            _mark(tasks, "stale")
            raise Stale(f"{t.sku_id} has moved to {face}; this replenishment is out of date and was closed.")
        q = min(t.qty, book.qty(t.sku_id, RESERVE), book.cap(t.sku_id) - book.qty(t.sku_id, face))
        if q <= 0:
            _mark(tasks, "stale")
            raise Stale("There is nothing left to move (reserve is empty or the pick face is already full). The work order was closed.")
        book.move("move", t.sku_id, q, frm=RESERVE, to=face, ref=f"task:{t.id}", note="replenishment")
        t.qty = q
        _mark(tasks, "done")
        review(db, wh, book, [t.sku_id])
        return _task_dict(tasks)
    _relocate(db, wh, tasks)
    return _task_dict(tasks)


def _relocate(db, wh, tasks):
    skus = [t.sku_id for t in tasks]
    asg = {a.sku_id: a for a in db.scalars(select(Assignment).where(Assignment.warehouse_id == wh.id, Assignment.sku_id.in_(skus)))}
    for t in tasks:
        if asg.get(t.sku_id) is None or asg[t.sku_id].loc_id != t.from_loc:
            _mark(tasks, "stale")
            raise Stale(f"{t.sku_id} is no longer in {t.from_loc}; this work order is out of date and was closed.")
    targets = {t.to_loc for t in tasks}
    clash = [a for a in db.scalars(select(Assignment).where(Assignment.warehouse_id == wh.id, Assignment.loc_id.in_(sorted(targets)))) if a.sku_id not in asg]
    if clash:
        _mark(tasks, "stale")
        raise Stale(f"{clash[0].loc_id} is now occupied by {clash[0].sku_id}; this work order is out of date and was closed.")
    ctx = load_ctx(db, wh)
    w, st = ctx.w, ctx.st
    for s in skus:
        st.remove(s)
    for t in tasks:
        j = w.loc_ix.get(t.to_loc)
        if j is None or not w.static_mask(t.sku_id)[j] or not st.free[j] or not st.ok(j, t.sku_id):
            raise Conflict(f"{t.sku_id} may not go to {t.to_loc} (a rule would break), so nothing was moved.")
        st.place(j, t.sku_id)
    book = Book(db, wh, skus)
    now = utcnow()
    db.execute(delete(Assignment).where(Assignment.warehouse_id == wh.id, Assignment.sku_id.in_(skus)))
    db.flush()
    for t in tasks:
        db.add(Assignment(warehouse_id=wh.id, sku_id=t.sku_id, loc_id=t.to_loc, assigned_at=now))
    db.flush()
    for t in tasks:
        r = book.rows.get((t.sku_id, t.from_loc))
        if r is not None:
            if r.qty > 0:
                db.add(StockMovement(warehouse_id=wh.id, ts=now, type="move", sku_id=t.sku_id, from_loc=t.from_loc, to_loc=t.to_loc, qty=r.qty,
                                     ref=f"task:{t.id}", note="re-slotting"))
            del book.rows[(t.sku_id, t.from_loc)]
            r.location, r.updated_at = t.to_loc, now
            book.rows[(t.sku_id, t.to_loc)] = r
        else:
            db.add(Stock(warehouse_id=wh.id, sku_id=t.sku_id, location=t.to_loc, qty=0))
        book.face[t.sku_id] = t.to_loc
    for r in db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.type == "replenish", Task.status == "open", Task.sku_id.in_(skus))):
        r.status = "stale"
    db.flush()
    assert_rules(db, wh)
    _mark(tasks, "done")
    review(db, wh, book, skus)


# ------------------------------------------------------------------------------------------------------ reads for the dashboard

def alerts_list(db, wh, open_only=True, limit=100):
    q = select(Alert).where(Alert.warehouse_id == wh.id)
    if open_only:
        q = q.where(Alert.resolved_at.is_(None))
    sev = {"high": 0, "warn": 1, "info": 2}
    rows = sorted(db.scalars(q.order_by(Alert.id.desc()).limit(limit * 3)), key=lambda a: (sev.get(a.severity, 3), -a.id))[:limit]
    return [dict(id=a.id, kind=a.kind, severity=a.severity, message=a.message, created_at=iso(a.created_at), resolved_at=iso(a.resolved_at)) for a in rows]


def resolve_alert(db, wh, alert_id):
    a = db.scalar(select(Alert).where(Alert.warehouse_id == wh.id, Alert.id == alert_id))
    if a is None:
        raise NotFound("Alert not found.")
    a.resolved_at = a.resolved_at or utcnow()
    return dict(id=a.id, resolved_at=iso(a.resolved_at))


def set_reorder_rule(db, wh, sku_id, reorder_point_, lead_days=7):
    if not isinstance(reorder_point_, int) or isinstance(reorder_point_, bool) or reorder_point_ < 0 or reorder_point_ > MAX_QTY:
        raise LiveError("The reorder point must be a whole number, zero or more.")
    if not isinstance(lead_days, int) or isinstance(lead_days, bool) or not 0 <= lead_days <= 365:
        raise LiveError("Lead time must be a whole number of days from 0 to 365.")
    if db.scalar(select(Sku.id).where(Sku.warehouse_id == wh.id, Sku.sku_id == sku_id)) is None:
        raise NotFound(f"Unknown SKU {sku_id}.")
    r = db.scalar(select(ReorderRule).where(ReorderRule.warehouse_id == wh.id, ReorderRule.sku_id == sku_id))
    if r is None:
        db.add(ReorderRule(warehouse_id=wh.id, sku_id=sku_id, reorder_point=reorder_point_, lead_days=lead_days))
    else:
        r.reorder_point, r.lead_days = reorder_point_, lead_days
    book = Book(db, wh, [sku_id])
    review(db, wh, book, [sku_id])
    return dict(sku=sku_id, reorder_point=reorder_point_, lead_days=lead_days)


def _stock_maps(db, wh):
    face_loc = {a.sku_id: a.loc_id for a in db.scalars(select(Assignment).where(Assignment.warehouse_id == wh.id))}
    qty = defaultdict(int)
    for s, loc, q in db.execute(select(Stock.sku_id, Stock.location, Stock.qty).where(Stock.warehouse_id == wh.id)):
        qty[(s, loc)] = q
    return face_loc, qty


def inventory(db, wh, q=None, status=None, sort="sku", desc=False, limit=50, offset=0):
    """One row per product with its pick face, units, reorder point and cover. Filtering, sorting and paging are done here."""
    lv = live_cfg(wh)
    face_loc, qty = _stock_maps(db, wh)
    skus = {s.sku_id: s for s in db.scalars(select(Sku).where(Sku.warehouse_id == wh.id))}
    level = {loc: lvl for loc, lvl in db.execute(select(Bin.loc_id, Bin.level).where(Bin.warehouse_id == wh.id))}
    vel, _ = demand_window(db, wh)
    abc = abc_classes(vel) if len(vel) else pd.Series(dtype=str)
    rates = unit_rates(db, wh)
    rules = {r.sku_id: r for r in db.scalars(select(ReorderRule).where(ReorderRule.warehouse_id == wh.id))}
    open_t = defaultdict(set)
    for t in db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.status == "open")):
        open_t[t.sku_id].add(t.type)
    rows = []
    for sid, s in skus.items():
        face = face_loc.get(sid)
        cap = s.cases * s.units_per_case
        fq, rq = qty.get((sid, face), 0) if face else 0, qty.get((sid, RESERVE), 0)
        total, rp = fq + rq, reorder_point(wh, rules, rates, sid)
        trigger = max(1, math.ceil(cap * lv.get("replen_frac", 0.3)))
        st = "unplaced" if face is None else "stockout" if total <= 0 else "reorder" if total <= rp else "replenish" if fq <= trigger and rq > 0 else "ok"
        rate = rates.get(sid, 0.0)
        rows.append(dict(sku=sid, name=s.name or "", category=s.category, abc=str(abc.get(sid, "C")), loc=face, level=level.get(face), face_qty=fq,
                         capacity=cap, reserve_qty=rq, total=total, reorder_point=rp, per_day=round(rate, 2),
                         days_cover=round(total / rate, 1) if rate > 0 else None, status=st, tasks=sorted(open_t.get(sid, [])),
                         estimated=bool(s.dims_estimated), pick_lines=int(vel.get(sid, 0))))
    counts = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    needle = (q or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in r["sku"].lower() or needle in r["name"].lower() or needle in r["category"].lower() or needle in (r["loc"] or "").lower()]
    if status and status != "all":
        rows = [r for r in rows if r["status"] == status]
    key = sort if sort in ("sku", "category", "loc", "face_qty", "reserve_qty", "total", "days_cover", "pick_lines", "status", "abc") else "sku"
    rows.sort(key=lambda r: (r[key] is None, r[key] if r[key] is not None else 0), reverse=bool(desc))
    return dict(total=len(rows), counts=dict(counts), rows=rows[offset:offset + limit], units=sum(r["total"] for r in rows))


def movements(db, wh, sku=None, kind=None, limit=100):
    q = select(StockMovement).where(StockMovement.warehouse_id == wh.id)
    if sku:
        q = q.where(StockMovement.sku_id == sku)
    if kind and kind != "all":
        q = q.where(StockMovement.type == kind)
    return [dict(id=m.id, ts=iso(m.ts), type=m.type, sku=m.sku_id, from_loc=m.from_loc, to_loc=m.to_loc, qty=m.qty, ref=m.ref, note=m.note,
                 lot=m.lot, expiry=m.expiry) for m in db.scalars(q.order_by(StockMovement.id.desc()).limit(min(int(limit), 500)))]


def bins_geometry(db, wh):
    """Every bin, with coordinates, for the 3D model (static: changes only when a warehouse is imported)."""
    rows = db.execute(select(Bin.loc_id, Bin.aisle, Bin.side, Bin.bay, Bin.level, Bin.bin_no, Bin.x, Bin.y, Bin.z, Bin.zone)
                      .where(Bin.warehouse_id == wh.id).order_by(Bin.id)).all()
    return [dict(loc=r[0], aisle=r[1], side=r[2], bay=r[3], level=r[4], bin=r[5], x=r[6], y=r[7], z=r[8], zone=r[9]) for r in rows]


def live_status(db, wh):
    """Everything the live view shows in one request: headline numbers and the state of every occupied bin."""
    lv = live_cfg(wh)
    face_loc, qty = _stock_maps(db, wh)
    skus = {s.sku_id: s for s in db.scalars(select(Sku).where(Sku.warehouse_id == wh.id))}
    n_bins = db.scalar(select(func.count()).select_from(Bin).where(Bin.warehouse_id == wh.id))
    vel, as_of = demand_window(db, wh)
    abc = abc_classes(vel) if len(vel) else pd.Series(dtype=str)
    open_t = defaultdict(set)
    n_tasks = defaultdict(int)
    for t in db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.status == "open")):
        open_t[t.sku_id].add(t.type)
        n_tasks[t.type] += 1
    out, low, empty, units_face, units_res = [], 0, 0, 0, 0
    for sid, loc in face_loc.items():
        s = skus.get(sid)
        if s is None:
            continue
        cap = s.cases * s.units_per_case
        fq, rq = qty.get((sid, loc), 0), qty.get((sid, RESERVE), 0)
        trig = max(1, math.ceil(cap * lv.get("replen_frac", 0.3)))
        st = "empty" if fq <= 0 else "low" if fq <= trig else "ok"
        low += st == "low"
        empty += st == "empty"
        units_face += fq
        units_res += rq
        out.append(dict(loc=loc, sku=sid, qty=fq, cap=cap, reserve=rq, status=st, vel=int(vel.get(sid, 0)), abc=str(abc.get(sid, "C")),
                        category=s.category, tasks=sorted(open_t.get(sid, []))))
    day = utcnow() - timedelta(hours=24)
    orders_24h = db.scalar(select(func.count(func.distinct(OrderLine.order_id))).where(OrderLine.warehouse_id == wh.id, OrderLine.ts > day, OrderLine.source == "live"))
    last = db.scalar(select(func.max(StockMovement.ts)).where(StockMovement.warehouse_id == wh.id))
    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.warehouse_id == wh.id, Alert.resolved_at.is_(None)))
    stockouts = db.scalar(select(func.count()).select_from(Alert).where(Alert.warehouse_id == wh.id, Alert.resolved_at.is_(None), Alert.kind == "stockout"))
    return dict(
        warehouse=dict(id=wh.id, name=wh.name, source=wh.source), updated_at=iso(utcnow()), demand_as_of=iso(as_of),
        kpis=dict(bins_total=int(n_bins), bins_occupied=len(out), occupancy_pct=round(100 * len(out) / n_bins, 1) if n_bins else 0, skus=len(skus),
                  units_in_faces=int(units_face), units_in_reserve=int(units_res), low_faces=int(low), empty_faces=int(empty),
                  open_replenish=int(n_tasks["replenish"]), open_moves=int(n_tasks["move"]), open_alerts=int(open_alerts), stockouts=int(stockouts),
                  orders_24h=int(orders_24h or 0), last_movement=iso(last)),
        bins=out)


def warehouse_health(db, wh):
    """Reconciliation: recompute stock from the movement log and compare it with the stock table."""
    derived = defaultdict(int)
    m = StockMovement
    for s, loc, n in db.execute(select(m.sku_id, m.to_loc, func.sum(m.qty)).where(m.warehouse_id == wh.id, m.to_loc.is_not(None)).group_by(m.sku_id, m.to_loc)):
        derived[(s, loc)] += int(n)
    for s, loc, n in db.execute(select(m.sku_id, m.from_loc, func.sum(m.qty)).where(m.warehouse_id == wh.id, m.from_loc.is_not(None)).group_by(m.sku_id, m.from_loc)):
        derived[(s, loc)] -= int(n)
    cur = {(s, loc): q for s, loc, q in db.execute(select(Stock.sku_id, Stock.location, Stock.qty).where(Stock.warehouse_id == wh.id))}
    bad = [dict(sku=k[0], location=k[1], from_movements=derived.get(k, 0), in_stock=cur.get(k, 0)) for k in sorted(set(derived) | set(cur))
           if derived.get(k, 0) != cur.get(k, 0)]
    negative = [k for k, q in cur.items() if q < 0]
    return dict(ok=not bad and not negative, mismatches=bad[:50], n_mismatches=len(bad), negative=len(negative), rows_checked=len(set(derived) | set(cur)))


def review_all(db, wh):
    """Raise the replenishment tasks and stock alerts the current stock calls for (after an import, or as a repair)."""
    ids = [s for (s,) in db.execute(select(Sku.sku_id).where(Sku.warehouse_id == wh.id))]
    review(db, wh, Book(db, wh, ids), ids)


def delete_warehouse(db, wid):
    """Remove a warehouse and everything that belongs to it (explicitly, so it also works where foreign keys are not enforced)."""
    for model in (StockMovement, Stock, Task, Alert, OrderLine, ReorderRule, LiveMeta, Assignment, Sku, Bin, JobRun):
        db.execute(delete(model).where(model.warehouse_id == wid))
    db.execute(delete(Warehouse).where(Warehouse.id == wid))


# ------------------------------------------------------------------------------------------------------ idempotency

def replay_or_run(db, key, fn):
    """A write sent twice with the same key is applied once; the second call gets the first call's answer."""
    if not key:
        return fn()
    key = str(key)[:80]
    old = db.get(IdempotencyKey, key)
    if old is not None:
        return old.response
    out = fn()
    db.add(IdempotencyKey(key=key, response=out))
    db.flush()
    return out
