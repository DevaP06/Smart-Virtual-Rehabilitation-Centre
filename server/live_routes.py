"""HTTP routes for live operations (/api/live/...). Thin: validate the request, call slotdb.live, commit, translate errors.

Every write runs in one transaction that is committed here and rolled back on any error, so a refused change leaves nothing behind.
"""
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from core.live_setup import prepare, sample_files
from slotdb import live, live_jobs

MAX_UPLOAD_CHARS = 4_000_000          # one Vercel request is limited to about 4.5 MB; larger imports use scripts/import_live.py


class Line(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    qty: int = Field(ge=1, le=live.MAX_QTY)


class OrderIn(BaseModel):
    order_id: str | None = Field(default=None, max_length=60)
    lines: list[Line] = Field(min_length=1, max_length=200)
    allow_partial: bool = False
    idempotency_key: str | None = Field(default=None, max_length=60)


class SimulateIn(BaseModel):
    orders: int = Field(default=25, ge=1, le=100)
    seed: int | None = None


class AdjustIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    location: str = Field(min_length=1, max_length=40)
    delta: int
    note: str = Field(min_length=1, max_length=240)
    idempotency_key: str | None = Field(default=None, max_length=60)


class NewSku(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    category: str | None = Field(default=None, max_length=40)
    width: float | None = None
    height: float | None = None
    depth: float | None = None
    weight: float | None = None
    hazard: str = "none"
    handling: str = "standard"
    cases: int = Field(default=1, ge=1)
    units_per_case: int = Field(default=1, ge=1)


class ReceivePlanIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    qty: int = Field(ge=1, le=live.MAX_QTY)
    new_sku: NewSku | None = None


class ReceiveConfirmIn(ReceivePlanIn):
    loc: str | None = Field(default=None, max_length=40)
    lot: str | None = Field(default=None, max_length=40)
    expiry: str | None = Field(default=None, max_length=10)
    ref: str | None = Field(default=None, max_length=60)
    idempotency_key: str | None = Field(default=None, max_length=60)


class ReorderIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    reorder_point: int = Field(ge=0, le=live.MAX_QTY)
    lead_days: int = Field(default=7, ge=0, le=365)


class JobIn(BaseModel):
    dry_run: bool = False


class SetupIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    bins_csv: str | None = None
    skus_csv: str | None = None
    orders_csv: str | None = None
    stock_csv: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=60)


def _fail(e):
    return HTTPException(e.status, detail=dict(message=e.message, data=e.data))


def make_router(get_db):
    r = APIRouter(prefix="/api/live", tags=["live"])

    def run(db, fn):
        """Run a write; commit on success, roll back and translate on failure."""
        try:
            out = fn()
            db.commit()
            return out
        except live.Stale as e:          # closing an out-of-date work order is the one change kept when a request is refused
            db.commit()
            raise _fail(e)
        except live.LiveError as e:
            db.rollback()
            raise _fail(e)
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, detail=dict(message="Another change got there first (a bin or product was just taken). Please try again.", data=None))
        except Exception:
            db.rollback()
            raise

    def read(db, fn):
        try:
            return fn()
        except live.LiveError as e:
            raise _fail(e)

    def wh_of(db, warehouse):
        try:
            return live.get_wh(db, warehouse)
        except live.LiveError as e:
            raise _fail(e)

    def keyed(wh, endpoint, key):
        return f"{endpoint}:{wh.id}:{key}" if key else None

    @r.get("/warehouses")
    def warehouses(db=Depends(get_db)):
        return live.warehouses(db)

    @r.get("/status")
    def status(warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return read(db, lambda: live.live_status(db, wh))

    @r.get("/bins")
    def bins(warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return Response(content=json.dumps(live.bins_geometry(db, wh)), media_type="application/json", headers={"Cache-Control": "public, max-age=60"})

    @r.get("/inventory")
    def inventory(warehouse: int | None = None, q: str | None = None, status: str | None = None, sort: str = "sku", desc: bool = False,
                  limit: int = Query(50, ge=1, le=2000), offset: int = Query(0, ge=0), format: str = "json", db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        if format == "csv":
            res = live.inventory(db, wh, q, status, sort, desc, limit=100000, offset=0)
            buf = io.StringIO()
            cols = ["sku", "name", "category", "abc", "loc", "level", "face_qty", "capacity", "reserve_qty", "total", "reorder_point", "per_day", "days_cover", "status", "pick_lines"]
            w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(res["rows"])
            return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="inventory_{wh.id}.csv"'})
        return read(db, lambda: live.inventory(db, wh, q, status, sort, desc, limit, offset))

    @r.get("/movements")
    def movements(warehouse: int | None = None, sku: str | None = None, type: str | None = None, limit: int = Query(100, ge=1, le=500), db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return live.movements(db, wh, sku, type, limit)

    @r.post("/orders")
    def orders(body: OrderIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)

        def go():
            return live.replay_or_run(db, keyed(wh, "orders", body.idempotency_key), lambda: live.pick_orders(
                db, wh, [dict(order_id=body.order_id, lines=[(x.sku, x.qty) for x in body.lines])], allow_partial=body.allow_partial)[0])
        return run(db, go)

    @r.post("/simulate")
    def simulate(body: SimulateIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.simulate_orders(db, wh, body.orders, body.seed))

    @r.post("/adjust")
    def adjust(body: AdjustIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.replay_or_run(db, keyed(wh, "adjust", body.idempotency_key),
                                                  lambda: live.adjust_stock(db, wh, body.sku, body.location, body.delta, body.note)))

    @r.post("/receive/plan")
    def receive_plan(body: ReceivePlanIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return read(db, lambda: live.receive_plan(db, wh, body.sku, body.qty, body.new_sku.model_dump() if body.new_sku else None))

    @r.post("/receive/confirm")
    def receive_confirm(body: ReceiveConfirmIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.replay_or_run(db, keyed(wh, "receive", body.idempotency_key), lambda: live.receive_confirm(
            db, wh, body.sku, body.qty, body.loc, body.new_sku.model_dump() if body.new_sku else None, body.lot, body.expiry, body.ref)))

    @r.get("/tasks")
    def tasks(warehouse: int | None = None, status: str = "open", limit: int = Query(200, ge=1, le=500), db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return live.list_tasks(db, wh, status, limit)

    @r.post("/tasks/{task_id}/complete")
    def task_complete(task_id: int, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.complete_task(db, wh, task_id))

    @r.post("/tasks/{task_id}/reject")
    def task_reject(task_id: int, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.reject_task(db, wh, task_id))

    @r.post("/jobs/reslot")
    def job_reslot(body: JobIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live_jobs.run_reslot(db, wh, body.dry_run))

    @r.get("/jobs")
    def jobs(warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return live_jobs.recent_jobs(db, wh)

    @r.get("/alerts")
    def alerts(warehouse: int | None = None, all: bool = False, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return live.alerts_list(db, wh, open_only=not all)

    @r.post("/alerts/{alert_id}/resolve")
    def alert_resolve(alert_id: int, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.resolve_alert(db, wh, alert_id))

    @r.post("/reorder-rules")
    def reorder(body: ReorderIn, warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return run(db, lambda: live.set_reorder_rule(db, wh, body.sku, body.reorder_point, body.lead_days))

    @r.get("/health")
    def health(warehouse: int | None = None, db=Depends(get_db)):
        wh = wh_of(db, warehouse)
        return read(db, lambda: live_jobs.health_report(db, wh))

    # ---- setup wizard ----
    def check_size(body):
        if sum(len(x or "") for x in (body.bins_csv, body.skus_csv, body.orders_csv, body.stock_csv)) > MAX_UPLOAD_CHARS:
            raise HTTPException(413, detail=dict(message="These files are too large for the browser upload (about 4 MB in total). "
                                                         "Import them with: python scripts/import_live.py", data=None))

    @r.post("/setup/validate")
    def setup_validate(body: SetupIn):
        check_size(body)
        p = prepare(body.bins_csv, body.skus_csv, body.orders_csv, body.stock_csv)
        rep = p["report"]
        return dict(ok=p["ok"], errors=rep.errors, warnings=rep.warnings, summary=p["summary"])

    @r.post("/setup/import")
    def setup_import(body: SetupIn, db=Depends(get_db)):
        check_size(body)

        def go():
            def work():
                p = prepare(body.bins_csv, body.skus_csv, body.orders_csv, body.stock_csv)
                if not p["ok"]:
                    raise live.Conflict("The files still have errors. Nothing was imported.", dict(errors=p["report"].errors))
                wh = live.import_warehouse(db, body.name or "My warehouse", p)
                return dict(warehouse=wh.id, name=wh.name, summary=p["summary"])
            key = f"setup:{body.idempotency_key}" if body.idempotency_key else None
            return live.replay_or_run(db, key, work)
        return run(db, go)

    @r.get("/templates/{name}.csv")
    def template(name: str):
        files = sample_files()
        if name not in files:
            raise HTTPException(404, detail=dict(message=f"No template called {name}.", data=None))
        return Response(files[name], media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}_sample.csv"'})

    return r
