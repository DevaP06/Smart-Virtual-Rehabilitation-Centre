"""Pick-route simulation and KPIs.

Two routing policies, both with a depot at the front of aisle 0:
  return   : depot -> aisle -> deepest pick -> back to the cross-aisle -> next aisle ... (front cross-aisle only)
  s_shape  : needs a rear cross-aisle; every visited aisle is walked end to end, alternating direction.
Both sides of an aisle are served in one walk.
"""
import numpy as np
import pandas as pd

POLICIES = ("return", "s_shape")


def route_stats(orders, asg, locs, c, policy="return"):
    m = (orders.merge(asg, on="SKU_ID")
         .merge(locs[["Location_ID", "Aisle_Number", "AisleX", "Y", "Shelf_Level"]], on="Location_ID"))
    ay = m.groupby(["Order_ID", "Aisle_Number"]).agg(y=("Y", "max"), x=("AisleX", "first")).reset_index()
    g = ay.groupby("Order_ID")
    xmax, k = g.x.max(), g.size()
    if policy == "return":
        dist = 2 * g.y.sum() + 2 * xmax
    elif policy == "s_shape":
        L = locs.Y.max()
        dist = k * L + 2 * xmax + L * (k % 2)       # odd number of aisles ends at the back and must come home
    else:
        raise ValueError(policy)
    lines = m.groupby("Order_ID").size()
    extra = m.Shelf_Level.map(lambda l: c["level_sec"][l - 1]).groupby(m.Order_ID).sum()
    day = orders.groupby("Order_ID").Timestamp.min().dt.date
    out = pd.DataFrame({"dist": dist, "lines": lines, "time": dist / c["speed"] + lines * c["pick_s"] + extra})
    out["day"] = day.reindex(out.index)
    return out


def route_path(order_id, orders, asg, locs, policy="return"):
    """(x, y) polyline for one order, for the dashboard replay."""
    m = (orders[orders.Order_ID == order_id].merge(asg, on="SKU_ID")
         .merge(locs[["Location_ID", "AisleX", "Y"]], on="Location_ID"))
    pts = [(0.0, 0.0)]
    if policy == "return":
        for x, g in m.groupby("AisleX"):
            pts += [(x, 0.0), (x, float(g.Y.max())), (x, 0.0)]
        return pts + [(0.0, 0.0)]
    L, up = float(locs.Y.max()), True
    xs = sorted(m.AisleX.unique())
    for x in xs:
        pts += [(x, 0.0 if up else L), (x, L if up else 0.0)]
        up = not up
    if not up:                                        # ended at the back: walk home along the rear cross-aisle
        pts += [(0.0, L), (0.0, 0.0)]
    else:
        pts += [(0.0, 0.0)]
    return pts


def pair_distance(pairs, asg, locs, top=500):
    """Mean walking distance (m) between the two bins of the strongest co-ordered pairs, weighted by count."""
    pos = asg.merge(locs[["Location_ID", "AisleX", "Y"]], on="Location_ID").set_index("SKU_ID")[["AisleX", "Y"]]
    num = den = 0.0
    for (a, b), n in pairs.most_common(top):
        if a in pos.index and b in pos.index:
            (xa, ya), (xb, yb) = pos.loc[a].values, pos.loc[b].values
            d = abs(ya - yb) if xa == xb else ya + yb + abs(xa - xb)
            num += n * d; den += n
    return num / den if den else float("nan")


def kpis(orders, asg, skus, locs, c, abc=None, policy="return", pairs=None):
    r = route_stats(orders, asg, locs, c, policy)
    S = skus.set_index("SKU_ID")
    unit_vol = (S.Width * S.Height * S.Depth / 1000)
    vol = (unit_vol * S.Cases).reindex(asg.SKU_ID).values.sum()
    L = locs.set_index("Location_ID")
    used = L.Volumetric_Capacity.reindex(asg.Location_ID).sum()
    out = dict(total_distance_m=r.dist.sum(), avg_distance_per_order_m=r.dist.mean(), avg_route_time_s=r.time.mean(),
               p95_route_time_s=r.time.quantile(0.95), fill_rate_pct=100 * vol / used,
               cube_util_pct=100 * vol / locs.Volumetric_Capacity.sum(),
               lines_per_labour_hour=r.lines.sum() / (r.time.sum() / 3600))
    # replenishment: refills per day = daily unit demand / units that fit in the bin
    days = max(r.day.nunique(), 1)
    dem = orders.groupby("SKU_ID").Quantity.sum() / days
    cap = (L.Volumetric_Capacity.reindex(asg.Location_ID).values / unit_vol.reindex(asg.SKU_ID).values).astype(int).clip(1)
    out["replenishments_per_day"] = float((dem.reindex(asg.SKU_ID).fillna(0).values / cap).sum())
    if abc is not None:
        m = orders.merge(asg, on="SKU_ID").merge(locs[["Location_ID", "Shelf_Level"]], on="Location_ID")
        a = m[m.SKU_ID.map(abc) == "A"]
        out["class_a_golden_share_pct"] = 100 * a.Shelf_Level.isin([3, 4]).mean() if len(a) else float("nan")
    if pairs is not None:
        out["pair_distance_m"] = pair_distance(pairs, asg, locs)
    return out


def bootstrap_ci(per_day, base_per_day, n_boot=1000, seed=0):
    """95% CI over order-days. per_day / base_per_day: DataFrames with columns dist, n indexed by day.
    Returns dict: mean distance per order and its CI, and the paired % reduction vs the base with its CI."""
    rng = np.random.default_rng(seed)
    days = per_day.index.intersection(base_per_day.index)
    a, b = per_day.loc[days], base_per_day.loc[days]
    idx = rng.integers(0, len(days), (n_boot, len(days)))
    ma = a.dist.values[idx].sum(1) / a.n.values[idx].sum(1)
    red = 100 * (1 - a.dist.values[idx].sum(1) / b.dist.values[idx].sum(1))
    mean = a.dist.sum() / a.n.sum()
    return dict(mean_dist_per_order=float(mean), ci_low=float(np.percentile(ma, 2.5)), ci_high=float(np.percentile(ma, 97.5)),
                reduction_pct=float(100 * (1 - a.dist.sum() / b.dist.sum())),
                reduction_ci_low=float(np.percentile(red, 2.5)), reduction_ci_high=float(np.percentile(red, 97.5)))


def per_day(r):
    g = r.groupby("day")
    return pd.DataFrame({"dist": g.dist.sum(), "n": g.size()})
