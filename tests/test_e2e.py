"""End to end: run the experiment, store it in a database, read it back through the HTTP API."""
import pytest
from fastapi.testclient import TestClient

from core.experiment import LADDER, run_experiment
from slotdb.models import make_engine, session_factory
from slotdb.save import save_run


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    d = tmp_path_factory.mktemp("proc")
    import core.data as data
    orig = data.load_inputs
    # keep generated CSVs out of the repo's data/ folder
    import core.experiment as exp
    exp.load_inputs = lambda c, p, out_dir, regen: orig(c, p, out_dir=str(d), regen=True)
    try:
        yield run_experiment("dark_store", regen=True, n_seeds=2, cp_time=2, ls_seconds=2, log=lambda *_: None)
    finally:
        exp.load_inputs = orig


@pytest.fixture(scope="module")
def client(result, tmp_path_factory, monkeypatch_module):
    url = f"sqlite:///{tmp_path_factory.mktemp('db') / 'e2e.db'}"
    Session = session_factory(make_engine(url))
    save_run(Session, result, "synthetic (test)")
    monkeypatch_module.setenv("DATABASE_URL", url)
    import api.index as api
    api._engine = api._Session = None
    return TestClient(api.app)


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch
    m = MonkeyPatch()
    yield m
    m.undo()


# ---- algorithm ----
def test_every_rule_compliant_layout_has_zero_violations(result):
    for name in LADDER:
        if name != "naive":
            assert result["results"][name]["violations"]["total"] == 0, name
    assert result["unplaced"] == {k: 0 for k in result["unplaced"]}


def test_naive_layout_breaks_rules(result):
    assert result["results"]["naive"]["violations"]["total"] > 0


def test_optimized_beats_random_with_confidence(result):
    ci = result["results"]["Full"]["ci"]["return"]
    assert ci["reduction_ci_low"] > 20, ci          # lower end of the 95% CI is still a large gain
    assert result["results"]["Full"]["ci"]["s_shape"]["reduction_ci_low"] > 10


def test_ladder_orders_as_expected(result):
    d = {n: result["results"][n]["kpis"]["avg_distance_per_order_m"] for n in LADDER}
    assert d["B2_abc"] < d["B0_random"] and d["Full"] < d["B0_random"]
    assert abs(d["B1_chaotic"] - d["B0_random"]) / d["B0_random"] < 0.1


def test_affinity_pulls_pairs_together(result):
    p = {n: result["results"][n]["kpis"]["pair_distance_m"] for n in ("B0_random", "B4_affinity")}
    assert p["B4_affinity"] < p["B0_random"]


def test_reslotting_and_forecast_keep_rules(result):
    if result["reslot"]:
        assert result["reslot"]["violations"] == 0
    assert result["extra"]["cpsat"]["status"] in ("OPTIMAL", "FEASIBLE")


# ---- API ----
def test_health_and_runs(client):
    assert client.get("/api/health").json()["status"] == "ok"
    runs = client.get("/api/runs").json()
    assert len(runs) == 1 and runs[0]["profile"] == "dark_store"


def test_kpis_endpoint(client):
    k = client.get("/api/runs/1/kpis").json()
    assert set(LADDER) <= set(k)
    assert k["Full"]["violations"] == 0 and k["naive"]["violations"] > 0
    assert k["Full"]["ci"]["return"]["reduction_ci_low"] <= k["Full"]["ci"]["return"]["reduction_pct"]


def test_layout_endpoint_is_a_valid_assignment(client, result):
    rows = client.get("/api/runs/1/layout?policy=Full").json()
    assert len(rows) == result["n_skus"]
    assert len({r["loc"] for r in rows}) == len(rows)       # one SKU per bin
    assert client.get("/api/runs/1/layout?policy=nope").status_code == 404


def test_artifact_endpoints(client):
    for kind in ("eda", "forecast", "reslot", "sensitivity", "paths", "violations"):
        assert client.get(f"/api/runs/1/{kind}").status_code == 200, kind
    assert "pareto" in client.get("/api/runs/1/eda").json()
    assert client.get("/api/runs/999").status_code == 404
    assert client.get("/api/runs/1").json()["run_log"]["total"] > 0
