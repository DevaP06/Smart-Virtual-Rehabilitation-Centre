import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from core.config import CFG
from core.pipeline import run_all
from core.validate import validate

R = run_all(CFG, regen=True)


def test_optimized_is_feasible_and_complete():
    assert not R["unplaced"]
    assert R["validation"]["optimized"]["total"] == 0
    assert R["validation"]["random (feasible)"]["total"] == 0


def test_optimized_beats_random_baseline():
    r = R["results"]
    assert r.loc["optimized", "total_distance_m"] < 0.6 * r.loc["random (feasible)", "total_distance_m"]


def test_validator_catches_violations():
    # naive layout ignores every rule; the validator must notice
    assert R["validation"]["naive (unconstrained)"]["total"] > 0
    # and a hand-made breach: put a flammable SKU in a standard-zone bin
    a = R["layouts"]["optimized"].copy()
    s = R["skus"]
    sku = s[s.Hazard_Class == "flammable"].SKU_ID.iloc[0]
    std_bin = R["locs"][(R["locs"].Zone == "STD") & ~R["locs"].Location_ID.isin(a.Location_ID)].Location_ID.iloc[0]
    a.loc[a.SKU_ID == sku, "Location_ID"] = std_bin
    assert validate(a, s, R["locs"], CFG)["hazard_zone_breach"] >= 1
