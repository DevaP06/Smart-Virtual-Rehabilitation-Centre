"""JSON API (FastAPI). Deployed as a Vercel Python function.

/api/runs/... is read-only: the heavy computation (optimizer, simulator, forecasting) runs offline via scripts/seed_db.py and is
stored in Postgres. /api/live/... (server/live_routes.py) is the live warehouse: stock, orders, putaway and work orders.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import csv  # noqa: E402
import io  # noqa: E402

from fastapi import Depends, FastAPI, HTTPException, Query  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from slotdb.models import Artifact, Ci, Explanation, Kpi, Run, RunLog, Slot, Violation, make_engine, session_factory  # noqa: E402

app = FastAPI(title="Warehouse Slotting API", root_path="")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])   # writes are same-origin only (the dashboard is served from here)

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


def _csv(rows, name):
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _slots(db, run_id, policy):
    rows = db.scalars(select(Slot).where(Slot.run_id == run_id, Slot.policy == policy)).all()
    if not rows:
        raise HTTPException(404, f"no layout '{policy}' in run {run_id}")
    return {s.sku_id: s for s in rows}


@app.get("/api/runs/{run_id}/assignment")
def assignment(run_id: int, policy: str = "Full", format: str = "csv", db=Depends(get_db)):
    """The proposed SKU -> bin assignment (what a warehouse system would import)."""
    _run(db, run_id)
    rows = [dict(sku_id=s.sku_id, location_id=s.location_id, aisle=s.aisle, side=s.side, bay=s.bay, level=s.level, bin=s.bin,
                 abc_class=s.abc, category=s.category, hazard_class=s.hazard) for s in _slots(db, run_id, policy).values()]
    return _csv(rows, f"assignment_run{run_id}_{policy}.csv") if format == "csv" else rows


@app.get("/api/runs/{run_id}/moves")
def moves(run_id: int, to: str = "Full", format: str = "csv", frm: str = Query("B0_random", alias="from"), db=Depends(get_db)):
    """Move list from one layout (default: the random baseline) to another: only SKUs whose bin changes, fastest first.
    Use your own current layout as the `from` side by running the engine on your data with that layout stored."""
    _run(db, run_id)
    a, b = _slots(db, run_id, frm), _slots(db, run_id, to)
    out = []
    for sku, new in sorted(b.items(), key=lambda kv: -kv[1].velocity):
        old = a.get(sku)
        if old is None or old.location_id == new.location_id:
            continue
        out.append(dict(priority=len(out) + 1, sku_id=sku, category=new.category, abc_class=new.abc, pick_lines=new.velocity,
                        from_location=old.location_id, to_location=new.location_id, from_level=old.level, to_level=new.level,
                        depot_distance_before_m=round(old.x + old.y, 1), depot_distance_after_m=round(new.x + new.y, 1),
                        hazard_class=new.hazard))
    return _csv(out, f"moves_run{run_id}_{frm}_to_{to}.csv") if format == "csv" else dict(moves=out, n_moves=len(out), n_skus=len(b))


def _ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r, i = [0.0] * len(xs), 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1          # average rank for ties
        i = j + 1
    return r


def _spearman(a, b):
    ra, rb = _ranks(a), _ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va, vb = sum((x - ma) ** 2 for x in ra), sum((y - mb) ** 2 for y in rb)
    return cov / (va * vb) ** 0.5 if va and vb else None


@app.get("/api/compare")
def compare(db=Depends(get_db)):
    """Latest run of each scenario side by side, and how well the objective-weight settings transfer between them."""
    latest = {}
    for r in db.scalars(select(Run).order_by(Run.id)):
        latest[r.profile] = r                                   # last write wins = newest run per scenario
    rows, grids = [], {}
    for prof, r in latest.items():
        ci = db.scalar(select(Ci).where(Ci.run_id == r.id, Ci.policy == r.summary["headline"], Ci.routing == "return"))
        b2 = db.scalar(select(Ci).where(Ci.run_id == r.id, Ci.policy == "B2_abc", Ci.routing == "return"))
        kp = {(k.policy, k.metric): k.value for k in db.scalars(select(Kpi).where(Kpi.run_id == r.id))}
        eda = db.scalar(select(Artifact).where(Artifact.run_id == r.id, Artifact.kind == "eda")).payload
        tr = db.scalar(select(Artifact).where(Artifact.run_id == r.id, Artifact.kind == "tradeoff"))
        h = r.summary["headline"]
        grids[prof] = tr.payload if tr else None
        rows.append(dict(
            run_id=r.id, profile=prof, dataset=r.dataset, n_skus=r.summary["n_skus"], n_orders=r.summary["n_orders"],
            lines_per_order=eda["baskets"]["mean_lines"], single_line_pct=eda["baskets"]["single_line_share"],
            top20_share=eda["top20pct_share"], hazard_pct=eda["hazard_share"],
            full_reduction=dict(pct=ci.reduction_pct, lo=ci.reduction_ci_low, hi=ci.reduction_ci_high) if ci else None,
            abc_reduction=b2.reduction_pct if b2 else None,
            time_reduction_pct=100 * (1 - kp[(h, "avg_route_time_s")] / kp[("B0_random", "avg_route_time_s")]),
            fill_rate=kp[(h, "fill_rate_pct")], pair_distance=kp[(h, "pair_distance_m")]))
    corr = {}
    for m in ("avg_distance_per_order_m", "fill_rate_pct", "class_a_golden_share_pct"):
        pairs = []
        profs = [p for p in grids if grids[p]]
        for i, a in enumerate(profs):
            for b in profs[i + 1:]:
                ga = {(g["lam"], g["mu"], g["erg"]): g[m] for g in grids[a]}
                gb = {(g["lam"], g["mu"], g["erg"]): g[m] for g in grids[b]}
                keys = sorted(set(ga) & set(gb))
                pairs.append(dict(a=a, b=b, rho=_spearman([ga[k] for k in keys], [gb[k] for k in keys]), n=len(keys)))
        corr[m] = pairs
    best = {p: min(g, key=lambda x: x["avg_distance_per_order_m"]) for p, g in grids.items() if g}
    return dict(datasets=rows, rank_correlation=corr,
                best_setting={p: dict(lam=b["lam"], mu=b["mu"], erg=b["erg"]) for p, b in best.items()})


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


@app.get("/api/runs/{run_id}/tradeoff")
def tradeoff(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "tradeoff")


@app.get("/api/runs/{run_id}/cohort")
def cohort(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "cohort")


@app.get("/api/runs/{run_id}/surge")
def surge(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "surge")


@app.get("/api/runs/{run_id}/explain/{sku}")
def explain(run_id: int, sku: str, db=Depends(get_db)):
    _run(db, run_id)
    e = db.scalar(select(Explanation).where(Explanation.run_id == run_id, Explanation.sku_id == sku))
    if e is None:
        raise HTTPException(404, f"no explanation for SKU '{sku}' in run {run_id}")
    return e.payload


@app.get("/api/runs/{run_id}/paths")
def paths(run_id: int, db=Depends(get_db)):
    return _artifact(db, run_id, "paths")


from server.live_routes import make_router  # noqa: E402

app.include_router(make_router(get_db))        # live operations: /api/live/... (must be registered before the static mount below)

# Serve the built React app from the same app (Vercel runs the whole project as this one FastAPI function).
_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist")
if os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles  # noqa: E402

    class Web(StaticFiles):
        """index.html must never be served from a stale cache: its hashed JS/CSS names change on every deploy, and the ETag
        (built from mtime and size) can stay identical across deploys, so a browser would keep a page pointing at deleted files."""

        async def get_response(self, path, scope):
            is_page = path in ("", ".", "index.html") or not path.rsplit("/", 1)[-1].count(".")
            if is_page:   # drop conditional-request headers so the page is always sent in full
                scope = dict(scope, headers=[(k, v) for k, v in scope["headers"] if k not in (b"if-none-match", b"if-modified-since")])
            resp = await super().get_response(path, scope)
            if is_page:
                resp.headers["Cache-Control"] = "no-store"
                for h in ("etag", "last-modified"):
                    if h in resp.headers:
                        del resp.headers[h]
            elif "assets/" in path:
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"   # content-hashed names
            return resp

    app.mount("/", Web(directory=_dist, html=True), name="web")

