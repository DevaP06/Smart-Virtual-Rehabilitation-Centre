"""Setup for a live warehouse: read the company's CSVs, check them, fill what can honestly be estimated, and place what is not yet placed.

Fail closed, like core/ingest.py (which does the per-table checks): anything that could give an unsafe layout is an error and
nothing is imported. The one deliberate softening is a missing product size or weight: it is estimated from the product's category
and the product is flagged `estimated`, so the plan shows it instead of silently guessing.
"""
import io

import pandas as pd

from .config import CFG
from .data import CATS
from .engine import State, World, cooc, partners, velocity
from .ingest import Report, validate
from .putaway import diagnose, place_skus
from .validate import validate as rule_check

SIZE = ["Width", "Height", "Depth", "Weight"]
ID_COLS = {"SKU_ID": str, "Location_ID": str, "Order_ID": str, "Rack_ID": str}
LIVE_DEFAULTS = dict(replen_frac=0.3, lead_days=7, safety_days=2, move_cost=150.0, reslot_budget=20, far_share_alert=0.25, demand_days=56)
RESERVE = "RESERVE"


def live_config(heavy_kg=15.0, **over):
    """Engine config for a live warehouse (JSON-safe: lists, not tuples) with the live settings under 'live'."""
    c = {k: (list(v) if isinstance(v, tuple) else v) for k, v in CFG.items()}
    c["heavy_kg"] = heavy_kg
    c["train_frac"] = 0.7
    c["live"] = {**LIVE_DEFAULTS, **over}
    return c


def read_csv(text, table, rep, required=False):
    """CSV text -> DataFrame, or None when the file was not supplied (an error if it was required)."""
    if text is None or not str(text).strip():
        if required:
            rep.err(table, "this file is required")
        return None
    try:
        df = pd.read_csv(io.StringIO(str(text)), dtype={k: v for k, v in ID_COLS.items()}, skipinitialspace=True)
    except Exception as e:  # noqa: BLE001 - any parse failure is reported to the user, not raised
        rep.err(table, f"could not read the file as CSV: {str(e)[:160]}")
        return None
    df.columns = [str(c).strip() for c in df.columns]
    for c in ID_COLS:
        if c in df.columns:
            df[c] = df[c].astype(str).str.strip()
    if df.empty:
        rep.err(table, "the file has a header but no rows")
        return None
    return df


def estimate_sizes(skus, rep):
    """Fill a missing Width/Height/Depth/Weight with the median of the same category (else the built-in category range midpoint).
    Returns (skus, boolean Series of estimated rows). A product whose category is unknown cannot be estimated: left blank, so
    the validator rejects it with the row number."""
    est = pd.Series(False, index=skus.index)
    if "Category" not in skus.columns or not all(c in skus.columns for c in SIZE):
        return skus, est
    skus = skus.copy()
    cat = skus.Category.astype(str).str.strip().str.lower()
    skus["Category"] = cat
    blank = pd.DataFrame({c: skus[c].isna() | skus[c].astype(str).str.strip().eq("") | skus[c].astype(str).str.lower().eq("nan") for c in SIZE})
    num = skus[SIZE].apply(pd.to_numeric, errors="coerce")
    complete = ~blank.any(axis=1) & num.notna().all(axis=1)
    med = num[complete].groupby(cat[complete]).median()
    cannot = []
    for i in skus.index[blank.any(axis=1)]:
        c = cat[i]
        if c in med.index:
            vals = med.loc[c]
        elif c in CATS:
            w, h, d, kg = CATS[c][0], CATS[c][1], CATS[c][2], CATS[c][3]
            vals = pd.Series([(w[0] + w[1]) / 2, (h[0] + h[1]) / 2, (d[0] + d[1]) / 2, (kg[0] + kg[1]) / 2], index=SIZE)
        else:
            cannot.append(i)
            continue
        for col in SIZE:
            if blank.loc[i, col]:
                skus.loc[i, col] = float(vals[col])
        est[i] = True
    if est.any():
        rep.warn("sku_master", f"{int(est.sum())} products had no size or weight: ESTIMATED from the category median and flagged 'estimated'. "
                 "Replace them with measured values when you have them", skus.index[est])
    if cannot:
        rep.err("sku_master", "no size or weight and an unknown Category, so it cannot be estimated", cannot)
    return skus, est


def _units_per_case(skus, rep):
    if "Units_per_Case" not in skus.columns:
        skus["Units_per_Case"] = 1
        rep.warn("sku_master", "no Units_per_Case column: stock is counted in cases (1 case = 1 unit)")
        return skus
    v = pd.to_numeric(skus.Units_per_Case, errors="coerce")
    bad = v.isna() | (v < 1) | (v != v.round())
    if bad.any():
        rep.err("sku_master", "Units_per_Case must be a whole number of at least 1", skus.index[bad])
    skus["Units_per_Case"] = v.fillna(1).round().astype(int)
    return skus


_SAMPLE = None


def sample_files():
    """A small but complete example (120 bins, 10 products, a few days of orders, opening reserve stock) in the upload format, so the
    wizard can be tried end to end. Built once, deterministic."""
    global _SAMPLE
    if _SAMPLE is None:
        import numpy as np
        from .data import make_warehouse
        bins = make_warehouse({**CFG, "aisles": 2, "bays": 3, "haz_aisles": (1,)})
        skus = pd.DataFrame([
            ("A100", "Stoneware mug", 12, 10, 10, 0.4, "kitchen", "none", "standard", 2, 12),
            ("A101", "Mixing bowl set", 28, 14, 28, 2.1, "kitchen", "none", "standard", 1, 6),
            ("A102", "Notebook A5", 15, 3, 21, 0.3, "stationery", "none", "standard", 3, 24),
            ("A103", "Gel pens (box of 12)", 14, 3, 18, 0.2, "stationery", "none", "standard", 3, 30),
            ("A104", "Picture frame", 30, 3, 40, 0.9, "home_decor", "none", "standard", 2, 8),
            ("A105", "Wine glasses (box of 6)", 24, 20, 18, 2.4, "glassware", "none", "fragile", 1, 4),
            ("A106", "Cast-iron doorstop", 30, 20, 20, 16.0, "tools_bulk", "none", "heavy", 1, 2),
            ("A107", "Scented candle", 9, 10, 9, 0.5, "candles", "flammable", "standard", 2, 12),
            ("A108", "Bleach 1 L", 12, 24, 9, 1.1, "cleaning", "oxidizer", "standard", 2, 6),
            ("A109", "Tote bag", 35, 4, 38, 0.3, "textiles", "none", "standard", 3, 20),
        ], columns=["SKU_ID", "Name", "Width", "Height", "Depth", "Weight", "Category", "Hazard_Class", "Handling_Type", "Cases", "Units_per_Case"])
        rng = np.random.default_rng(5)
        rows, t0 = [], pd.Timestamp("2026-01-05 09:00")
        for o in range(30):
            for s in sorted(set(rng.choice(skus.SKU_ID, size=int(rng.integers(1, 4)), p=np.linspace(2, 0.5, 10) / np.linspace(2, 0.5, 10).sum()))):
                rows.append((f"O{1000 + o}", s, int(rng.integers(1, 4)), (t0 + pd.Timedelta(hours=8 * o)).strftime("%Y-%m-%d %H:%M:%S")))
        orders = pd.DataFrame(rows, columns=["Order_ID", "SKU_ID", "Quantity", "Timestamp"])
        stock = pd.DataFrame([(s, RESERVE, 60) for s in skus.SKU_ID], columns=["SKU_ID", "Location_ID", "Quantity"])
        _SAMPLE = dict(bins=bins.to_csv(index=False), products=skus.to_csv(index=False), orders=orders.to_csv(index=False), stock=stock.to_csv(index=False))
    return _SAMPLE


def capacity(skus_row):
    """Units one pick face holds: cases per pick face x units per case."""
    return int(skus_row["Cases"]) * int(skus_row["Units_per_Case"])


def prepare(bins_csv, skus_csv, orders_csv=None, stock_csv=None, heavy_kg=15.0):
    """Check and normalise an upload. Returns dict(report, ok, tables, summary). `tables` is only present when ok:
    locs, skus (with Units_per_Case and Estimated), orders, stock (SKU_ID, Location_ID, Quantity), assignment (SKU_ID, Location_ID),
    config. SKUs without a bin in the stock file are placed by the engine (rules + cost), so a company can start from nothing."""
    rep = Report()
    locs = read_csv(bins_csv, "locations", rep, required=True)
    skus = read_csv(skus_csv, "sku_master", rep, required=True)
    orders = read_csv(orders_csv, "orders", rep)
    stock = read_csv(stock_csv, "stock", rep)
    if locs is None or skus is None:
        return dict(report=rep, ok=False, tables=None, summary=None)
    return prepare_frames(locs, skus, orders, stock, heavy_kg, rep)


def prepare_frames(locs, skus, orders=None, stock=None, heavy_kg=15.0, rep=None):
    """prepare() for tables that are already DataFrames (the demo seed, tests). Same checks, same result."""
    rep = rep or Report()
    skus, locs = skus.copy(), locs.copy()
    orders = None if orders is None else orders.copy()
    stock = None if stock is None else stock.copy()
    for df, cols in ((skus, ["SKU_ID"]), (locs, ["Location_ID", "Rack_ID"]), (orders, ["Order_ID", "SKU_ID"]), (stock, ["SKU_ID", "Location_ID"])):
        if df is not None:
            for c_ in cols:
                if c_ in df.columns:
                    df[c_] = df[c_].astype(str).str.strip()
    for df, col, limit, table in ((skus, "SKU_ID", 40, "sku_master"), (skus, "Category", 40, "sku_master"), (locs, "Location_ID", 40, "locations"),
                                  (locs, "Rack_ID", 40, "locations"), (orders, "Order_ID", 60, "orders")):
        if df is not None and col in df.columns:
            long = df[col].astype(str).str.len() > limit
            if long.any():
                rep.err(table, f"{col} is longer than {limit} characters", df.index[long])
    skus, est = estimate_sizes(skus, rep)
    skus = _units_per_case(skus, rep)
    r2, (orders_n, skus_n, locs_n) = validate(orders, skus, locs, heavy_kg=heavy_kg, min_days=0)
    rep.errors += r2.errors
    rep.warnings += r2.warnings
    if orders is not None and rep.ok:
        days = (orders_n.Timestamp.max() - orders_n.Timestamp.min()).days if len(orders_n) else 0
        if days < 28:
            rep.warn("orders", f"only {days} days of order history: demand estimates are rough until more orders come in "
                     "(28 days or more is recommended)")
    if orders is None:
        rep.warn("orders", "no order history supplied: products are placed by size and rules only, and demand is learned from the orders "
                 "recorded in the system; re-slotting improves the layout as orders arrive")
    if not rep.ok:
        return dict(report=rep, ok=False, tables=None, summary=None)

    skus_n = skus_n.copy()
    skus_n["Estimated"] = est.values          # validate() keeps every SKU row in order, so the flags still line up
    if "Name" not in skus_n.columns:
        skus_n["Name"] = ""
    skus_n["Name"] = skus_n.Name.fillna("").astype(str).str.slice(0, 160)
    c = live_config(heavy_kg)
    cap = (skus_n.Cases * skus_n.Units_per_Case).values
    cap_of = dict(zip(skus_n.SKU_ID, cap))

    # ---- stock file: starting stock, and (for a bin) where the product sits today ----
    st_rows, pre = [], {}
    if stock is not None:
        if not all(k in stock.columns for k in ("SKU_ID", "Quantity")):
            rep.err("stock", "missing required columns: SKU_ID, Quantity (and Location_ID: a bin id, RESERVE, or blank for reserve)")
        else:
            if "Location_ID" not in stock.columns:
                stock["Location_ID"] = RESERVE
            loc_set = set(locs_n.Location_ID)
            stock["Location_ID"] = stock.Location_ID.replace({"": RESERVE, "nan": RESERVE}).fillna(RESERVE).astype(str).str.strip()
            stock.loc[stock.Location_ID.str.upper() == RESERVE, "Location_ID"] = RESERVE
            q = pd.to_numeric(stock.Quantity, errors="coerce")
            bad = q.isna() | (q < 0) | (q != q.round())
            if bad.any():
                rep.err("stock", "Quantity must be a whole number, zero or more", stock.index[bad])
            unk = ~stock.SKU_ID.isin(skus_n.SKU_ID)
            if unk.any():
                rep.err("stock", "SKU_ID is not in the SKU master", stock.index[unk])
            badloc = ~stock.Location_ID.isin(loc_set | {RESERVE})
            if badloc.any():
                rep.err("stock", "Location_ID is neither a bin in the bins file nor RESERVE", stock.index[badloc])
            dup = stock.duplicated(["SKU_ID", "Location_ID"], keep=False)
            if dup.any():
                rep.err("stock", "the same SKU_ID and Location_ID appear more than once: give one total per location", stock.index[dup])
            if rep.ok:
                stock["Quantity"] = q.round().astype(int)
                faces = stock[stock.Location_ID != RESERVE]
                multi = faces.SKU_ID.duplicated(keep=False)
                if multi.any():
                    rep.err("stock", "a SKU is in more than one bin: only one pick face per SKU is supported, put the other units on a RESERVE row", faces.index[multi])
                shared = faces.Location_ID.duplicated(keep=False)
                if shared.any():
                    rep.err("stock", "two SKUs are in the same bin: one SKU per bin", faces.index[shared])
                over = faces.Quantity > faces.SKU_ID.map(cap_of)
                if over.any():
                    rep.err("stock", "more units in the bin than its pick-face capacity (Cases x Units_per_Case): put the excess on a RESERVE row, or raise Cases",
                            faces.index[over])
            if rep.ok:
                pre = dict(zip(faces.SKU_ID, faces.Location_ID))
                st_rows = stock
    if not rep.ok:
        return dict(report=rep, ok=False, tables=None, summary=None)

    # ---- the layout the company has today must already obey the rules (checked by the independent validator) ----
    if pre:
        asg = pd.DataFrame(sorted(pre.items()), columns=["SKU_ID", "Location_ID"])
        v = rule_check(asg, skus_n[skus_n.SKU_ID.isin(asg.SKU_ID)], locs_n, c)
        v.pop("unplaced_skus", None)
        broken = {k: n for k, n in v.items() if k != "total" and n}
        if broken:
            rep.err("stock", "the current layout in the stock file breaks rules (" + ", ".join(f"{k}: {n}" for k, n in broken.items())
                    + "). Fix those products, or leave their bin blank so the engine places them safely")
            return dict(report=rep, ok=False, tables=None, summary=None)

    # ---- place everything that has no bin yet, with the same rules and cost as the offline placer ----
    w = World(skus_n, locs_n, c)
    state = State(w)
    for s, loc in pre.items():
        state.place(w.loc_ix[loc], s)
    vel = velocity(orders_n) if len(orders_n) else pd.Series(dtype=float)
    part = partners(cooc(orders_n, c["max_basket"]), c["topk"]) if len(orders_n) else {}
    todo = [s for s in (vel.sort_values(ascending=False).index.tolist() if len(vel) else []) if s in w.S.index and s not in state.placed]
    queued = set(todo)
    todo += [s for s in skus_n.SKU_ID if s not in state.placed and s not in queued]
    vel_eff = vel if len(vel) else pd.Series({s: 1.0 for s in skus_n.SKU_ID})
    left = place_skus(w, state, c, vel_eff, part, todo)
    if left:
        rep.err("locations", f"{len(left)} products cannot be placed in any free bin (e.g. {left[0]}): " + diagnose(w, state, left[0])[0])
        return dict(report=rep, ok=False, tables=None, summary=None)
    final = state.to_frame()
    check = rule_check(final, skus_n, locs_n, c)
    if check["total"]:      # cannot happen if the placer and the validator agree; refuse rather than import an unsafe layout
        rep.err("locations", f"the placed layout breaks rules {{{', '.join(f'{k}: {n}' for k, n in check.items() if k != 'total' and n)}}}")
        return dict(report=rep, ok=False, tables=None, summary=None)

    summary = dict(bins=int(len(locs_n)), skus=int(len(skus_n)), hazard_skus=int((skus_n.Hazard_Class != "none").sum()),
                   hazard_bins=int((locs_n.Zone == "HAZ").sum()), order_lines=int(len(orders_n)), estimated=int(skus_n.Estimated.sum()),
                   already_placed=len(pre), placed_by_engine=len(final) - len(pre), stock_rows=int(len(st_rows)),
                   rule_violations=int(check["total"]))
    return dict(report=rep, ok=True, tables=dict(locs=locs_n, skus=skus_n, orders=orders_n, stock=st_rows if len(st_rows) else None,
                                                  assignment=final, config=c), summary=summary)
