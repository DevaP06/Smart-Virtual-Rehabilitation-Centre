"""Putaway: choose the pick face for SKUs in a warehouse that is already stocked (new arrivals, first placement of an import).

Same rules and the same cost function as the offline placer (core/engine.py): the hard-rule mask first, then the cheapest bin by
demand x distance + shelf height + wasted space + distance to bought-together products. Nothing here talks to a database.
"""
import numpy as np

from .engine import placement_cost


def place_skus(w, st, c, vel, part, skus, prior=None):
    """Greedy placement of `skus` (in the order given) into the free bins of `st`, mutating it. Mirrors assign_full(mode='opt').
    `prior` maps a SKU without demand history to the velocity to assume. Returns the list of SKUs that could not be placed."""
    unplaced = []
    prior = prior or {}
    for s in skus:
        cand = np.flatnonzero(w.static_mask(s) & st.free)
        cost = placement_cost(w, st, c, vel, part, s, cand, v=prior.get(s))
        for k in np.argsort(cost, kind="stable"):
            if st.ok(cand[k], s):
                st.place(cand[k], s)
                break
        else:
            unplaced.append(s)
    return unplaced


def diagnose(w, st, s):
    """Why no bin can take SKU `s`: the first rule that removes every remaining candidate, in plain language."""
    free = st.free
    steps = [
        ("There is no free bin.", free),
        ("No free bin is large enough for one case (dimensions).", free & (w.ldims >= w.sd[s]).all(1)),
        ("No free bin has enough volume for the pick-face quantity.", None),
        ("No free bin is rated for the weight of the pick-face quantity.", None),
        ("No free bin is in the right zone (hazardous products only go in the hazard cage, others never do).", None),
        ("No free bin is on an allowed shelf level (fragile products need levels %d-%d, heavy ones level %d or lower)." % (
            w.c["fragile_levels"][0], w.c["fragile_levels"][1], w.c["heavy_max_level"]), None),
    ]
    mask = steps[1][1]
    if not free.any():
        return [steps[0][0]]
    if not mask.any():
        return [steps[1][0]]
    mask = mask & (w.lvol >= w.tv[s])
    if not mask.any():
        return [steps[2][0]]
    mask = mask & (w.bcap >= w.tw[s])
    if not mask.any():
        return [steps[3][0]]
    mask = mask & (w.haz == (w.hz[s] != "none"))
    if not mask.any():
        return [steps[4][0]]
    lvl = w.lvl
    if w.fragile[s]:
        mask = mask & (lvl >= w.c["fragile_levels"][0]) & (lvl <= w.c["fragile_levels"][1])
    if w.heavy[s]:
        mask = mask & (lvl <= w.c["heavy_max_level"])
    if not mask.any():
        return [steps[5][0]]
    return ["Every remaining bin would overload its shelf beam or rack frame, or put an oxidizer next to a flammable product."]


def recommend(w, st, c, vel, part, s, k=3, prior=None):
    """The `k` cheapest bins that satisfy every rule for SKU `s`, with the cost split and the facts that explain the ranking.
    Returns (options, reasons): reasons is empty when there is at least one option, else why nothing fits."""
    cand = np.flatnonzero(w.static_mask(s) & st.free)
    if not len(cand):
        return [], diagnose(w, st, s)
    v = (prior or {}).get(s)
    cost, t = placement_cost(w, st, c, vel, part, s, cand, v=v, terms=True)
    out = []
    for i in np.argsort(cost, kind="stable"):
        j = int(cand[i])
        if not st.ok(j, s):
            continue
        lvl = int(w.lvl[j])
        near = []
        for p, n in part.get(s, ()):
            if p in st.placed:
                q = st.placed[p]
                walk = abs(w.y[j] - w.y[q]) if w.aisle[j] == w.aisle[q] else w.y[j] + w.y[q] + abs(w.ax[j] - w.ax[q])
                near.append(dict(sku=p, orders=int(n), walk_m=round(float(walk), 1)))
        out.append(dict(
            loc=str(w.loc_ids[j]), aisle=int(w.aisle[j]), side=int(w.side[j]), bay=int(w.bay[j]), level=lvl,
            depot_m=round(float(w.L.Distance_to_Dispatch_Depot.values[j]), 1), golden=lvl in (3, 4),
            fill_pct=round(float(100 * w.tv[s] / w.lvol[j]), 0),
            distance=float(t["distance"][i]), shelf=float(t["shelf"][i]), fit=float(t["fit"][i]), affinity=float(t["affinity"][i]),
            total=float(cost[i]), partners=near[:3]))
        if len(out) == k:
            break
    if not out:
        return [], diagnose(w, st, s)
    return out, []


def feasible(w, st, s, loc):
    """Is `loc` a legal, free pick face for SKU `s` right now? Used to re-check a choice on the server before it is applied."""
    j = w.loc_ix.get(loc)
    if j is None or not st.free[j]:
        return False
    return bool(w.static_mask(s)[j] and st.ok(j, s))
