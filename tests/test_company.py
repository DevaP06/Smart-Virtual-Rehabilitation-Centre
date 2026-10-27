"""A company's own data: validation must reject unsafe or meaningless input, and good data must run end to end."""
import copy

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from core.data import make_skus, make_warehouse, synth_orders
from core.experiment import profile_cfg, run_experiment
from core.ingest import validate
from slotdb.models import Run, make_engine, session_factory
from slotdb.save import PublishRefused, save_run

C = profile_cfg("dark_store")


@pytest.fixture(scope="module")
def raw():
    orders, _ = synth_orders(C)
    skus = make_skus(C, sorted(orders.SKU_ID.unique()))
    return orders, skus, make_warehouse(C)


def check(raw, mutate=None):
    o, s, l = (t.copy() for t in raw)
    if mutate:
        o, s, l = mutate(o, s, l)
    return validate(o, s, l)


def messages(rep):
    return " | ".join(e["message"] for e in rep.errors)


def test_clean_data_is_accepted(raw):
    rep, (o, s, l) = check(raw)
    assert rep.ok, rep.text()
    assert l.Aisle_Number.min() == 0 and l.Bay.min() == 0                 # renumbered 0-based
    assert {"Beam_ID", "Side", "Bin"} <= set(l.columns) and "Cases" in s.columns


def test_missing_columns_rejected(raw):
    rep, _ = check(raw, lambda o, s, l: (o, s.drop(columns=["Weight"]), l))
    assert not rep.ok and "Weight" in messages(rep)


def test_unknown_hazard_class_rejected_with_row_numbers(raw):
    def m(o, s, l):
        s.loc[3, "Hazard_Class"] = "explosive"
        return o, s, l
    rep, _ = check(raw, m)
    assert not rep.ok and "Hazard_Class" in messages(rep)
    assert 5 in [r for e in rep.errors for r in (e["rows"] or [])]       # row 3 -> CSV line 5 (header + 1-based)


def test_duplicate_ids_rejected(raw):
    rep, _ = check(raw, lambda o, s, l: (o, pd.concat([s, s.head(1)]), l))
    assert not rep.ok and "duplicate SKU_ID" in messages(rep)
    rep, _ = check(raw, lambda o, s, l: (o, s, pd.concat([l, l.head(1)])))
    assert not rep.ok and "duplicate Location_ID" in messages(rep)


def test_orders_for_unknown_skus(raw):
    def many(o, s, l):
        return o, s.iloc[:400], l                         # drops a quarter of the SKUs: far over the 1% limit
    rep, _ = check(raw, many)
    assert not rep.ok and "missing from the SKU master" in messages(rep)

    def few(o, s, l):
        o = o.copy(); o.loc[o.index[:20], "SKU_ID"] = "GHOST"
        return o, s, l
    rep, (o, *_) = check(raw, few)
    assert rep.ok and any("dropped" in w["message"] for w in rep.warnings) and "GHOST" not in set(o.SKU_ID)


def test_too_little_history_rejected(raw):
    rep, _ = check(raw, lambda o, s, l: (o[o.Timestamp < o.Timestamp.min() + pd.Timedelta(days=10)], s, l))
    assert not rep.ok and "28" in messages(rep)


def test_unstorable_sku_rejected(raw):
    def m(o, s, l):
        s.loc[0, ["Width", "Height", "Depth"]] = [500, 500, 500]
        return o, s, l
    rep, _ = check(raw, m)
    assert not rep.ok and "exceeds the largest bin" in messages(rep)


def test_hazard_without_hazard_cage_rejected(raw):
    rep, _ = check(raw, lambda o, s, l: (o, s, l.assign(Zone="STD")))
    assert not rep.ok and "HAZ" in messages(rep)


def test_more_skus_than_bins_rejected(raw):
    rep, _ = check(raw, lambda o, s, l: (o, s, l.sample(500, random_state=0)))
    assert not rep.ok and "bins" in messages(rep)


@pytest.fixture(scope="module")
def run(raw):
    rep, tables = check(raw)
    assert rep.ok
    return run_experiment("company_test", tables=tables, regen=True, n_seeds=2, cp_time=2, ls_seconds=2, log=lambda *_: None)


def test_company_run_end_to_end(run, tmp_path):
    assert run["results"]["Full"]["violations"]["total"] == 0
    Session = session_factory(make_engine(f"sqlite:///{tmp_path / 'c.db'}"))
    rid = save_run(Session, run, "ACME test")
    with Session() as s:
        assert s.get(Run, rid).dataset == "ACME test" and s.get(Run, rid).profile == "company_test"


def test_unsafe_run_is_not_published(run, tmp_path):
    bad = copy.deepcopy(run)
    bad["results"]["Full"]["violations"]["total"] = 3
    Session = session_factory(make_engine(f"sqlite:///{tmp_path / 'f.db'}"))
    with pytest.raises(PublishRefused):
        save_run(Session, bad, "ACME unsafe")
    with Session() as s:
        assert s.query(Run).count() == 0                  # fail closed: nothing stored

    unplaced = copy.deepcopy(run)
    unplaced["unplaced"]["Full"] = 2
    with pytest.raises(PublishRefused):
        save_run(Session, unplaced, "ACME unplaced")


def test_moves_export(run, tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    save_run(session_factory(make_engine(url)), run, "ACME")
    monkeypatch.setenv("DATABASE_URL", url)
    import api.index as api
    api._engine = api._Session = None
    c = TestClient(api.app)
    r = c.get("/api/runs/1/moves?from=B0_random&to=Full")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("priority,sku_id") and len(lines) > 100
    j = c.get("/api/runs/1/moves?from=B0_random&to=Full&format=json").json()
    assert j["n_moves"] == len(lines) - 1
    assert all(m["from_location"] != m["to_location"] for m in j["moves"])
    a = c.get("/api/runs/1/assignment?policy=Full").text.strip().splitlines()
    assert len(a) - 1 == run["n_skus"]
    assert c.get("/api/runs/1/moves?to=nope").status_code == 404
