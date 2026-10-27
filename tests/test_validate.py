"""The validator must catch every rule breach. Each test plants one violation into a clean layout."""
import numpy as np
import pytest
from core.data import make_skus, make_warehouse, synth_orders
from core.engine import assign, cooc, partners, velocity
from core.experiment import profile_cfg
from core.validate import validate

C = profile_cfg("dark_store")


@pytest.fixture(scope="module")
def world():
    orders, _ = synth_orders(C)
    skus = make_skus(C, sorted(orders.SKU_ID.unique()))
    locs = make_warehouse(C)
    vel = velocity(orders)
    asg, unplaced = assign(skus, locs, vel, partners(cooc(orders, 30)), C)
    assert not unplaced
    return skus, locs, asg


def put(asg, sku, loc):
    a = asg[asg.SKU_ID != sku].copy()
    a = a[a.Location_ID != loc]                      # evict whoever sits there so only the planted rule is broken
    a.loc[len(a)] = [sku, loc]
    return a


def free_bins(asg, locs):
    return locs[~locs.Location_ID.isin(asg.Location_ID)]


def test_clean_layout_has_no_violations(world):
    skus, locs, asg = world
    assert validate(asg, skus, locs, C)["total"] == 0


def test_dimension_and_volume_overflow(world):
    skus, locs, asg = world
    big = skus.assign(v=skus.Width * skus.Height * skus.Depth * skus.Cases).nlargest(1, "v").SKU_ID.iloc[0]
    small = free_bins(asg, locs).nsmallest(1, "Volumetric_Capacity").Location_ID.iloc[0]
    v = validate(put(asg, big, small), skus, locs, C)
    assert v["volume_overflow"] >= 1 and v["dimension_overflow"] >= 1


def test_bin_overweight(world):
    skus, locs, asg = world
    heavy = skus.assign(w=skus.Weight * skus.Cases).nlargest(1, "w").SKU_ID.iloc[0]
    top = free_bins(asg, locs).query("Shelf_Level == 5").Location_ID.iloc[0]
    assert validate(put(asg, heavy, top), skus, locs, C)["bin_overweight"] >= 1


def test_hazard_zone_breach_both_directions(world):
    skus, locs, asg = world
    flam = skus[skus.Hazard_Class == "flammable"].SKU_ID.iloc[0]
    std = free_bins(asg, locs).query("Zone == 'STD'").Location_ID.iloc[0]
    assert validate(put(asg, flam, std), skus, locs, C)["hazard_zone_breach"] >= 1
    plain = skus[skus.Hazard_Class == "none"].SKU_ID.iloc[0]
    haz = free_bins(asg, locs).query("Zone == 'HAZ'").Location_ID.iloc[0]
    assert validate(put(asg, plain, haz), skus, locs, C)["hazard_zone_breach"] >= 1


def test_incompatible_adjacent(world):
    skus, locs, asg = world
    flam = skus[skus.Hazard_Class == "flammable"].SKU_ID.iloc[0]
    oxi = skus[skus.Hazard_Class == "oxidizer"].SKU_ID.iloc[0]
    haz = locs[locs.Zone == "HAZ"]
    a = haz[(haz.Aisle_Number == haz.Aisle_Number.iloc[0]) & (haz.Side == 0) & (haz.Bay == 3)].Location_ID.iloc[0]
    b = haz[(haz.Aisle_Number == haz.Aisle_Number.iloc[0]) & (haz.Side == 0) & (haz.Bay == 4)].Location_ID.iloc[0]
    lay = put(put(asg, flam, a), oxi, b)
    assert validate(lay, skus, locs, C)["incompatible_adjacent"] >= 1


def test_fragile_and_heavy_level_rules(world):
    skus, locs, asg = world
    fragile = skus[skus.Handling_Type == "fragile"].SKU_ID.iloc[0]
    floor = locs.query("Zone == 'STD' and Shelf_Level == 1").Location_ID.iloc[0]
    assert validate(put(asg, fragile, floor), skus, locs, C)["fragile_bad_level"] >= 1
    heavy = skus[skus.Handling_Type == "heavy"].SKU_ID.iloc[0]
    top = locs.query("Zone == 'STD' and Shelf_Level == 4").Location_ID.iloc[0]
    assert validate(put(asg, heavy, top), skus, locs, C)["heavy_too_high"] >= 1


def test_beam_and_frame_overload(world):
    skus, locs, asg = world
    heavy = skus[skus.Handling_Type == "heavy"].SKU_ID.head(2).tolist()
    pair = locs[(locs.Zone == "STD") & (locs.Rack_ID == locs[locs.Zone == "STD"].Rack_ID.iloc[0]) & (locs.Shelf_Level == 1)]
    assert len(pair) >= 2
    lay = put(put(asg, heavy[0], pair.Location_ID.iloc[0]), heavy[1], pair.Location_ID.iloc[1])
    cap = pair.Beam_Cap.iloc[0]
    w = skus.set_index("SKU_ID").loc[heavy].eval("Weight * Cases").sum()
    if w > cap:
        assert validate(lay, skus, locs, C)["beam_overload"] >= 1
    else:   # total fits: shrink the rating in the table, the validator must then notice
        locs2 = locs.assign(Beam_Cap=w - 0.01)
        assert validate(lay, skus, locs2, C)["beam_overload"] >= 1
    locs3 = locs.assign(Frame_Cap=1.0)
    assert validate(asg, skus, locs3, C)["frame_overload"] >= 1


def test_double_booking_and_unplaced(world):
    skus, locs, asg = world
    dup = asg.copy()
    dup.loc[1, "Location_ID"] = dup.loc[0, "Location_ID"]
    assert validate(dup, skus, locs, C)["double_booked_bins"] >= 1
    assert validate(asg.iloc[1:], skus, locs, C)["unplaced_skus"] == 1


def test_validator_is_independent_of_optimizer():
    import inspect
    import core.validate as v
    src = inspect.getsource(v)
    assert "engine" not in src.replace("optimizer", "") and "refine" not in src
