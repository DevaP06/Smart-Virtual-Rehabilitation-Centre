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


def partners(pairs, topk=5, min_count=2):
    d = defaultdict(list)
    for (a, b), n in pairs.items():
        if n >= min_count:
            d[a].append((b, n)); d[b].append((a, n))
    return {k: sorted(v, key=lambda t: -t[1])[:topk] for k, v in d.items()}


def assign(skus, locs, vel, part, c, mode="opt", seed=0):
    """Greedy by velocity. mode='opt' minimises cost; mode='random' is the feasible random baseline.
    Returns (assignment DataFrame, list of unplaced SKU_IDs).
    # ponytail: greedy, not Hungarian/MILP; swap in scipy linear_sum_assignment for A/B SKUs if more optimality is needed.
    """
    rng = np.random.default_rng(seed)
    L = locs.reset_index(drop=True)
    m = len(L)
    lvl, haz = L.Shelf_Level.values, (L.Zone == "HAZ").values
    ldims = np.sort(L[["Bin_Width", "Bin_Height", "Bin_Depth"]].values, 1)
    lvol, bcap = L.Volumetric_Capacity.values, L.Max_Weight_Capacity.values
    ax, y, aisle, side, bay = L.AisleX.values, L.Y.values, L.Aisle_Number.values, L.Side.values, L.Bay.values
    beam = pd.factorize(L.Beam_ID)[0]; frame = pd.factorize(L.Rack_ID)[0]
    beam_cap = L.groupby(beam).Beam_Cap.first().values; frame_cap = L.groupby(frame).Frame_Cap.first().values
    slot_cost = L.Distance_to_Dispatch_Depot.values + np.array(c["erg_pen"])[lvl - 1]
    scale = vel.mean() * slot_cost.mean()

    S = skus.set_index("SKU_ID")
    tw = (S.Weight * S.Cases).to_dict()
    tv = (S.Width * S.Height * S.Depth * S.Cases / 1000).to_dict()
    sd = {s: np.sort(r) for s, r in zip(S.index, S[["Width", "Height", "Depth"]].values)}
    v = vel.reindex(S.index).fillna(0)
    order = list(v.sort_values(ascending=False, kind="stable").index) if mode == "opt" else list(rng.permutation(S.index))

    free = np.ones(m, bool)
    beam_load, frame_load = np.zeros(len(beam_cap)), np.zeros(len(frame_cap))
    haz_at, placed, unplaced, rows = defaultdict(set), {}, [], []
    for s in order:
        r = S.loc[s]
        hz = r.Hazard_Class
        mask = free & (ldims >= sd[s]).all(1) & (lvol >= tv[s]) & (bcap >= tw[s]) & (haz == (hz != "none"))
        if r.Handling_Type == "fragile":
            mask &= (lvl >= c["fragile_levels"][0]) & (lvl <= c["fragile_levels"][1])
        if r.Handling_Type == "heavy" or r.Weight > c["heavy_kg"]:
            mask &= lvl <= c["heavy_max_level"]
        cand = np.flatnonzero(mask)
        if mode == "random":
            cost = rng.random(len(cand))
        else:
            # v_floor keeps zero-demand SKUs from scattering: they still prefer nearer slots, so baskets touch fewer aisles
            cost = (v[s] + c["v_floor"] * vel.mean()) * slot_cost[cand] + c["mu_fill"] * scale * (1 - tv[s] / lvol[cand])
            for p, n in part.get(s, ()):
                if p in placed:
                    j = placed[p]
                    d = np.where(aisle[cand] == aisle[j], abs(y[cand] - y[j]), y[cand] + y[j] + abs(ax[cand] - ax[j]))
                    cost = cost + c["lam_aff"] * n * d
        for k in np.argsort(cost, kind="stable"):
            j = cand[k]
            if beam_load[beam[j]] + tw[s] > beam_cap[beam[j]] or frame_load[frame[j]] + tw[s] > frame_cap[frame[j]]:
                continue
            if hz != "none" and any((hz, o) in INCOMPAT for b in (bay[j] - 1, bay[j], bay[j] + 1)
                                    for o in haz_at[(aisle[j], side[j], b)]):
                continue
            free[j] = False; beam_load[beam[j]] += tw[s]; frame_load[frame[j]] += tw[s]
            if hz != "none":
                haz_at[(aisle[j], side[j], bay[j])].add(hz)
            placed[s] = j; rows.append((s, L.Location_ID[j]))
            break
        else:
            unplaced.append(s)
    return pd.DataFrame(rows, columns=["SKU_ID", "Location_ID"]), unplaced


def naive_assign(skus, locs):
    """Unconstrained baseline: SKUs in ID order into locations in ID order (what a careless layout does)."""
    n = len(skus)
    return pd.DataFrame({"SKU_ID": sorted(skus.SKU_ID), "Location_ID": locs.Location_ID.sort_values().values[:n]})
