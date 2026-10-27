"""Read-only JSON API over the stored experiment runs (FastAPI). Deployed as a Vercel Python function.

The heavy computation (optimizer, simulator, forecasting) runs offline via scripts/seed_db.py and is stored in
Postgres; this service only reads, so it stays small enough for serverless.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import Depends, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from slotdb.models import Artifact, Ci, Kpi, Run, RunLog, Slot, Violation, make_engine, session_factory  # noqa: E402

app = FastAPI(title="Warehouse Slotting API", root_path="")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


@app.middleware("http")
async def ensure_api_prefix(request: Request, call_next):
    """Vercel may hand the function the rewritten or the prefix-stripped path; routes live under /api."""
    if not request.scope["path"].startswith("/api"):
        request.scope["path"] = "/api" + request.scope["path"]
    return await call_next(request)


_engine = None
_Session = None


def get_db():
    global _engine, _Session
    if _Session is None:
        _engine = make_engine()
        _Session = session_factory(_engine)
    with _Session() as s:
        yield s


def _run(db, run_id):
    r = db.get(Run, run_id)
    if not r:
        raise HTTPException(404, f"run {run_id} not found")
    return r


@app.get("/api/health")
def health(db=Depends(get_db)):
    return {"status": "ok", "runs": db.scalar(select(func.count()).select_from(Run))}


@app.get("/api/runs")
def runs(db=Depends(get_db)):
    rows = db.scalars(select(Run).order_by(Run.id.desc())).all()
    return [dict(id=r.id, profile=r.profile, dataset=r.dataset, created_at=r.created_at.isoformat(),
                 n_skus=r.summary["n_skus"], n_bins=r.summary["n_bins"], n_orders=r.summary["n_orders"],
                 headline=r.summary["headline"]) for r in rows]


@app.get("/api/runs/{run_id}")
def run_detail(run_id: int, db=Depends(get_db)):
    r = _run(db, run_id)
    log = {x.step: x.seconds for x in db.scalars(select(RunLog).where(RunLog.run_id == run_id))}
    return dict(id=r.id, profile=r.profile, dataset=r.dataset, created_at=r.created_at.isoformat(), config=r.config,
                summary=r.summary, run_log=log)


@app.get("/api/runs/{run_id}/kpis")
def kpis(run_id: int, db=Depends(get_db)):
    _run(db, run_id)
    out = {}
    for k in db.scalars(select(Kpi).where(Kpi.run_id == run_id)):
        out.setdefault(k.policy, {"kpis": {}, "ci": {}, "violations": 0})["kpis"][k.metric] = dict(value=k.value, sd=k.sd)
    for c in db.scalars(select(Ci).where(Ci.run_id == run_id)):
        out[c.policy]["ci"][c.routing] = dict(mean_dist_per_order=c.mean_dist_per_order, ci_low=c.ci_low, ci_high=c.ci_high,
                                              reduction_pct=c.reduction_pct, reduction_ci_low=c.reduction_ci_low,
                                              reduction_ci_high=c.reduction_ci_high)
    for v in db.scalars(select(Violation).where(Violation.run_id == run_id, Violation.rule == "total")):
        out[v.policy]["violations"] = v.count
    return out


@app.get("/api/runs/{run_id}/violations")
def violations(run_id: int, db=Depends(get_db)):
    _run(db, run_id)
    out = {}
    for v in db.scalars(select(Violation).where(Violation.run_id == run_id)):
        out.setdefault(v.policy, {})[v.rule] = v.count
    return out


@app.get("/api/runs/{run_id}/layout")
def layout(run_id: int, policy: str = Query("Full"), db=Depends(get_db)):
    _run(db, run_id)
    rows = db.scalars(select(Slot).where(Slot.run_id == run_id, Slot.policy == policy)).all()
    if not rows:
        raise HTTPException(404, f"no layout '{policy}' in run {run_id}")
    return [dict(sku=s.sku_id, loc=s.location_id, aisle=s.aisle, side=s.side, bay=s.bay, level=s.level, bin=s.bin,
                 x=s.x, y=s.y, velocity=s.velocity, abc=s.abc, category=s.category, hazard=s.hazard) for s in rows]


def _artifact(db, run_id, kind):
    _run(db, run_id)
    a = db.scalar(select(Artifact).where(Artifact.run_id == run_id, Artifact.kind == kind))
    if a is None:
        raise HTTPException(404, f"no '{kind}' for run {run_id}")
    return a.payload


@app.get("/api/runs/{run_id}/eda")
def eda(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "eda")


@app.get("/api/runs/{run_id}/forecast")
def forecast(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "forecast")


@app.get("/api/runs/{run_id}/reslot")
def reslot(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "reslot")


@app.get("/api/runs/{run_id}/sensitivity")
def sensitivity(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "sensitivity")


@app.get("/api/runs/{run_id}/paths")
def paths(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "paths")


@app.get("/api/_debug/{rest:path}")
def debug(rest: str, request: Request):
    """Temporary: shows what path and headers the platform passed to the function."""
    return {"path": request.url.path, "scope_path": request.scope["path"], "query": str(request.url.query),
            "headers": {k: v for k, v in request.headers.items() if k.startswith(("x-vercel", "x-forwarded", "x-matched"))}}


# Local / Docker: also serve the built React app. On Vercel the static build is served by the platform instead.
_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist")
if os.path.isdir(_dist) and not os.environ.get("VERCEL"):
    from fastapi.staticfiles import StaticFiles  # noqa: E402

    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")

