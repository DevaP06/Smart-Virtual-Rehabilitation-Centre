"""Demand profiling, affinity mining and SKU -> location assignment."""
from collections import Counter, defaultdict
from itertools import combinations
import numpy as np
import pandas as pd

INCOMPAT = {("flammable", "oxidizer"), ("oxidizer", "flammable")}


def velocity(orders):
    return orders.groupby("SKU_ID").size()                      # pick lines per SKU


def abc_classes(v, a=0.8, b=0.95):
    s = v.sort_values(ascending=False)
    before = s.cumsum() / s.sum() - s / s.sum()                  # share of demand strictly before this SKU
    return pd.Series(np.where(before < a, "A", np.where(before < b, "B", "C")), index=s.index)


def cooc(orders, max_basket=30):
    pairs = Counter()
    for _, g in orders.groupby("Order_ID")["SKU_ID"]:
        s = sorted(set(g))
        if 1 < len(s) <= max_basket:
            pairs.update(combinations(s, 2))
    return pairs


def partners(pairs, topk=5, min_count=2, n_orders=None, vel=None, min_lift=None):
    """Top-k partners per SKU by co-order count. With n_orders and vel, pairs below min_lift are dropped
    (lift = P(i,k) / (P(i) P(k)); removes pairs that co-occur only because both are popular)."""
    d = defaultdict(list)
    for (a, b), n in pairs.items():
        if n < min_count:
            continue
        if min_lift and n_orders and vel is not None:
            if n * n_orders / (vel.get(a, 1) * vel.get(b, 1)) < min_lift:
                continue
        d[a].append((b, n)); d[b].append((a, n))
    return {k: sorted(v, key=lambda t: -t[1])[:topk] for k, v in d.items()}


def pair_stats(pairs, vel, n_orders, top=50):
    """Support, lift and Jaccard for the strongest pairs (EDA table)."""
    rows = []
    for (a, b), n in pairs.most_common(top):
        va, vb = vel.get(a, 1), vel.get(b, 1)
        rows.append(dict(a=a, b=b, count=n, support=n / n_orders, lift=n * n_orders / (va * vb), jaccard=n / (va + vb - n)))
    return rows


class World:
    """Numpy view of the warehouse and the SKU master, shared by the greedy placer and the refiners."""

    def __init__(self, skus, locs, c):
        L = locs.reset_index(drop=True)
        self.L, self.c, self.m = L, c, len(L)
        self.lvl, self.haz = L.Shelf_Level.values, (L.Zone == "HAZ").values
        self.ldims = np.sort(L[["Bin_Width", "Bin_Height", "Bin_Depth"]].values, 1)
        self.lvol, self.bcap = L.Volumetric_Capacity.values, L.Max_Weight_Capacity.values
        self.ax, self.y, self.aisle = L.AisleX.values, L.Y.values, L.Aisle_Number.values
        self.side, self.bay = L.Side.values, L.Bay.values
        self.beam, self.frame = pd.factorize(L.Beam_ID)[0], pd.factorize(L.Rack_ID)[0]
        self.beam_cap = L.groupby(self.beam).Beam_Cap.first().values
        self.frame_cap = L.groupby(self.frame).Frame_Cap.first().values
        self.loc_ids = L.Location_ID.values
        self.loc_ix = {k: i for i, k in enumerate(self.loc_ids)}
        self.erg = np.array(c["erg_pen"])[self.lvl - 1]
        self.slot_cost = L.Distance_to_Dispatch_Depot.values + self.erg
        S = skus.set_index("SKU_ID")
        self.S = S
        self.tw = (S.Weight * S.Cases).to_dict()
        self.tv = (S.Width * S.Height * S.Depth * S.Cases / 1000).to_dict()
        self.sd = {s: np.sort(r) for s, r in zip(S.index, S[["Width", "Height", "Depth"]].values)}
        self.hz = S.Hazard_Class.to_dict()
        self.fragile = (S.Handling_Type == "fragile").to_dict()
        self.heavy = ((S.Handling_Type == "heavy") | (S.Weight > c["heavy_kg"])).to_dict()

    def with_config(self, c):
        """Same warehouse and SKUs under different objective weights (the ergonomic cost array depends on the config)."""
        import copy
        w2 = copy.copy(self)
        w2.c = c
        w2.erg = np.array(c["erg_pen"])[self.lvl - 1]
        w2.slot_cost = self.L.Distance_to_Dispatch_Depot.values + w2.erg
        return w2

    def static_mask(self, s):
        """Bins that satisfy every per-SKU rule (dimensions, volume, bin weight, hazard zone, fragile/heavy level)."""
        c, lvl = self.c, self.lvl
        mask = ((self.ldims >= self.sd[s]).all(1) & (self.lvol >= self.tv[s]) & (self.bcap >= self.tw[s])
                & (self.haz == (self.hz[s] != "none")))
        if self.fragile[s]:
            mask &= (lvl >= c["fragile_levels"][0]) & (lvl <= c["fragile_levels"][1])
        if self.heavy[s]:
            mask &= lvl <= c["heavy_max_level"]
        return mask


class State:
    """Occupancy plus the aggregate loads that the static mask cannot express."""

    def __init__(self, w):
        self.w = w
        self.free = np.ones(w.m, bool)
        self.beam_load, self.frame_load = np.zeros(len(w.beam_cap)), np.zeros(len(w.frame_cap))
        self.haz_at = defaultdict(set)
        self.placed = {}

    def ok(self, j, s):
        w = self.w
        if self.beam_load[w.beam[j]] + w.tw[s] > w.beam_cap[w.beam[j]]:
            return False
        if self.frame_load[w.frame[j]] + w.tw[s] > w.frame_cap[w.frame[j]]:
            return False
        hz = w.hz[s]
        if hz != "none":
            for b in (w.bay[j] - 1, w.bay[j], w.bay[j] + 1):
                if any((hz, o) in INCOMPAT for o in self.haz_at[(w.aisle[j], w.side[j], b)]):
                    return False
        return True

    def place(self, j, s):
        w = self.w
        self.free[j] = False; self.beam_load[w.beam[j]] += w.tw[s]; self.frame_load[w.frame[j]] += w.tw[s]
        if w.hz[s] != "none":
            self.haz_at[(w.aisle[j], w.side[j], w.bay[j])].add(w.hz[s])
        self.placed[s] = j

    def remove(self, s):
        w = self.w
        j = self.placed.pop(s)
        self.free[j] = True; self.beam_load[w.beam[j]] -= w.tw[s]; self.frame_load[w.frame[j]] -= w.tw[s]
        if w.hz[s] != "none":   # rebuild the cell's hazard set from the SKUs still there
            key = (w.aisle[j], w.side[j], w.bay[j])
            self.haz_at[key] = {w.hz[t] for t, k in self.placed.items()
                                if w.hz[t] != "none" and (w.aisle[k], w.side[k], w.bay[k]) == key}
        return j

    def to_frame(self):
        return pd.DataFrame([(s, self.w.loc_ids[j]) for s, j in self.placed.items()], columns=["SKU_ID", "Location_ID"])


def assign_full(skus, locs, vel, part, c, mode="opt", seed=0, world=None, arrival=None):
    """Greedy placement. mode: 'opt' (cost minimising, by velocity), 'random' (feasible random SKU order),
    'chaos' (feasible random bin, SKUs in order of first appearance: software-directed random stow).
    Returns (state, unplaced SKU list).
    """
    rng = np.random.default_rng(seed)
    w = world or World(skus, locs, c)
    st = State(w)
    scale = vel.mean() * w.slot_cost.mean()
    v = vel.reindex(w.S.index).fillna(0)
    if mode == "opt":
        order = list(v.sort_values(ascending=False, kind="stable").index)
    elif mode == "chaos" and arrival is not None:
        seen = [s for s in arrival if s in w.S.index]
        order = seen + [s for s in w.S.index if s not in set(seen)]
    else:
        order = list(rng.permutation(w.S.index))
    unplaced = []
    for s in order:
        cand = np.flatnonzero(w.static_mask(s) & st.free)
        if mode in ("random", "chaos"):
            cost = rng.random(len(cand))
        else:
            # v_floor keeps zero-demand SKUs from scattering: they still prefer nearer slots, so baskets touch fewer aisles
            cost = (v[s] + c["v_floor"] * vel.mean()) * w.slot_cost[cand] + c["mu_fill"] * scale * (1 - w.tv[s] / w.lvol[cand])
            for p, n in part.get(s, ()):
                if p in st.placed:
                    j = st.placed[p]
                    d = np.where(w.aisle[cand] == w.aisle[j], abs(w.y[cand] - w.y[j]), w.y[cand] + w.y[j] + abs(w.ax[cand] - w.ax[j]))
                    cost = cost + c["lam_aff"] * n * d
        for k in np.argsort(cost, kind="stable"):
            if st.ok(cand[k], s):
                st.place(cand[k], s)
                break
        else:
            unplaced.append(s)
    return st, unplaced


def assign(skus, locs, vel, part, c, mode="opt", seed=0, world=None, arrival=None):
    """DataFrame form of assign_full: (assignment, unplaced).
    # ponytail: greedy first; refine.py adds CP-SAT and swap search on top.
    """
    st, unplaced = assign_full(skus, locs, vel, part, c, mode, seed, world, arrival)
    return st.to_frame(), unplaced


def naive_assign(skus, locs):
    """Unconstrained baseline: SKUs in ID order into locations in ID order (what a careless layout does)."""
    n = len(skus)
    return pd.DataFrame({"SKU_ID": sorted(skus.SKU_ID), "Location_ID": locs.Location_ID.sort_values().values[:n]})


def placement_cost(w, st, c, vel, part, s, cand, v=None, terms=False):
    """Cost of putting SKU `s` in each candidate bin `cand` (an index array): the same formula assign_full(mode='opt') minimises.
    Used for live putaway, where one SKU is placed into a warehouse that is already stocked. `vel` is the raw velocity series
    (its mean sets the scale); `v` overrides the SKU's own demand (a new SKU has no history and gets a prior).
    With terms=True also returns the four parts (distance, shelf, fit, affinity) for explanations."""
    scale = vel.mean() * w.slot_cost.mean()
    v = float(vel.get(s, 0.0)) if v is None else float(v)
    fl = c["v_floor"] * vel.mean()
    cost = (v + fl) * w.slot_cost[cand] + c["mu_fill"] * scale * (1 - w.tv[s] / w.lvol[cand])
    aff = np.zeros(len(cand))
    for p, n in part.get(s, ()):
        if p in st.placed:
            j = st.placed[p]
            d = np.where(w.aisle[cand] == w.aisle[j], abs(w.y[cand] - w.y[j]), w.y[cand] + w.y[j] + abs(w.ax[cand] - w.ax[j]))
            cost = cost + c["lam_aff"] * n * d
            aff = aff + c["lam_aff"] * n * d
    if not terms:
        return cost
    return cost, dict(distance=(v + fl) * w.L.Distance_to_Dispatch_Depot.values[cand], shelf=(v + fl) * w.erg[cand],
                      fit=c["mu_fill"] * scale * (1 - w.tv[s] / w.lvol[cand]), affinity=aff)
