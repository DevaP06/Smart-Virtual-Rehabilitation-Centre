"""Weekly demand forecasting (LightGBM quantiles vs naive) and a move-cost-aware re-slotting simulation."""
import os
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "4")   # silence joblib core-count probe on Windows
import numpy as np
import pandas as pd
from .engine import State
from .simulate import route_stats


def weekly_matrix(orders, sku_ids):
    """SKU x week matrix of pick lines; week 0 starts at the first order."""
    wk = ((orders.Timestamp - orders.Timestamp.min()).dt.days // 7).astype(int)
    m = orders.assign(week=wk).groupby(["SKU_ID", "week"]).size().unstack(fill_value=0)
    return m.reindex(index=sku_ids, columns=range(int(wk.max()) + 1), fill_value=0)


def _features(M, t):
    """Features for predicting week t from weeks < t (no leakage)."""
    X = pd.DataFrame({
        "lag1": M[:, t - 1], "lag2": M[:, t - 2] if t >= 2 else 0, "lag4": M[:, t - 4] if t >= 4 else 0,
        "mean4": M[:, max(0, t - 4):t].mean(1), "mean_all": M[:, :t].mean(1), "woy": (t % 52)})
    return X


def _pinball(y, q, a):
    d = y - q
    return float(np.mean(np.maximum(a * d, (a - 1) * d)))


class Forecaster:
    def __init__(self, M, train_weeks):
        import lightgbm as lgb
        self.M, self.models = M, {}
        rows = [(_features(M, t), M[:, t]) for t in range(4, train_weeks)]
        X = pd.concat([r[0] for r in rows]); y = np.concatenate([r[1] for r in rows])
        for a in (0.1, 0.5, 0.9):
            self.models[a] = lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=150, learning_rate=0.05,
                                               num_leaves=15, min_child_samples=20, verbose=-1).fit(X, y)

    def predict(self, t, a=0.5):
        return np.maximum(self.models[a].predict(_features(self.M, t)), 0)


def forecast_report(M, train_weeks):
    """Pinball loss and wMAPE on held-out weeks, against 'same as last week' and 'mean of last 4 weeks'."""
    f = Forecaster(M, train_weeks)
    res = {a: [] for a in (0.1, 0.5, 0.9)}; nv = {a: [] for a in res}; ma = {a: [] for a in res}
    wm, wn, wa, tot = 0.0, 0.0, 0.0, 0.0
    for t in range(train_weeks, M.shape[1]):
        y = M[:, t]
        feats = _features(M, t)
        for a in res:
            res[a].append(_pinball(y, f.predict(t, a), a)); nv[a].append(_pinball(y, feats.lag1.values, a))
            ma[a].append(_pinball(y, feats.mean4.values, a))
        wm += np.abs(y - f.predict(t)).sum(); wn += np.abs(y - feats.lag1.values).sum(); wa += np.abs(y - feats.mean4.values).sum()
        tot += y.sum()
    out = {f"pinball_p{int(a*100)}": dict(lightgbm=float(np.mean(res[a])), last_week=float(np.mean(nv[a])), mean_4wk=float(np.mean(ma[a])))
           for a in res}
    out["wmape"] = dict(lightgbm=wm / tot, last_week=wn / tot, mean_4wk=wa / tot)
    out["test_weeks"] = M.shape[1] - train_weeks
    out["beats_naive"] = bool(wm < min(wn, wa))
    return out, f


def reslot_sim(w, asg, orders, test_start, M, forecaster, c, budget=20, move_cost=150.0, policy="return"):
    """Replay the held-out weeks twice: a frozen layout vs a layout that each week swaps mis-slotted SKUs
    (predicted velocity vs bin cost) when the weekly saving exceeds `move_cost`, up to `budget` swaps.
    Returns per-week distances and the number of moves. Every swap is rule-checked by State.ok."""
    names = list(w.S.index)
    ix = {s: i for i, s in enumerate(names)}
    static, dyn = State(w), State(w)
    for st in (static, dyn):
        for s, loc in zip(asg.SKU_ID, asg.Location_ID):
            st.place(w.loc_ix[loc], s)
    t0 = orders.Timestamp.min()
    wk = ((orders.Timestamp - t0).dt.days // 7).astype(int)
    rows, moves = [], 0
    masks = {}
    mask = lambda s: masks.setdefault(s, w.static_mask(s))
    for t in range(test_start, int(wk.max()) + 1):
        pred = forecaster.predict(t) if forecaster is not None else M[:, max(0, t - 4):t].mean(1)
        p = dict(zip(names, pred))
        mov = [s for s in names if w.hz[s] == "none"]
        hi = sorted(mov, key=lambda s: -p[s])[:250]
        lo = sorted(mov, key=lambda s: p[s])
        cands = []
        for a in hi:
            ja = dyn.placed[a]
            for b in lo[:60]:
                jb = dyn.placed[b]
                if jb == ja or w.slot_cost[jb] >= w.slot_cost[ja]:
                    continue
                gain = (p[a] - p[b]) * (w.slot_cost[ja] - w.slot_cost[jb]) - move_cost
                if gain > 0 and mask(a)[jb] and mask(b)[ja]:
                    cands.append((gain, a, b))
        used, done = set(), 0
        for gain, a, b in sorted(cands, reverse=True):
            if done >= budget:
                break
            if a in used or b in used:
                continue
            ja, jb = dyn.placed[a], dyn.placed[b]
            dyn.remove(a); dyn.remove(b)
            if dyn.ok(jb, a):
                dyn.place(jb, a)
                if dyn.ok(ja, b):
                    dyn.place(ja, b); used |= {a, b}; done += 1
                    continue
                dyn.remove(a)
            dyn.place(ja, a); dyn.place(jb, b)
        moves += done
        week = orders[wk == t]
        locs = w.L
        d_static = route_stats(week, static.to_frame(), locs, c, policy).dist.sum()
        d_dyn = route_stats(week, dyn.to_frame(), locs, c, policy).dist.sum()
        rows.append(dict(week=t, static_m=float(d_static), reslot_m=float(d_dyn), moves=done))
    return dict(weeks=rows, total_moves=moves, final_layout=dyn.to_frame(),
                static_total=float(sum(r["static_m"] for r in rows)), reslot_total=float(sum(r["reslot_m"] for r in rows)))
