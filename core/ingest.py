"""Validate and normalise a company's own data: orders, SKU master, warehouse locations.

Fail closed: anything that could silently produce an unsafe or meaningless layout is an error, not a warning
(unknown hazard class, SKUs that cannot fit any bin, orders for SKUs missing from the master, ...).
"""
import numpy as np
import pandas as pd

HAZARDS = {"none", "flammable", "oxidizer"}          # classes the separation rules know about
HANDLING = {"standard", "fragile", "heavy"}
ZONES = {"STD", "HAZ"}
ORDERS_REQ = ["Order_ID", "SKU_ID", "Quantity", "Timestamp"]
SKU_REQ = ["SKU_ID", "Width", "Height", "Depth", "Weight", "Category", "Hazard_Class", "Handling_Type"]
LOC_REQ = ["Location_ID", "Zone", "Aisle_Number", "Rack_ID", "Bay", "Shelf_Level", "X", "Y", "Z",
           "Max_Weight_Capacity", "Volumetric_Capacity", "Distance_to_Dispatch_Depot",
           "Bin_Width", "Bin_Height", "Bin_Depth"]
MISSING_ORDER_SKU_LIMIT = 0.01                         # more than 1% of order lines for unknown SKUs is an error


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, table, msg, rows=None):
        self.errors.append(dict(table=table, message=msg, rows=_rows(rows)))

    def warn(self, table, msg, rows=None):
        self.warnings.append(dict(table=table, message=msg, rows=_rows(rows)))

    @property
    def ok(self):
        return not self.errors

    def text(self):
        out = []
        for kind, items in (("ERROR", self.errors), ("WARNING", self.warnings)):
            for e in items:
                r = f"  (rows {e['rows']})" if e["rows"] else ""
                out.append(f"{kind} [{e['table']}] {e['message']}{r}")
        return "\n".join(out) or "OK: no problems found"


def _rows(idx):
    if idx is None:
        return None
    idx = list(idx)
    return [int(i) + 2 for i in idx[:5]] + (["..."] if len(idx) > 5 else [])   # +2: header line, 1-based


def _need(df, cols, table, rep):
    miss = [c for c in cols if c not in df.columns]
    if miss:
        rep.err(table, f"missing required columns: {', '.join(miss)}")
    return not miss


def _num(df, cols, table, rep, positive=True):
    for c in cols:
        v = pd.to_numeric(df[c], errors="coerce")
        bad = v.isna() | ((v <= 0) if positive else False)
        if bad.any():
            rep.err(table, f"column {c} must be a positive number", df.index[bad])
        df[c] = v
    return df


def validate(orders, skus, locs, heavy_kg=15.0, levels=5):
    """Returns (Report, (orders, skus, locs) normalised) . Tables are only usable when report.ok."""
    rep = Report()
    orders, skus, locs = orders.copy(), skus.copy(), locs.copy()

    # ---- SKU master ----
    if _need(skus, SKU_REQ, "sku_master", rep):
        d = skus.SKU_ID.duplicated(keep=False)
        if d.any():
            rep.err("sku_master", "duplicate SKU_ID", skus.index[d])
        skus = _num(skus, ["Width", "Height", "Depth", "Weight"], "sku_master", rep)
        if "Cases" not in skus.columns:
            skus["Cases"] = 1
            rep.warn("sku_master", "no Cases column: assuming one case stored per pick face")
        skus = _num(skus, ["Cases"], "sku_master", rep)
        skus["Hazard_Class"] = skus.Hazard_Class.astype(str).str.strip().str.lower()
        skus["Handling_Type"] = skus.Handling_Type.astype(str).str.strip().str.lower()
        bad = ~skus.Hazard_Class.isin(HAZARDS)
        if bad.any():
            rep.err("sku_master", f"unknown Hazard_Class (known: {', '.join(sorted(HAZARDS))}); an unknown class cannot be "
                    "separated safely", skus.index[bad])
        bad = ~skus.Handling_Type.isin(HANDLING)
        if bad.any():
            rep.err("sku_master", f"unknown Handling_Type (known: {', '.join(sorted(HANDLING))})", skus.index[bad])
        heavy = (skus.Weight > heavy_kg) & (skus.Handling_Type != "heavy")
        if heavy.any():
            rep.warn("sku_master", f"Weight above {heavy_kg} kg but Handling_Type is not 'heavy'; it is still treated as heavy",
                     skus.index[heavy])

    # ---- locations ----
    if _need(locs, LOC_REQ, "locations", rep):
        if locs.Location_ID.duplicated().any():
            rep.err("locations", "duplicate Location_ID", locs.index[locs.Location_ID.duplicated(keep=False)])
        locs["Zone"] = locs.Zone.astype(str).str.strip().str.upper()
        bad = ~locs.Zone.isin(ZONES)
        if bad.any():
            rep.err("locations", f"Zone must be one of {sorted(ZONES)} (HAZ = hazard cage)", locs.index[bad])
        locs = _num(locs, ["Max_Weight_Capacity", "Volumetric_Capacity", "Bin_Width", "Bin_Height", "Bin_Depth"], "locations", rep)
        for c in ("Aisle_Number", "Bay", "Shelf_Level", "X", "Y", "Z", "Distance_to_Dispatch_Depot"):
            locs[c] = pd.to_numeric(locs[c], errors="coerce")
            if locs[c].isna().any():
                rep.err("locations", f"column {c} must be numeric", locs.index[locs[c].isna()])
        if not locs.Shelf_Level.isna().any():
            bad = ~locs.Shelf_Level.between(1, levels)
            if bad.any():
                rep.err("locations", f"Shelf_Level must be 1..{levels} (golden zone is levels 3-4; change the ergonomics config "
                        "to support other level counts)", locs.index[bad])
        # derived columns the optimizer needs
        if "Side" not in locs.columns:
            locs["Side"] = (locs.X > locs.groupby("Aisle_Number").X.transform("mean")).astype(int)
        if "Bin" not in locs.columns:
            locs["Bin"] = locs.groupby(["Rack_ID", "Shelf_Level"]).cumcount()
        if "AisleX" not in locs.columns:
            locs["AisleX"] = locs.groupby("Aisle_Number").X.transform("mean").round(2)
            rep.warn("locations", "no AisleX column: using the mean X of each aisle as the aisle centre line")
        locs["Beam_ID"] = locs.Rack_ID.astype(str) + "-L" + locs.Shelf_Level.astype("Int64").astype(str)
        if "Beam_Cap" not in locs.columns:
            locs["Beam_Cap"] = locs.Max_Weight_Capacity * 2
            rep.warn("locations", "no Beam_Cap column: assuming a beam carries twice one bin's rating")
        if "Frame_Cap" not in locs.columns:
            locs["Frame_Cap"] = locs.groupby("Rack_ID").Max_Weight_Capacity.transform("sum") * 0.6
            rep.warn("locations", "no Frame_Cap column: assuming 60% of the sum of the bin ratings in a rack")
        # geometry sanity
        if (locs.Distance_to_Dispatch_Depot < 0).any():
            rep.err("locations", "Distance_to_Dispatch_Depot must not be negative", locs.index[locs.Distance_to_Dispatch_Depot < 0])
        vol = locs.Bin_Width * locs.Bin_Height * locs.Bin_Depth / 1000
        off = (vol - locs.Volumetric_Capacity).abs() > 0.15 * locs.Volumetric_Capacity
        if off.any():
            rep.warn("locations", "Volumetric_Capacity differs by more than 15% from Bin_Width x Bin_Height x Bin_Depth (litres)",
                     locs.index[off])
        if not (locs.Zone == "HAZ").any() and (skus.get("Hazard_Class", pd.Series(dtype=str)) != "none").any():
            rep.err("locations", "SKUs with a hazard class exist but no location is in Zone 'HAZ'")

    # ---- orders ----
    if _need(orders, ORDERS_REQ, "orders", rep):
        orders = _num(orders, ["Quantity"], "orders", rep)
        ts = pd.to_datetime(orders.Timestamp, errors="coerce")
        if ts.isna().any():
            rep.err("orders", "Timestamp is not a valid date/time", orders.index[ts.isna()])
        orders["Timestamp"] = ts
        orders["Order_ID"] = orders.Order_ID.astype(str)
        orders["SKU_ID"] = orders.SKU_ID.astype(str)
        if "SKU_ID" in skus.columns:
            skus["SKU_ID"] = skus.SKU_ID.astype(str)
            unk = ~orders.SKU_ID.isin(skus.SKU_ID)
            if unk.any():
                share = unk.mean()
                (rep.err if share > MISSING_ORDER_SKU_LIMIT else rep.warn)(
                    "orders", f"{unk.sum()} order lines ({100 * share:.1f}%) refer to SKUs missing from the SKU master"
                    + ("" if share > MISSING_ORDER_SKU_LIMIT else "; they are dropped"), orders.index[unk])
                orders = orders[~unk]
        n_days = (orders.Timestamp.max() - orders.Timestamp.min()).days if len(orders) else 0
        if n_days < 28:
            rep.err("orders", f"only {n_days} days of orders; at least 28 are needed for a train/test split and weekly forecasts")
        if orders.drop_duplicates(["Order_ID", "SKU_ID"]).shape[0] < len(orders):
            orders = orders.groupby(["Order_ID", "SKU_ID"], as_index=False).agg(Quantity=("Quantity", "sum"), Timestamp=("Timestamp", "min"))
            rep.warn("orders", "repeated (Order_ID, SKU_ID) lines were merged")

    # ---- cross-table feasibility ----
    if rep.ok:
        if len(skus) > len(locs):
            rep.err("locations", f"{len(skus)} SKUs but only {len(locs)} bins: every SKU needs its own pick face")
        S = skus.assign(vol=skus.Width * skus.Height * skus.Depth * skus.Cases / 1000)
        biggest = locs.Volumetric_Capacity.max()
        too_big = S.vol > biggest
        if too_big.any():
            rep.err("sku_master", f"SKU volume (case volume x Cases) exceeds the largest bin ({biggest:.0f} L): cannot be stored",
                    skus.index[too_big])
        too_heavy = (S.Weight * S.Cases) > locs.Max_Weight_Capacity.max()
        if too_heavy.any():
            rep.err("sku_master", f"SKU weight exceeds the highest bin rating ({locs.Max_Weight_Capacity.max():.0f} kg)",
                    skus.index[too_heavy])
        n_haz = (skus.Hazard_Class != "none").sum()
        n_haz_bins = (locs.Zone == "HAZ").sum()
        if n_haz > n_haz_bins:
            rep.err("locations", f"{n_haz} hazardous SKUs but only {n_haz_bins} bins in the hazard cage")
    if rep.ok:   # dense 0-based aisle / bay / level numbers: the dashboard grid and the neighbour rules index by them
        locs["Aisle_Number"] = pd.factorize(locs.Aisle_Number, sort=True)[0]
        locs["Bay"] = pd.factorize(locs.Bay, sort=True)[0]
        locs["Shelf_Level"] = locs.Shelf_Level.astype(int)
        locs["Side"] = locs.Side.astype(int)
        locs["Bin"] = locs.Bin.astype(int)
    return rep, (orders.reset_index(drop=True), skus.reset_index(drop=True), locs.reset_index(drop=True))
