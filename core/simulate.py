"""Pick-route simulation and KPIs.

Route model ("return" routing): depot -> aisle -> deepest pick in that aisle -> back to the
cross-aisle -> next aisle ... -> depot. Both sides of an aisle are served in one walk.
"""
import pandas as pd


def route_stats(orders, asg, locs, c):
    m = (orders.merge(asg, on="SKU_ID")
         .merge(locs[["Location_ID", "Aisle_Number", "AisleX", "Y", "Shelf_Level"]], on="Location_ID"))
    ay = m.groupby(["Order_ID", "Aisle_Number"]).agg(y=("Y", "max"), x=("AisleX", "first")).reset_index()
    g = ay.groupby("Order_ID")
    dist = 2 * g.y.sum() + 2 * g.x.max()
    lines = m.groupby("Order_ID").size()
    extra = m.Shelf_Level.map(lambda l: c["level_sec"][l - 1]).groupby(m.Order_ID).sum()
    out = pd.DataFrame({"dist": dist, "lines": lines, "time": dist / c["speed"] + lines * c["pick_s"] + extra})
    return out


def route_path(order_id, orders, asg, locs):
    """(x, y) polyline for one order, for the dashboard replay."""
    m = (orders[orders.Order_ID == order_id].merge(asg, on="SKU_ID")
         .merge(locs[["Location_ID", "AisleX", "Y"]], on="Location_ID"))
    pts = [(0, 0)]
    for x, g in m.groupby("AisleX"):
        pts += [(x, 0), (x, g.Y.max()), (x, 0)]
    return pts + [(0, 0)]


def kpis(orders, asg, skus, locs, c):
    r = route_stats(orders, asg, locs, c)
    S = skus.set_index("SKU_ID")
    vol = (S.Width * S.Height * S.Depth * S.Cases / 1000).reindex(asg.SKU_ID).values.sum()
    used = locs.set_index("Location_ID").Volumetric_Capacity.reindex(asg.Location_ID).sum()
    return dict(total_distance_m=r.dist.sum(), avg_distance_per_order_m=r.dist.mean(), avg_route_time_s=r.time.mean(),
                fill_rate_pct=100 * vol / used, cube_util_pct=100 * vol / locs.Volumetric_Capacity.sum())
