"""Independent rule check. Does NOT import the optimizer: re-derives every rule from the raw tables."""
import numpy as np
import pandas as pd


def validate(asg, skus, locs, c):
    d = asg.merge(skus, on="SKU_ID").merge(locs, on="Location_ID")
    tw = d.Weight * d.Cases
    tv = d.Width * d.Height * d.Depth * d.Cases / 1000
    sd = np.sort(d[["Width", "Height", "Depth"]].values, 1)
    bd = np.sort(d[["Bin_Width", "Bin_Height", "Bin_Depth"]].values, 1)
    v = {
        "unplaced_skus": len(set(skus.SKU_ID) - set(asg.SKU_ID)),
        "double_booked_bins": int(asg.Location_ID.duplicated().sum()),
        "dimension_overflow": int((sd > bd).any(1).sum()),
        "volume_overflow": int((tv > d.Volumetric_Capacity).sum()),
        "bin_overweight": int((tw > d.Max_Weight_Capacity).sum()),
        "beam_overload": int((tw.groupby(d.Beam_ID).sum() > d.groupby("Beam_ID").Beam_Cap.first()).sum()),
        "frame_overload": int((tw.groupby(d.Rack_ID).sum() > d.groupby("Rack_ID").Frame_Cap.first()).sum()),
        "hazard_zone_breach": int(((d.Hazard_Class != "none") != (d.Zone == "HAZ")).sum()),
        "fragile_bad_level": int(((d.Handling_Type == "fragile") & ~d.Shelf_Level.between(*c["fragile_levels"])).sum()),
        "heavy_too_high": int((((d.Handling_Type == "heavy") | (d.Weight > c["heavy_kg"])) & (d.Shelf_Level > c["heavy_max_level"])).sum()),
    }
    h = d[d.Hazard_Class != "none"][["Aisle_Number", "Side", "Bay", "Hazard_Class"]]
    bad = 0
    for _, a in h[h.Hazard_Class == "flammable"].iterrows():
        bad += int(((h.Hazard_Class == "oxidizer") & (h.Aisle_Number == a.Aisle_Number) & (h.Side == a.Side)
                    & ((h.Bay - a.Bay).abs() <= 1)).any())
    v["incompatible_adjacent"] = bad
    v["total"] = sum(v.values())
    return v
