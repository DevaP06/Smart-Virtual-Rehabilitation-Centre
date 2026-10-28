"""Scheduled work for a live warehouse: re-slotting proposals, layout drift check, stock reconciliation.

Run from the dashboard ("Run re-slotting now") or on a schedule (scripts/live_job.py, .github/workflows/nightly-reslot.yml).
The job only PROPOSES moves as work orders: the layout changes when the floor does the move and someone marks it done.
"""
from sqlalchemy import func, select

from core.reslot import layout_health, propose

from .live import (LiveError, _raise, _resolve, _stock_maps, iso, live_cfg, load_ctx, open_alert_map, refresh_partners, utcnow, warehouse_health,
                   weekly_prediction)
from .models import Alert, JobRun, Task


def _reason(m):
    if m["kind"] == "swap":
        return f"{m['a']} sells about {m['pred_a']:.0f} lines/week and sits farther out than {m['b']} ({m['pred_b']:.0f}/week)"
    return f"{m['a']} sells about {m['pred_a']:.0f} lines/week; a free bin is closer to the depot"


def run_reslot(db, wh, dry_run=False):
    """Forecast demand, propose swaps and relocations whose weekly saving beats the cost of the move, check layout drift and stock
    integrity. Replaces proposals that are still open. A dry run only looks: no job, no work orders, no alerts. If anything fails the
    caller rolls the transaction back, so a failed run leaves nothing half-written."""
    lv = live_cfg(wh)
    ctx = load_ctx(db, wh)
    pred, n_weeks = weekly_prediction(db, wh)
    if not pred:
        raise LiveError("There is no order history yet, so demand cannot be predicted. Record some orders first.")
    moves = propose(ctx.w, ctx.st, pred, budget=lv.get("reslot_budget", 20), move_cost=lv.get("move_cost", 150.0))
    health = layout_health(ctx.w, ctx.st, pred)
    drift_msg = None
    job_id = None
    if not dry_run:
        job = JobRun(warehouse_id=wh.id, kind="reslot")
        db.add(job)
        db.flush()
        job_id = job.id
        for t in db.scalars(select(Task).where(Task.warehouse_id == wh.id, Task.type == "move", Task.status == "open")):
            t.status = "superseded"
        _, on_hand = _stock_maps(db, wh)          # units to carry, shown on the work order (the actual count is taken when it is done)
        for m in moves:
            first = Task(warehouse_id=wh.id, type="move", sku_id=m["a"], from_loc=m["a_from"], to_loc=m["a_to"], saving=m["net_saving"],
                         qty=on_hand.get((m["a"], m["a_from"]), 0), reason=_reason(m), job_id=job_id)
            db.add(first)
            db.flush()
            if m["kind"] == "swap":      # the two halves of a swap are one piece of work: they share a group id
                first.group_id = first.id
                db.add(Task(warehouse_id=wh.id, type="move", sku_id=m["b"], from_loc=m["b_from"], to_loc=m["b_to"], saving=0.0,
                            qty=on_hand.get((m["b"], m["b_from"]), 0), reason=_reason(m), job_id=job_id, group_id=first.id))
        alerts = open_alert_map(db, wh, ["drift", "reconcile"])
        if health["far_share"] > lv.get("far_share_alert", 0.25):
            drift_msg = (f"{health['far_fast_skus']} of {health['fast_skus']} fast sellers ({100 * health['far_share']:.0f}%) sit in far bins. "
                         "Review the proposed moves in Work Orders.")
            _raise(db, wh, alerts, "drift", "drift", "warn", drift_msg)
        else:
            _resolve(alerts, "drift")
        integrity = warehouse_health(db, wh)
        if integrity["ok"]:
            _resolve(alerts, "reconcile")
        else:
            _raise(db, wh, alerts, "reconcile", "reconcile", "high",
                   f"Stock does not match the movement log for {integrity['n_mismatches']} item(s). Investigate before trusting counts.")
        refresh_partners(db, wh)
    summary = dict(proposed=len(moves), swaps=sum(m["kind"] == "swap" for m in moves), relocations=sum(m["kind"] == "relocate" for m in moves),
                   weekly_saving=round(float(sum(m["net_saving"] for m in moves)), 1), forecast_weeks=n_weeks, fast_skus=health["fast_skus"],
                   far_fast_skus=health["far_fast_skus"], far_share=round(health["far_share"], 3), dry_run=bool(dry_run), drift_alert=drift_msg)
    if not dry_run:
        job.status, job.summary, job.finished_at = "ok", summary, utcnow()
    return dict(job_id=job_id, summary=summary, moves=moves)


def recent_jobs(db, wh, limit=10):
    rows = db.scalars(select(JobRun).where(JobRun.warehouse_id == wh.id).order_by(JobRun.id.desc()).limit(limit))
    return [dict(id=j.id, kind=j.kind, status=j.status, started_at=iso(j.started_at), finished_at=iso(j.finished_at), summary=j.summary) for j in rows]


def health_report(db, wh):
    """Integrity of the stock numbers plus the last job, for the status strip on the dashboard."""
    last = db.scalar(select(JobRun).where(JobRun.warehouse_id == wh.id, JobRun.kind == "reslot", JobRun.status == "ok").order_by(JobRun.id.desc()).limit(1))
    n_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.warehouse_id == wh.id, Alert.resolved_at.is_(None)))
    return dict(integrity=warehouse_health(db, wh), open_alerts=int(n_alerts),
                last_job=dict(id=last.id, finished_at=iso(last.finished_at), summary=last.summary) if last else None)
