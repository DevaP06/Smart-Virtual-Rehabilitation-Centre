"""Refinement of a greedy layout: CP-SAT on the highest-velocity SKUs, then swap/relocate local search."""
import time
import numpy as np


def _lin_cost(w, st, vel, part, c, s, cand, scale, fixed):
    """Same cost as the greedy placer; affinity counts only partners already fixed in place."""
    v = vel.get(s, 0.0)
    cost = (v + c["v_floor"] * vel.mean()) * w.slot_cost[cand] + c["mu_fill"] * scale * (1 - w.tv[s] / w.lvol[cand])
    for p, n in part.get(s, ()):
        if p in fixed and p in st.placed:
            j = st.placed[p]
            d = np.where(w.aisle[cand] == w.aisle[j], abs(w.y[cand] - w.y[j]), w.y[cand] + w.y[j] + abs(w.ax[cand] - w.ax[j]))
            cost = cost + c["lam_aff"] * n * d
    return cost


def cpsat_refine(w, st, vel, part, c, subset=250, k_bins=25, time_limit=20, seed=0):
    """Re-solve the placement of the `subset` fastest non-hazardous SKUs exactly (generalised assignment with
    beam / rack-frame load limits). Everything else stays fixed. Returns solver stats (status, objective, gap)."""
    from ortools.sat.python import cp_model
    S = [s for s in vel.sort_values(ascending=False, kind="stable").index if s in st.placed and w.hz[s] == "none"][:subset]
    orig = {s: st.placed[s] for s in S}
    for s in S:
        st.remove(s)
    fixed = set(st.placed)
    scale = vel.mean() * w.slot_cost.mean()
    cand, cost = {}, {}
    for s in S:
        cb = np.flatnonzero(w.static_mask(s) & st.free)
        cc = _lin_cost(w, st, vel, part, c, s, cb, scale, fixed)
        keep = np.argsort(cc, kind="stable")[:k_bins]
        js = list(cb[keep])
        if orig[s] not in js:
            js.append(orig[s])
        cand[s] = js
        cost[s] = {j: int(round(10 * _lin_cost(w, st, vel, part, c, s, np.array([j]), scale, fixed)[0])) for j in js}

    m = cp_model.CpModel()
    x = {(s, j): m.NewBoolVar(f"x{i}_{j}") for i, s in enumerate(S) for j in cand[s]}
    for s in S:
        m.AddExactlyOne(x[s, j] for j in cand[s])
    by_bin, by_beam, by_frame = {}, {}, {}
    for (s, j), var in x.items():
        by_bin.setdefault(j, []).append(var)
        by_beam.setdefault(w.beam[j], []).append((s, var))
        by_frame.setdefault(w.frame[j], []).append((s, var))
    for vs in by_bin.values():
        m.AddAtMostOne(vs)
    for b, items in by_beam.items():
        m.Add(sum(int(np.ceil(100 * w.tw[s])) * v for s, v in items) <= int(100 * (w.beam_cap[b] - st.beam_load[b])))
    for f, items in by_frame.items():
        m.Add(sum(int(np.ceil(100 * w.tw[s])) * v for s, v in items) <= int(100 * (w.frame_cap[f] - st.frame_load[f])))
    m.Minimize(sum(cost[s][j] * x[s, j] for (s, j) in x))
    for (s, j), var in x.items():
        m.AddHint(var, 1 if j == orig[s] else 0)
    sol = cp_model.CpSolver()
    sol.parameters.max_time_in_seconds = time_limit
    sol.parameters.random_seed = seed
    sol.parameters.num_workers = 4
    status = sol.Solve(m)
    ok = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    moved = 0
    for s in S:
        j = next((j for j in cand[s] if ok and sol.Value(x[s, j])), orig[s])
        moved += j != orig[s]
        st.place(j, s)
    obj = sol.ObjectiveValue() if ok else None
    gap = (obj - sol.BestObjectiveBound()) / max(abs(obj), 1) if ok else None
    return dict(status=sol.StatusName(status), objective=obj, gap=gap, subset=len(S), moved=moved,
                seconds=round(sol.WallTime(), 2))


class _Orders:
    """Order x SKU incidence as padded arrays, for incremental route-distance deltas."""

    def __init__(self, w, orders):
        ix = {s: i for i, s in enumerate(w.S.index)}
        g = orders[orders.SKU_ID.isin(ix)].groupby("Order_ID")["SKU_ID"].apply(lambda t: [ix[s] for s in set(t)])
        L = max(len(v) for v in g)
        self.mat = np.full((len(g), L), -1, dtype=np.int32)
        for r, v in enumerate(g):
            self.mat[r, :len(v)] = v
        self.of_sku = [[] for _ in ix]
        for r, v in enumerate(g):
            for i in v:
                self.of_sku[i].append(r)
        self.of_sku = [np.array(a, dtype=np.int64) for a in self.of_sku]
        self.ix = ix


def _dist(rows, aisle_of, y_of, ax_of, n_aisles):
    ok = rows >= 0
    r = np.where(ok, rows, 0)
    a, yy, xx = aisle_of[r], np.where(ok, y_of[r], 0.0), np.where(ok, ax_of[r], 0.0)
    ym = np.zeros((len(rows), n_aisles))
    rr = np.repeat(np.arange(len(rows)), rows.shape[1]).reshape(rows.shape)
    np.maximum.at(ym, (rr[ok], a[ok]), yy[ok])
    return 2 * xx.max(1) + 2 * ym.sum(1)


def local_search(w, st, vel, train, c, seconds=60, top_n=300, tries=12, seed=0):
    """Swap two SKUs (or relocate one into a free bin) when training pick distance plus ergonomic cost drops and
    every rule still holds. Hazardous SKUs are left alone. Returns stats."""
    rng = np.random.default_rng(seed)
    O = _Orders(w, train)
    n = len(w.S)
    names = list(w.S.index)
    pos = np.array([st.placed.get(s, -1) for s in names])
    aisle_of, y_of, ax_of, lvl_of = np.zeros(n, dtype=np.int64), np.zeros(n), np.zeros(n), np.zeros(n, dtype=np.int64)

    def sync(i, j):
        pos[i] = j
        aisle_of[i], y_of[i], ax_of[i], lvl_of[i] = w.aisle[j], w.y[j], w.ax[j], w.lvl[j]

    for i in range(n):
        if pos[i] >= 0:
            sync(i, pos[i])
    v = vel.reindex(names).fillna(0).values
    A = int(w.aisle.max()) + 1
    masks = {}
    mask = lambda i: masks.setdefault(i, w.static_mask(names[i]))
    movable = [i for i in np.argsort(-v)[:top_n] if w.hz[names[i]] == "none"]
    start_obj = _dist(O.mat, aisle_of, y_of, ax_of, A).sum() + (v * w.erg[pos]).sum()
    t0, accepted, trials = time.time(), 0, 0
    while time.time() - t0 < seconds:
        i = int(rng.choice(movable))
        others = [int(rng.integers(n)) for _ in range(tries)]
        for k in others:
            if time.time() - t0 > seconds:
                break
            if k == i or w.hz[names[k]] != "none" or pos[k] < 0:
                continue
            ja, jb = pos[i], pos[k]
            if not (mask(i)[jb] and mask(k)[ja]):
                continue
            trials += 1
            idx = np.union1d(O.of_sku[i], O.of_sku[k])
            before = _dist(O.mat[idx], aisle_of, y_of, ax_of, A).sum() + v[i] * w.erg[ja] + v[k] * w.erg[jb]
            st.remove(names[i]); st.remove(names[k])
            if st.ok(jb, names[i]):
                st.place(jb, names[i])
                if st.ok(ja, names[k]):
                    st.place(ja, names[k])
                    sync(i, jb); sync(k, ja)
                    after = _dist(O.mat[idx], aisle_of, y_of, ax_of, A).sum() + v[i] * w.erg[jb] + v[k] * w.erg[ja]
                    if after < before - 1e-9:
                        accepted += 1
                        break
                    st.remove(names[i]); st.remove(names[k])
                    sync(i, ja); sync(k, jb)
                else:
                    st.remove(names[i])
            st.place(ja, names[i]); st.place(jb, names[k])
        # relocate into a free, cheaper bin
        free = np.flatnonzero(mask(i) & st.free & (w.slot_cost < w.slot_cost[pos[i]]))
        if len(free):
            jb = int(rng.choice(free))
            ja = pos[i]
            idx = O.of_sku[i]
            before = _dist(O.mat[idx], aisle_of, y_of, ax_of, A).sum() + v[i] * w.erg[ja]
            st.remove(names[i])
            if st.ok(jb, names[i]):
                sync(i, jb)
                after = _dist(O.mat[idx], aisle_of, y_of, ax_of, A).sum() + v[i] * w.erg[jb]
                if after < before - 1e-9:
                    st.place(jb, names[i]); accepted += 1
                    continue
                sync(i, ja)
            st.place(ja, names[i])
    end_obj = _dist(O.mat, aisle_of, y_of, ax_of, A).sum() + (v * w.erg[pos]).sum()
    return dict(trials=trials, accepted=accepted, seconds=round(time.time() - t0, 1),
                train_objective_before=float(start_obj), train_objective_after=float(end_obj))
                  