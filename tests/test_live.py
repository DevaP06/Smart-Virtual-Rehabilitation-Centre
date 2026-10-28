"""Live operations: setup checks, putaway, stock rules, replenishment, re-slotting, reconciliation and the HTTP API."""
import io
import shutil
from datetime import timedelta

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from core.data import make_skus, make_warehouse, synth_orders
from core.engine import State, World, assign_full, cooc, partners, velocity
from core.experiment import profile_cfg
from core.live_setup import RESERVE, live_config, prepare, prepare_frames, sample_files
from core.putaway import feasible, place_skus, recommend
from core.reslot import propose
from core.validate import validate as rule_check
from slotdb import live, live_jobs
from slotdb.models import Assignment, Stock, StockMovement, Task, make_engine, session_factory

C = profile_cfg("dark_store")


@pytest.fixture(scope="module")
def tables():
    orders, _ = synth_orders(C)
    skus = make_skus(C, sorted(orders.SKU_ID.unique()))
    skus["Units_per_Case"] = np.random.default_rng(1).integers(6, 25, len(skus))
    orders["Timestamp"] += pd.Timestamp.now().floor("min") - orders.Timestamp.max()       # newest order = now
    return orders, skus, make_warehouse(C)


@pytest.fixture(scope="module")
def base_db(tables, tmp_path_factory):
    """A stocked demo-size warehouse in a SQLite file; each test copies it, so tests cannot affect each other."""
    orders, skus, locs = tables
    p = prepare_frames(locs, skus, orders)
    assert p["ok"], p["report"].text()
    path = tmp_path_factory.mktemp("live") / "base.db"
    S = session_factory(make_engine(f"sqlite:///{path}"))
    with S.begin() as db:
        wh = live.import_warehouse(db, "Test DC", p, opening=[(s, "@FACE", max(1, int(0.8 * int(c) * int(u)))) for s, c, u in zip(skus.SKU_ID, skus.Cases, skus.Units_per_Case)]
                                   + [(s, RESERVE, 60) for s in skus.SKU_ID])
        live.review_all(db, wh)
    return path


@pytest.fixture
def S(base_db, tmp_path):
    p = tmp_path / "t.db"
    shutil.copy(base_db, p)
    return session_factory(make_engine(f"sqlite:///{p}"))


@pytest.fixture
def client(S, monkeypatch, tmp_path):
    url = f"sqlite:///{tmp_path / 't.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    import api.index as api
    api._engine = api._Session = None
    return TestClient(api.app)


def warehouse(S):
    with S() as db:
        return live.get_wh(db)


# ------------------------------------------------------------------------------------------------ setup checks

def test_sample_files_import_cleanly():
    f = sample_files()
    p = prepare(f["bins"], f["products"], f["orders"], f["stock"])
    assert p["ok"], p["report"].text()
    assert p["summary"]["skus"] == 10 and p["summary"]["rule_violations"] == 0 and p["summary"]["placed_by_engine"] == 10


def test_setup_reports_problems_with_line_numbers():
    f = sample_files()
    bad = f["products"].replace("flammable", "explosive", 1)
    p = prepare(f["bins"], bad)
    assert not p["ok"]
    err = next(e for e in p["report"].errors if "Hazard_Class" in e["message"])
    assert err["table"] == "sku_master" and err["rows"]
    assert not prepare(None, f["products"])["ok"]                                   # bins file is required
    assert not prepare(f["bins"], f["products"].replace("SKU_ID", "Code", 1))["ok"]   # missing column


def test_over_long_ids_are_rejected_before_they_can_break_the_database():
    f = sample_files()
    p = prepare(f["bins"], f["products"].replace("A100", "A" * 60, 1))
    assert not p["ok"] and any("longer than 40" in e["message"] for e in p["report"].errors)


def test_missing_size_is_estimated_and_flagged_not_guessed_silently():
    f = sample_files()
    rows = f["products"].splitlines()
    cells = rows[1].split(",")
    cells[2] = ""                                                   # Width of the first product left blank
    rows[1] = ",".join(cells)
    p = prepare(f["bins"], "\n".join(rows))
    assert p["ok"] and p["summary"]["estimated"] == 1
    assert any("ESTIMATED" in w["message"] for w in p["report"].warnings)
    assert p["tables"]["skus"].Estimated.sum() == 1
    cells[6] = "no_such_category"                                   # unknown category: cannot be estimated, so rejected
    rows[1] = ",".join(cells)
    assert not prepare(f["bins"], "\n".join(rows))["ok"]


def test_stock_file_checks():
    f = sample_files()
    bins = pd.read_csv(io.StringIO(f["bins"]))
    std = bins[bins.Zone == "STD"].Location_ID.tolist()
    ok = f"SKU_ID,Location_ID,Quantity\nA100,{std[0]},10\nA100,RESERVE,30\n"
    assert prepare(f["bins"], f["products"], None, ok)["ok"]
    assert not prepare(f["bins"], f["products"], None, f"SKU_ID,Location_ID,Quantity\nA100,{std[0]},10\nA101,{std[0]},5\n")["ok"]    # two SKUs, one bin
    assert not prepare(f["bins"], f["products"], None, f"SKU_ID,Location_ID,Quantity\nA100,{std[0]},9999\n")["ok"]                   # over capacity
    assert not prepare(f["bins"], f["products"], None, "SKU_ID,Location_ID,Quantity\nA100,NOWHERE,1\n")["ok"]                        # unknown bin
    assert not prepare(f["bins"], f["products"], None, "SKU_ID,Location_ID,Quantity\nGHOST,RESERVE,1\n")["ok"]                       # unknown SKU
    haz = bins[bins.Zone == "HAZ"].Location_ID.iloc[0]
    r = prepare(f["bins"], f["products"], None, f"SKU_ID,Location_ID,Quantity\nA100,{haz},1\n")                                       # non-hazard SKU in the cage
    assert not r["ok"] and any("breaks rules" in e["message"] for e in r["report"].errors)


# ------------------------------------------------------------------------------------------------ engine reuse

def test_placement_matches_the_offline_engine(tables):
    """Putaway uses the offline placer's rules and cost: placing every SKU with place_skus equals assign_full(mode='opt')."""
    orders, skus, locs = tables
    c = {**live_config(), "n_sku": 0}
    vel = velocity(orders)
    part = partners(cooc(orders, c["max_basket"]), c["topk"])
    w = World(skus, locs, c)
    st_ref, _ = assign_full(skus, locs, vel, part, c, "opt", world=w)
    st = State(w)
    order = list(vel.sort_values(ascending=False, kind="stable").index) + [s for s in skus.SKU_ID if s not in vel.index]
    left = place_skus(w, st, c, vel, part, order)
    assert not left
    assert {s: w.loc_ids[j] for s, j in st.placed.items()} == {s: w.loc_ids[j] for s, j in st_ref.placed.items()}


def test_recommend_only_returns_legal_bins_cheapest_first(S):
    with S() as db:
        wh = live.get_wh(db)
        row = dict(sku_id="NEWHAZ", name="", width=10, height=10, depth=10, weight=1.0, category="candles", hazard="flammable", handling="standard",
                   cases=1, units_per_case=4, dims_estimated=False)
        ctx = live.load_ctx(db, wh, extra_sku=row)
        vel, _ = live.demand_window(db, wh)
        opts, why = recommend(ctx.w, ctx.st, ctx.c, vel, live.get_partners(db, wh), "NEWHAZ", k=3)
        assert 1 <= len(opts) <= 3 and not why
        assert [o["total"] for o in opts] == sorted(o["total"] for o in opts)
        assert all(feasible(ctx.w, ctx.st, "NEWHAZ", o["loc"]) for o in opts)
        zone = dict(zip(ctx.locs.Location_ID, ctx.locs.Zone))
        assert all(zone[o["loc"]] == "HAZ" for o in opts)                               # hazardous goes only in the cage
        huge = dict(row, sku_id="HUGE", width=400, height=400, depth=400)
        ctx2 = live.load_ctx(db, wh, extra_sku=huge)
        opts, why = recommend(ctx2.w, ctx2.st, ctx2.c, vel, {}, "HUGE")
        assert not opts and why and "large enough" in why[0]


# ------------------------------------------------------------------------------------------------ stock rules

def test_pick_receive_and_the_movement_log_always_reconcile(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        live.pick_orders(db, wh, [dict(lines=[("SKU0001", 5), ("SKU0002", 2)])])
        live.receive_confirm(db, wh, "SKU0001", 10)
        live.adjust_stock(db, wh, "SKU0002", RESERVE, -3, "cycle count")
    with S() as db:
        wh = live.get_wh(db)
        assert live.warehouse_health(db, wh)["ok"]
        mv = live.movements(db, wh, sku="SKU0001", limit=10)
        assert {m["type"] for m in mv} >= {"pick", "receive"}


def test_stock_never_goes_negative_and_refusals_change_nothing(S):
    with S() as db:
        wh = live.get_wh(db)
        before = db.query(StockMovement).count(), sum(r.qty for r in db.query(Stock))
        with pytest.raises(live.Conflict):
            live.pick_orders(db, wh, [dict(lines=[("SKU0001", 5), ("SKU0002", 10 ** 6)])])       # second line cannot be served
        db.rollback()
        assert (db.query(StockMovement).count(), sum(r.qty for r in db.query(Stock))) == before
        with pytest.raises(live.Conflict):
            live.adjust_stock(db, wh, "SKU0001", RESERVE, -10 ** 5, "oops")
        with pytest.raises(live.LiveError):
            live.adjust_stock(db, wh, "SKU0001", RESERVE, -1, "   ")                          # a reason is required
        with pytest.raises(live.NotFound):
            live.pick_orders(db, wh, [dict(lines=[("NOPE", 1)])])
        with pytest.raises(live.LiveError):
            live.pick_orders(db, wh, [dict(lines=[("SKU0001", 0)])])


def test_pick_face_is_capped_and_overflow_goes_to_reserve(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        sku = db.query(live.Sku).filter_by(sku_id="SKU0001").one()
        cap = sku.cases * sku.units_per_case
        face = db.query(Stock).filter(Stock.sku_id == "SKU0001", Stock.location != RESERVE).one().qty
        out = live.receive_confirm(db, wh, "SKU0001", 500)
        assert out["to_face"] == cap - face and out["to_reserve"] == 500 - (cap - face)


def test_picks_use_the_face_then_the_reserve_and_trigger_replenishment(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        face = db.query(Stock).filter(Stock.sku_id == "SKU0003", Stock.location != RESERVE).one().qty
        res = live.pick_orders(db, wh, [dict(lines=[("SKU0003", face + 5)])])                   # 5 more than the face holds
        line = res[0]["lines"][0]
        assert line["picked"] == face + 5 and line["from_reserve"] == 5
    with S() as db:
        wh = live.get_wh(db)
        tasks = [t for t in live.list_tasks(db, wh) if t["type"] == "replenish" and t["items"][0]["sku"] == "SKU0003"]
        assert len(tasks) == 1
    with S.begin() as db:
        wh = live.get_wh(db)
        live.pick_orders(db, wh, [dict(lines=[("SKU0003", 1)])])                                # again: no second open task for the same SKU
    with S.begin() as db:
        wh = live.get_wh(db)
        assert len([t for t in live.list_tasks(db, wh) if t["items"][0]["sku"] == "SKU0003" and t["type"] == "replenish"]) == 1
        t = [t for t in live.list_tasks(db, wh) if t["items"][0]["sku"] == "SKU0003"][0]
        assert live.complete_task(db, wh, t["id"])["status"] == "done"
        with pytest.raises(live.Conflict):
            live.complete_task(db, wh, t["id"])                                                 # cannot be completed twice
    with S() as db:
        assert live.warehouse_health(db, live.get_wh(db))["ok"]


def test_stockout_alert_raised_and_cleared(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        total = db.query(Stock).filter_by(sku_id="SKU0004").with_entities(Stock.qty).all()
        live.pick_orders(db, wh, [dict(lines=[("SKU0004", sum(q for (q,) in total))])])
    with S.begin() as db:
        wh = live.get_wh(db)
        assert any(a["kind"] == "stockout" and "SKU0004" in a["message"] for a in live.alerts_list(db, wh))
        live.receive_confirm(db, wh, "SKU0004", 400)
    with S() as db:
        assert not any(a["kind"] == "stockout" and "SKU0004" in a["message"] for a in live.alerts_list(db, live.get_wh(db)))


def test_idempotent_replay_applies_once(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        f = lambda: live.pick_orders(db, wh, [dict(lines=[("SKU0005", 4)])])[0]
        a = live.replay_or_run(db, "k-1", f)
        b = live.replay_or_run(db, "k-1", f)
        assert a == b
    with S() as db:
        picks = [m for m in live.movements(db, live.get_wh(db), sku="SKU0005") if m["type"] == "pick"]
        assert sum(m["qty"] for m in picks) == 4


# ------------------------------------------------------------------------------------------------ receiving new products

def test_new_product_gets_a_legal_bin_and_cannot_double_book(S):
    new = dict(category="kitchen", width=20, height=10, depth=10, weight=1.2, cases=1, units_per_case=12)
    with S.begin() as db:
        wh = live.get_wh(db)
        plan = live.receive_plan(db, wh, "NEW1", 100, new_sku=new)
        assert plan["mode"] == "new_face" and plan["new_item"] and len(plan["options"]) == 3
        bin_ = plan["options"][0]["loc"]
        out = live.receive_confirm(db, wh, "NEW1", 100, loc=bin_, new_sku=new)
        assert out["new_pick_face"] and out["to_face"] == 12 and out["to_reserve"] == 88
        assert live.receive_plan(db, wh, "NEW1", 5)["mode"] == "top_up"
    for sku, where in (("NEW2", bin_), ("NEW3", "NOT-A-BIN")):                                   # a taken bin and a made-up bin are both refused
        with S() as db:
            with pytest.raises(live.Conflict):
                live.receive_confirm(db, live.get_wh(db), sku, 10, loc=where, new_sku=new)
    with S() as db:
        wh = live.get_wh(db)
        with pytest.raises(live.LiveError):
            live.receive_plan(db, wh, "NEW4", 10, new_sku=dict(new, hazard="plutonium"))
        assert live.receive_plan(db, wh, "NEW5", 10)["mode"] == "unknown_sku"
    with S() as db:
        wh = live.get_wh(db)
        locs, skus, asg = live.bins_frame(db, wh.id), live.skus_frame(db, wh.id), live.assignment_frame(db, wh.id)
        v = rule_check(asg, skus, locs, wh.config)
        assert v["total"] == 0 and len(asg) == len(skus) and asg.Location_ID.is_unique


def test_new_product_with_estimated_size_is_flagged(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        plan = live.receive_plan(db, wh, "EST1", 10, new_sku=dict(category="toys"))             # no size, known category
        assert plan["estimated_dims"] is True and plan["options"]
        live.receive_confirm(db, wh, "EST1", 10, loc=plan["options"][0]["loc"], new_sku=dict(category="toys"))
        assert db.query(live.Sku).filter_by(sku_id="EST1").one().dims_estimated is True
        with pytest.raises(live.LiveError):
            live.receive_plan(db, wh, "EST2", 10, new_sku=dict(category="mystery"))             # cannot estimate an unknown category


def test_a_full_pick_face_never_gets_a_refill_order(S):
    """A product whose whole pick face is one unit (so it is always 'low') must not generate refills of zero units."""
    one = dict(category="toys", width=20, height=10, depth=15, weight=1.0, cases=1, units_per_case=1)
    with S.begin() as db:
        wh = live.get_wh(db)
        plan = live.receive_plan(db, wh, "ONE1", 40, new_sku=one)
        live.receive_confirm(db, wh, "ONE1", 40, loc=plan["options"][0]["loc"], new_sku=one)
    with S() as db:
        wh = live.get_wh(db)
        assert not [t for t in live.list_tasks(db, wh) if t["items"][0]["sku"] == "ONE1"]
        assert all(t["items"][0]["qty"] > 0 for t in live.list_tasks(db, wh) if t["type"] == "replenish")


def test_expiry_must_be_a_date(S):
    with S.begin() as db:
        wh = live.get_wh(db)
        with pytest.raises(live.LiveError):
            live.receive_confirm(db, wh, "SKU0001", 1, expiry="soon")
        live.receive_confirm(db, wh, "SKU0001", 1, lot="L7", expiry="2027-01-31")


# ------------------------------------------------------------------------------------------------ re-slotting

def _drift(S):
    """Make a far-placed, low-demand product suddenly hot (as a promotion would)."""
    with S.begin() as db:
        wh = live.get_wh(db)
        ctx = live.load_ctx(db, wh)
        w = ctx.w
        far = max((s for s in ctx.st.placed if w.hz[s] == "none"), key=lambda s: w.slot_cost[ctx.st.placed[s]])
        now = live.utcnow()
        db.execute(live.insert(live.OrderLine), [dict(warehouse_id=wh.id, order_id=f"P{i}", sku_id=far, qty=1, ts=now - timedelta(hours=i % 48), source="live")
                                                 for i in range(300)])
    return far


def test_reslot_proposes_the_hot_far_product_and_keeps_the_rules(S):
    far = _drift(S)
    with S.begin() as db:
        wh = live.get_wh(db)
        dry = live_jobs.run_reslot(db, wh, dry_run=True)
        assert any(far in (m["a"], m["b"]) for m in dry["moves"]) and dry["job_id"] is None
        assert db.query(Task).filter_by(type="move").count() == 0                              # a dry run leaves nothing behind
    with S.begin() as db:
        wh = live.get_wh(db)
        out = live_jobs.run_reslot(db, wh)
        assert out["summary"]["proposed"] >= 1 and out["summary"]["proposed"] <= wh.config["live"]["reslot_budget"]
        assert all(m["net_saving"] > 0 for m in out["moves"])                                  # only moves that pay for themselves
    with S.begin() as db:
        wh = live.get_wh(db)
        moves = [t for t in live.list_tasks(db, wh) if t["type"] == "move"]
        hot = next(t for t in moves if far in [i["sku"] for i in t["items"]])
        done = live.complete_task(db, wh, hot["id"])
        assert done["status"] == "done"
        new = {a.sku_id: a.loc_id for a in db.query(Assignment)}
        for i in hot["items"]:
            assert new[i["sku"]] == i["to_loc"]
    with S() as db:
        wh = live.get_wh(db)
        locs, skus, asg = live.bins_frame(db, wh.id), live.skus_frame(db, wh.id), live.assignment_frame(db, wh.id)
        assert rule_check(asg, skus, locs, wh.config)["total"] == 0 and asg.Location_ID.is_unique
        assert live.warehouse_health(db, wh)["ok"]


def test_stale_work_order_is_closed_not_applied(S):
    far = _drift(S)
    with S.begin() as db:
        live_jobs.run_reslot(db, live.get_wh(db))
    with S.begin() as db:
        wh = live.get_wh(db)
        task = next(t for t in live.list_tasks(db, wh) if t["type"] == "move" and far in [i["sku"] for i in t["items"]])
        ctx = live.load_ctx(db, wh)
        free = ctx.w.loc_ids[next(j for j in range(ctx.w.m) if ctx.st.free[j])]
        db.query(Assignment).filter_by(sku_id=far).update({"loc_id": str(free)})                 # the floor moved it in the meantime
    with S() as db:
        wh = live.get_wh(db)
        with pytest.raises(live.Stale):
            live.complete_task(db, wh, task["id"])
        db.commit()                                                                              # the API route keeps the closing of the work order
    with S() as db:
        wh = live.get_wh(db)
        assert task["id"] not in [t["id"] for t in live.list_tasks(db, wh)]
        assert task["id"] in [t["id"] for t in live.list_tasks(db, wh, status="stale")]
        assert db.query(Assignment).filter_by(sku_id=far).one().loc_id == str(free)               # and nothing was moved


def test_rerunning_replaces_open_proposals(S):
    _drift(S)
    for _ in range(2):
        with S.begin() as db:
            live_jobs.run_reslot(db, live.get_wh(db))
    with S() as db:
        last_job = max(t.job_id for t in db.query(Task).filter_by(type="move"))
        assert {t.job_id for t in db.query(Task).filter_by(type="move", status="open")} == {last_job}


def test_propose_leaves_the_state_unchanged(S):
    with S() as db:
        wh = live.get_wh(db)
        ctx = live.load_ctx(db, wh)
        before = dict(ctx.st.placed)
        pred, _ = live.weekly_prediction(db, wh)
        propose(ctx.w, ctx.st, pred, budget=5)
        assert ctx.st.placed == before


def test_reconcile_detects_a_stock_number_changed_without_a_movement(S):
    with S.begin() as db:
        r = db.query(Stock).filter_by(sku_id="SKU0001").first()
        r.qty += 7                                                                              # tampering outside the movement log
    with S.begin() as db:
        wh = live.get_wh(db)
        h = live.warehouse_health(db, wh)
        assert not h["ok"] and h["n_mismatches"] == 1
        live_jobs.run_reslot(db, wh)                                                           # the nightly job raises the alert
        assert any(a["kind"] == "reconcile" and a["severity"] == "high" for a in live.alerts_list(db, wh))


# ------------------------------------------------------------------------------------------------ HTTP API

def test_api_status_inventory_and_errors(client):
    s = client.get("/api/live/status").json()
    assert s["kpis"]["bins_occupied"] == len(s["bins"]) == s["kpis"]["skus"]
    assert len(client.get("/api/live/bins").json()) == s["kpis"]["bins_total"]
    inv = client.get("/api/live/inventory?limit=5&sort=total&desc=true").json()
    assert inv["total"] == s["kpis"]["skus"] and len(inv["rows"]) == 5
    assert client.get("/api/live/inventory?format=csv").text.startswith("sku,name,category")
    bad = client.post("/api/live/orders", json={"lines": [{"sku": "SKU0001", "qty": 10 ** 7}]})
    assert bad.status_code == 422
    r = client.post("/api/live/orders", json={"lines": [{"sku": "SKU0001", "qty": 10 ** 5}]})
    assert r.status_code == 409 and r.json()["detail"]["message"].startswith("Not enough stock")
    assert client.post("/api/live/orders", json={"lines": [{"sku": "NOPE", "qty": 1}]}).status_code == 404
    assert client.get("/api/live/status?warehouse=999").status_code == 404


def test_api_order_receive_and_task_flow(client):
    r = client.post("/api/live/orders", json={"lines": [{"sku": "SKU0007", "qty": 2}], "idempotency_key": "abc"})
    assert r.status_code == 200 and r.json()["lines"][0]["picked"] == 2
    assert client.post("/api/live/orders", json={"lines": [{"sku": "SKU0007", "qty": 2}], "idempotency_key": "abc"}).json() == r.json()
    new = {"category": "toys", "width": 20, "height": 10, "depth": 15, "weight": 1.0, "cases": 1, "units_per_case": 10}
    plan = client.post("/api/live/receive/plan", json={"sku": "T1", "qty": 30, "new_sku": new}).json()
    assert plan["mode"] == "new_face" and plan["options"]
    ok = client.post("/api/live/receive/confirm", json={"sku": "T1", "qty": 30, "loc": plan["options"][0]["loc"], "new_sku": new})
    assert ok.status_code == 200 and ok.json()["new_pick_face"]
    again = client.post("/api/live/receive/confirm", json={"sku": "T2", "qty": 30, "loc": plan["options"][0]["loc"], "new_sku": new})
    assert again.status_code == 409
    assert client.post("/api/live/simulate", json={"orders": 10, "seed": 2}).json()["orders"] == 10
    assert client.post("/api/live/jobs/reslot", json={"dry_run": True}).status_code == 200
    tasks = client.get("/api/live/tasks").json()
    rep = next((t for t in tasks if t["type"] == "replenish"), None)
    if rep:
        assert client.post(f"/api/live/tasks/{rep['id']}/complete").json()["status"] == "done"
        assert client.post(f"/api/live/tasks/{rep['id']}/complete").status_code == 409
    assert client.get("/api/live/health").json()["integrity"]["ok"]


def test_api_setup_wizard_end_to_end(client):
    f = sample_files()
    body = dict(bins_csv=f["bins"], skus_csv=f["products"], orders_csv=f["orders"], stock_csv=f["stock"], name="Sample DC")
    v = client.post("/api/live/setup/validate", json=body).json()
    assert v["ok"] and v["summary"]["skus"] == 10
    bad = client.post("/api/live/setup/validate", json={**body, "skus_csv": f["products"].replace("flammable", "explosive", 1)}).json()
    assert not bad["ok"] and bad["errors"]
    refused = client.post("/api/live/setup/import", json={**body, "skus_csv": f["products"].replace("flammable", "explosive", 1)})
    assert refused.status_code == 409
    n_before = len(client.get("/api/live/warehouses").json())
    done = client.post("/api/live/setup/import", json={**body, "idempotency_key": "setup-1"})
    assert done.status_code == 200
    again = client.post("/api/live/setup/import", json={**body, "idempotency_key": "setup-1"})
    assert again.json() == done.json()
    assert len(client.get("/api/live/warehouses").json()) == n_before + 1                        # imported once
    wid = done.json()["warehouse"]
    st = client.get(f"/api/live/status?warehouse={wid}").json()
    assert st["kpis"]["skus"] == 10 and st["kpis"]["bins_total"] == 120
    r = client.post(f"/api/live/orders?warehouse={wid}", json={"lines": [{"sku": "A100", "qty": 5}]})
    assert r.status_code == 200
    assert client.get("/api/live/templates/products.csv").status_code == 200
    assert client.get("/api/live/templates/nothing.csv").status_code == 404
