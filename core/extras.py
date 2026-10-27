"""Decision-support extras computed offline for the dashboard: trade-off grid, demand-surge stress test, per-SKU explanations."""
import itertools
import numpy as np
import pandas as pd
from .engine import assign_full
from .forecast import Forecaster, reslot_sim, weekly_matrix
from .simulate import kpis
from .validate import validate

KEEP = ("avg_distance_per_order_m", "avg_route_time_s", "fill_rate_pct", "class_a_golden_share_pct", "pair_distance_m",
        "replenishments_per_day", "lines_per_labour_hour")


def tradeoff_grid(skus, locs, w, vel, part, c, test, abc, pairs, lams=(0, 0.5, 1.5, 3), mus=(0, 0.5, 1.5), ergs=(0, 0.5, 1)):
    """Re-place the layout under a grid of objective weights and score each on the held-out orders.
    lam = affinity weight, mu = best-fit weight, erg = golden-zone strength (multiplier on the shelf penalty)."""
    out = []
    for lam, mu, e in itertools.product(lams, mus, ergs):
        cc = {**c, "lam_aff": lam, "mu_fill": mu, "erg_pen": [p * e for p in c["erg_pen"]]}
        st, un = assign_full(skus, locs, vel, part, cc, "opt", world=w.with_config(cc))
        frame = st.to_frame()
        k = kpis(test, frame, skus, locs, c, abc, "return", pairs)
        out.append(dict(lam=lam, mu=mu, erg=e, unplaced=len(un), violations=validate(frame, skus, locs, c)["total"],
                        **{m: float(k[m]) for m in KEEP if m in k}))
    return out


def surge_test(w, layout, skus, orders, cut, c, factor=8, share=0.1, weeks=4, seed=0, budget=20):
    """Festive-surge stress: in the last `weeks` weeks, orders containing a random `share` of mid/slow SKUs are repeated so those
    SKUs sell about `factor` times as much. Compare a frozen layout with the weekly re-slotting planner."""
    rng = np.random.default_rng(seed)
    names = list(w.S.index)
    t0 = orders.Timestamp.min()
    wk = ((orders.Timestamp - t0).dt.days // 7).astype(int)
    first_surge = int(wk.max()) - weeks + 1
    train_weeks = int(np.ceil((cut - t0).days / 7))
    if first_surge <= train_weeks + 1 or train_weeks < 8:
        return None
    lines = orders.groupby("SKU_ID").size().reindex(names).fillna(0)
    pool = [s for s in lines.sort_values().index[: int(len(names) * 0.8)] if w.hz[s] == "none"]      # slow and mid movers
    surge_skus = set(rng.choice(pool, size=max(5, int(share * len(names))), replace=False))
    hit = orders[(wk >= first_surge) & orders.SKU_ID.isin(surge_skus)].Order_ID.unique()
    rep = orders[orders.Order_ID.isin(hit) & (wk >= first_surge)]
    extra = [rep.assign(Order_ID=rep.Order_ID + f"_s{i}") for i in range(factor - 1)]
    big = pd.concat([orders] + extra, ignore_index=True)
    M = weekly_matrix(big, names)
    model = Forecaster(M.values, train_weeks)            # trained on pre-surge weeks only
    r = reslot_sim(w, layout, big, train_weeks, M.values, model, c, budget=budget)
    move_cost = 150.0
    return dict(surge_start_week=first_surge, factor=factor, n_surge_skus=len(surge_skus), weeks=r["weeks"],
                total_moves=r["total_moves"], move_cost_m=move_cost, static_total=r["static_total"], reslot_total=r["reslot_total"],
                reslot_total_with_moves=r["reslot_total"] + r["total_moves"] * move_cost,
                violations=validate(r["final_layout"], skus, w.L, c)["total"])


def explain_layout(w, st, vel, part, c, top_alt=3):
    """Per-SKU cost breakdown of the chosen bin and the cheapest alternatives under the same cost function.
    Computed on the final layout (partners' final positions); bin-load limits are not re-checked for alternatives."""
    scale = vel.mean() * w.slot_cost.mean()
    fl = c["v_floor"] * vel.mean()
    dist = w.L.Distance_to_Dispatch_Depot.values
    out = {}

    def walk(j, k):
        return abs(w.y[j] - w.y[k]) if w.aisle[j] == w.aisle[k] else w.y[j] + w.y[k] + abs(w.ax[j] - w.ax[k])

    for s, j in st.placed.items():
        v = float(vel.get(s, 0.0))
        cand = np.flatnonzero(w.static_mask(s) & (st.free | (np.arange(w.m) == j)))
        pj = [(p, n, st.placed[p]) for p, n in part.get(s, ()) if p in st.placed]

        def terms(idx):
            idx = np.atleast_1d(idx)
            d = (v + fl) * dist[idx]
            e = (v + fl) * w.erg[idx]
            f = c["mu_fill"] * scale * (1 - w.tv[s] / w.lvol[idx])
            a = np.array([c["lam_aff"] * sum(n * walk(i, k) for _, n, k in pj) for i in idx])
            return idx, d, e, f, a

        def pack(idx):
            idx, d, e, f, a = terms(idx)
            return [dict(loc=str(w.loc_ids[i]), distance=float(d[m]), shelf=float(e[m]), fit=float(f[m]), affinity=float(a[m]),
                         total=float(d[m] + e[m] + f[m] + a[m]), level=int(w.lvl[i]), depot_m=float(dist[i]))
                    for m, i in enumerate(idx)]

        _, d, e, f, a = terms(cand)
        tot = d + e + f + a
        best = [k for k in np.argsort(tot, kind="stable") if cand[k] != j][:top_alt]
        out[s] = dict(sku=s, velocity=v, chosen=pack(j)[0], alternatives=pack(cand[best]) if best else [],
                      partners=[dict(sku=p, orders=int(n), walk_m=float(walk(j, k))) for p, n, k in pj],
                      n_feasible_bins=int(len(cand)))
    return out
