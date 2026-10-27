"""One full experiment for a layout profile: ablation ladder, KPIs with confidence intervals, validation,
EDA, forecasting, re-slotting, and the artefacts the API/UI display. Pure computation, no database."""
import itertools
import time
import numpy as np
import pandas as pd
from .config import CFG
from .data import load_inputs
from .engine import (State, World, abc_classes, assign_full, cooc, naive_assign, pair_stats, partners, velocity)
from .extras import explain_layout, surge_test, tradeoff_grid
from .forecast import forecast_report, reslot_sim, weekly_matrix
from .refine import cpsat_refine, local_search
from .simulate import POLICIES, bootstrap_ci, kpis, per_day, route_path, route_stats
from .validate import validate

PROFILES = {
    "fulfilment_centre": {},
    "dark_store": dict(aisles=4, bays=10, haz_aisles=(3,), n_sku=600, n_orders=15000, seed=11,
                       bin_cap=[80, 60, 40, 30, 20], beam_cap=[120, 80, 60, 40, 30], frame_cap=240),
}
RANDOM_POLICIES = ("B0_random", "B1_chaotic")
LADDER = ("naive", "B0_random", "B1_chaotic", "B2_abc", "B3_golden", "B4_affinity", "Full", "Full+CPSAT", "Full+CPSAT+LS")


def profile_cfg(profile, **over):
    return {**CFG, "train_frac": 0.7, **PROFILES.get(profile, {}), **over}


def _ladder_cfg(c, name):
    z = {"erg_pen": [0] * 5, "lam_aff": 0.0, "mu_fill": 0.0, "v_floor": 0.0}
    if name == "B2_abc":
        return {**c, **z}
    if name == "B3_golden":
        return {**c, **z, "erg_pen": c["erg_pen"]}
    if name == "B4_affinity":
        return {**c, **z, "erg_pen": c["erg_pen"], "lam_aff": c["lam_aff"], "v_floor": c["v_floor"]}
    return c   # Full: adds best-fit (mu_fill)


def run_experiment(profile="fulfilment_centre", orders_path=None, regen=False, n_seeds=5, cp_time=20, ls_seconds=30,
                   log=print, tables=None, **over):
    """tables=(orders, skus, locations): a company's own validated data (see core/ingest.py) instead of a preset."""
    c = profile_cfg(profile, **over)
    t_all, timing = time.time(), {}

    def step(name, t0):
        timing[name] = round(time.time() - t0, 2); log(f"  {name}: {timing[name]}s")

    t0 = time.time()
    if tables is not None:
        orders, skus, locs = tables
    else:
        orders, skus, locs = load_inputs(c, orders_path, out_dir=f"data/processed/{profile}", regen=regen)
    cut = orders.Timestamp.sort_values().iloc[int(len(orders) * c["train_frac"])]
    train, test = orders[orders.Timestamp < cut], orders[orders.Timestamp >= cut]
    vel = velocity(train)
    abc = abc_classes(vel)
    pairs = cooc(train, c["max_basket"])
    part = partners(pairs, c["topk"])
    w = World(skus, locs, c)
    arrival = list(train.drop_duplicates("SKU_ID").SKU_ID)
    step("load+features", t0)

    # ---- layouts ----
    t0 = time.time()
    layouts, states, extra = {"naive": naive_assign(skus, locs)}, {}, {}
    seeds = {}
    for name, mode in (("B0_random", "random"), ("B1_chaotic", "chaos")):
        seeds[name] = []
        for sd in range(n_seeds):
            st, _ = assign_full(skus, locs, vel, part, c, mode, seed=sd, world=w, arrival=arrival)
            seeds[name].append(st.to_frame())
        layouts[name] = seeds[name][0]
    unplaced = {}
    for name in ("B2_abc", "B3_golden", "B4_affinity", "Full"):
        cc = _ladder_cfg(c, name)
        st, un = assign_full(skus, locs, vel, part, cc, "opt", world=_w(w, cc))
        layouts[name], states[name], unplaced[name] = st.to_frame(), st, un
    step("greedy ladder", t0)
    t0 = time.time()
    st = states["Full"]
    extra["cpsat"] = cpsat_refine(w, st, vel, part, c, subset=min(250, len(skus) // 4), time_limit=cp_time)
    layouts["Full+CPSAT"] = st.to_frame()
    step("cp-sat", t0)
    t0 = time.time()
    extra["local_search"] = local_search(w, st, vel, train, c, seconds=ls_seconds)
    layouts["Full+CPSAT+LS"] = st.to_frame()
    step("local search", t0)

    # ---- evaluation ----
    t0 = time.time()
    results = {}
    per_pol_days = {}
    for name in LADDER:
        frames = seeds.get(name) or [layouts[name]]
        entry = {"kpis": {}, "ci": {}, "violations": validate(layouts[name], skus, locs, c)}
        for pol in POLICIES:
            runs = [route_stats(test, f, locs, c, pol) for f in frames]
            days = [per_day(r) for r in runs]
            avg = pd.concat(days).groupby(level=0).mean()                   # mean over seeds for random policies
            per_pol_days[(name, pol)] = avg
            if pol == "return":
                ks = [kpis(test, f, skus, locs, c, abc, pol, pairs) for f in frames]
                entry["kpis"] = {k: float(np.mean([x[k] for x in ks])) for k in ks[0]}
                entry["kpis_sd"] = {k: float(np.std([x[k] for x in ks])) for k in ks[0]} if len(ks) > 1 else {}
            else:
                entry["kpis"][f"avg_distance_per_order_m_{pol}"] = float(np.mean([r.dist.mean() for r in runs]))
        results[name] = entry
    for name in LADDER:
        for pol in POLICIES:
            results[name]["ci"][pol] = bootstrap_ci(per_pol_days[(name, pol)], per_pol_days[("B0_random", pol)])
    feasible = [n for n in LADDER if n not in ("naive",) and results[n]["violations"]["total"] == 0 and n not in RANDOM_POLICIES]
    best = min(feasible, key=lambda n: results[n]["kpis"]["total_distance_m"])
    step("evaluation", t0)

    # ---- sensitivity of the time model ----
    t0 = time.time()
    names = ["B0_random", "B2_abc", "Full"]
    names = list(dict.fromkeys(names))
    rs = {n: route_stats(test, layouts[n], locs, c, "return") for n in names}
    grid, ok_best, same_order = [], 0, 0
    for speed, pick, lv in itertools.product((1.0, 1.3), (5, 8, 10), (0.5, 1, 2)):
        t = {}
        for n, r in rs.items():
            ml = test.merge(layouts[n], on="SKU_ID").merge(locs[["Location_ID", "Shelf_Level"]], on="Location_ID")
            extra_s = (ml.Shelf_Level.map(lambda l: c["level_sec"][l - 1]) * lv).groupby(ml.Order_ID).sum()
            t[n] = float((r.dist / speed + r.lines * pick + extra_s).mean())
        order = tuple(sorted(t, key=t.get))
        grid.append(dict(speed=speed, pick_s=pick, level_sec_scale=lv, avg_time_s=t, ranking=list(order)))
        ok_best += t["Full"] < t["B0_random"]
        same_order += order == tuple(sorted(rs, key=lambda n: grid[0]["avg_time_s"][n]))
    sens = dict(grid=grid, headline_beats_random_share=ok_best / len(grid), same_ranking_share=same_order / len(grid))
    step("sensitivity", t0)

    # ---- EDA ----
    t0 = time.time()
    v = vel.sort_values(ascending=False)
    cum = (v.cumsum() / v.sum() * 100).values
    pts = np.linspace(0, len(v) - 1, min(120, len(v))).astype(int)
    top = list(v.index[:30])
    mat = np.zeros((30, 30), dtype=int)
    for (a, b), n in pairs.items():
        if a in top and b in top:
            i, j = top.index(a), top.index(b)
            mat[i, j] = mat[j, i] = n
    n_ord = train.Order_ID.nunique()
    lines = train.groupby("Order_ID").size()
    S = skus.set_index("SKU_ID")
    vol = (S.Width * S.Height * S.Depth * S.Cases / 1000)
    hist, edges = np.histogram(vol, bins=30)
    eda = dict(
        pareto=dict(pct_skus=[float((i + 1) / len(v) * 100) for i in pts], pct_lines=[float(cum[i]) for i in pts]),
        abc_counts={k: int(x) for k, x in abc.value_counts().items()},
        top20pct_share=float(v.iloc[:max(1, int(.2 * len(v)))].sum() / v.sum() * 100),
        cooc=dict(skus=top, matrix=mat.tolist()), top_pairs=pair_stats(pairs, vel, n_ord, 20),
        baskets=dict(single_line_share=float((lines == 1).mean() * 100), mean_lines=float(lines.mean()),
                     hist=np.bincount(lines.clip(upper=30))[1:].tolist()),
        volume=dict(hist=hist.tolist(), edges=[float(e) for e in edges],
                    bin_classes={f"{v:g} L": float(v) for v in sorted(locs.Volumetric_Capacity.unique())[:6]}),
        clusters=_communities(pairs, vel, n_ord),
        hazard_share=float((skus.Hazard_Class != "none").mean() * 100),
    )
    step("eda", t0)

    # ---- forecasting + re-slotting ----
    t0 = time.time()
    fc, rs_out = None, None
    M = weekly_matrix(orders, list(w.S.index))
    train_weeks = int(np.ceil((cut - orders.Timestamp.min()).days / 7))
    if M.shape[1] - train_weeks >= 2 and train_weeks >= 8:
        fc, model = forecast_report(M.values, train_weeks)
        r = reslot_sim(w, layouts["Full"], orders, train_weeks, M.values, model if fc["beats_naive"] else None, c)
        move_cost = 150.0
        rs_out = dict(weeks=r["weeks"], total_moves=r["total_moves"], move_cost_m=move_cost, static_total=r["static_total"],
                      reslot_total=r["reslot_total"], reslot_total_with_moves=r["reslot_total"] + r["total_moves"] * move_cost,
                      forecast_used="lightgbm_p50" if fc["beats_naive"] else "mean_4wk",
                      violations=validate(r["final_layout"], skus, locs, c)["total"])
    step("forecast+reslot", t0)

    # ---- decision-support extras ----
    t0 = time.time()
    tradeoff = tradeoff_grid(skus, locs, w, vel, part, c, test, abc, pairs)
    surge = surge_test(w, layouts["Full"], skus, orders, cut, c)
    explain = explain_layout(w, _full_state(w, layouts["Full"]), vel, part, c)
    step("tradeoff+surge+explain", t0)

    # ---- artefacts for the UI ----
    cls = abc.to_dict()
    slots = []
    for name in LADDER:
        d = layouts[name].merge(locs, on="Location_ID")
        for r in d.itertuples():
            slots.append((name, r.SKU_ID, r.Location_ID, int(r.Aisle_Number), int(r.Side), int(r.Bay), int(r.Shelf_Level),
                          int(r.Bin), float(r.AisleX), float(r.Y), float(vel.get(r.SKU_ID, 0)), cls.get(r.SKU_ID, "C"),
                          S.Category[r.SKU_ID], S.Hazard_Class[r.SKU_ID]))
    rng = np.random.default_rng(c["seed"])
    multi = test.groupby("Order_ID").size()
    pick_orders = list(rng.choice(multi[multi >= 4].index, size=min(12, int((multi >= 4).sum())), replace=False))
    paths = []
    for oid in pick_orders:
        for name in ("B0_random", "B2_abc", "Full"):
            for pol in POLICIES:
                p = route_path(oid, test, layouts[name], locs, pol)
                d = sum(abs(p[i][0] - p[i + 1][0]) + abs(p[i][1] - p[i + 1][1]) for i in range(len(p) - 1))
                paths.append(dict(order_id=str(oid), policy=name, routing=pol, dist=float(d), points=p,
                                  lines=int((test.Order_ID == oid).sum())))
    timing["total"] = round(time.time() - t_all, 1)
    return dict(profile=profile, config=_jsonable(c), n_skus=len(skus), n_bins=len(locs), n_orders=int(orders.Order_ID.nunique()),
                n_train=int(train.Order_ID.nunique()), n_test=int(test.Order_ID.nunique()), best=best, headline="Full", results=results,
                sensitivity=sens, eda=eda, forecast=fc, reslot=rs_out, extra=extra, unplaced={k: len(v) for k, v in unplaced.items()},
                tradeoff=tradeoff, surge=surge, explain=explain,
                test_days=int(test.Timestamp.dt.date.nunique()), slots=slots, paths=paths, timing=timing, grid=dict(aisles=int(locs.Aisle_Number.max()) + 1, bays=int(locs.Bay.max()) + 1))


def _w(w, c):
    return w.with_config(c)


def _full_state(w, frame):
    """Occupancy state for a stored layout (the live State is mutated by CP-SAT and local search)."""
    st = State(w)
    for sku, loc in zip(frame.SKU_ID, frame.Location_ID):
        st.place(w.loc_ix[loc], sku)
    return st


def _communities(pairs, vel, n_ord):
    import networkx as nx
    top = set(vel.sort_values(ascending=False).index[:400])
    G = nx.Graph()
    for (a, b), n in pairs.items():
        if a in top and b in top and n >= 3:
            lift = n * n_ord / (vel[a] * vel[b])
            if lift >= 2:
                G.add_edge(a, b, weight=n / (vel[a] + vel[b] - n))
    if not G.number_of_edges():
        return dict(n_clusters=0, sizes=[])
    comm = nx.community.louvain_communities(G, weight="weight", seed=0)
    sizes = sorted((len(x) for x in comm), reverse=True)
    return dict(n_clusters=len(comm), sizes=sizes[:20], nodes=G.number_of_nodes(), edges=G.number_of_edges())


def _jsonable(c):
    return {k: (list(v) if isinstance(v, tuple) else v) for k, v in c.items() if k != "bin_dims"} | \
           {"bin_dims": {k: list(v) for k, v in c["bin_dims"].items()}}
