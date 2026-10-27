"""Write one experiment result (core.experiment.run_experiment) to the database."""
import numpy as np
from sqlalchemy import delete
from .models import Artifact, Ci, Kpi, Run, RunLog, Slot, Violation


def clean(o):
    """numpy -> plain Python so the JSON columns accept it."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.generic):
        return clean(o.item())
    if isinstance(o, float) and o != o:
        return None
    return o


class PublishRefused(Exception):
    """A run that breaks a rule, or could not place every SKU, must never be stored as a usable layout."""


def check_publishable(R):
    """Fail closed. Every layout except the deliberately rule-ignoring 'naive' baseline must have zero violations."""
    bad = {}
    for n, e in R["results"].items():
        v = e["violations"]
        # a random baseline that cannot place every SKU in a tight warehouse is not an unsafe layout; any other breach is
        total = v["total"] - (v.get("unplaced_skus", 0) if n in ("B0_random", "B1_chaotic") else 0)
        if n != "naive" and total:
            bad[n] = total
    if bad:
        raise PublishRefused(f"layouts with rule violations, not published: {bad}")
    if any(R["unplaced"].values()):
        raise PublishRefused(f"SKUs could not be placed: {R['unplaced']}")
    if R.get("reslot") and R["reslot"]["violations"]:
        raise PublishRefused("re-slotting produced rule violations, not published")


def save_run(Session, R, dataset, replace_profile=True):
    R = clean(R)
    check_publishable(R)
    with Session.begin() as s:
        if replace_profile:   # keep one current run per profile so the UI always shows the latest
            for rid in [r.id for r in s.query(Run).filter(Run.profile == R["profile"])]:
                for t in (Artifact, Kpi, Ci, Violation, Slot, RunLog):
                    s.execute(delete(t).where(t.run_id == rid))
                s.execute(delete(Run).where(Run.id == rid))
        keep = ("profile", "n_skus", "n_bins", "n_orders", "n_train", "n_test", "best", "headline", "unplaced", "timing",
                "extra", "grid")
        run = Run(profile=R["profile"], dataset=dataset, config=R["config"], summary={k: R[k] for k in keep})
        s.add(run)
        s.flush()
        for pol, e in R["results"].items():
            for m, v in e["kpis"].items():
                s.add(Kpi(run_id=run.id, policy=pol, metric=m, value=v, sd=e.get("kpis_sd", {}).get(m)))
            for routing, c in e["ci"].items():
                s.add(Ci(run_id=run.id, policy=pol, routing=routing, mean_dist_per_order=c["mean_dist_per_order"],
                         ci_low=c["ci_low"], ci_high=c["ci_high"], reduction_pct=c["reduction_pct"],
                         reduction_ci_low=c["reduction_ci_low"], reduction_ci_high=c["reduction_ci_high"]))
            for rule, n in e["violations"].items():
                s.add(Violation(run_id=run.id, policy=pol, rule=rule, count=n))
        keys = ("policy", "sku_id", "location_id", "aisle", "side", "bay", "level", "bin", "x", "y", "velocity", "abc",
                "category", "hazard")
        s.bulk_insert_mappings(Slot, [dict(zip(keys, row), run_id=run.id) for row in R["slots"]])
        for kind in ("eda", "forecast", "reslot", "sensitivity", "paths"):
            s.add(Artifact(run_id=run.id, kind=kind, payload=R[kind]))
        for step, sec in R["timing"].items():
            s.add(RunLog(run_id=run.id, step=step, seconds=sec))
        return run.id
