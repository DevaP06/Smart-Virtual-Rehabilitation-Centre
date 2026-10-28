"""Create the DEMO live warehouse from the data the dashboard's scenarios already use.

    python scripts/seed_live.py                       # fulfilment-centre warehouse, replaces an earlier demo warehouse
    python scripts/seed_live.py --profile dark_store  # a smaller one
    python scripts/seed_live.py --weeks 8 --keep      # keep earlier demo warehouses instead of replacing them

What it builds: the bins and SKUs of the scenario; a layout placed from demand up to four weeks before the newest order (the way a
warehouse is slotted at set-up); the most recent weeks of orders, shifted so the newest is "now"; opening stock sized from demand
(a pick face part-full, reserve for some weeks of cover); then the first re-slotting run, so Work Orders and Alerts are not empty.
The SKU sizes and the grid are the seeded synthetic ones used everywhere else; the orders are the scenario's real or synthetic orders.
DATABASE_URL is read from the environment or .env (never commit it). Re-running is safe: the previous demo warehouse is replaced.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.data import load_inputs  # noqa: E402
from core.experiment import PROFILES, profile_cfg  # noqa: E402
from core.live_setup import prepare_frames  # noqa: E402
from slotdb import live, live_jobs  # noqa: E402
from slotdb.models import Warehouse, make_engine, session_factory  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--profile", default="fulfilment_centre", choices=[p for p in PROFILES if p != "grocery"])
ap.add_argument("--weeks", type=int, default=8, help="weeks of recent order history to load")
ap.add_argument("--max-lines", type=int, default=120_000, help="cap on loaded order lines (keeps a free database small)")
ap.add_argument("--keep", action="store_true", help="keep earlier demo warehouses")
a = ap.parse_args()

c = profile_cfg(a.profile)
orders, skus, locs = load_inputs(c, None, out_dir=f"data/processed/{a.profile}", regen=False)
orders = orders.copy()
orders["Timestamp"] = pd.to_datetime(orders.Timestamp)
newest = orders.Timestamp.max()
orders["Timestamp"] += pd.Timestamp.now().floor("min") - pd.Timedelta(hours=1) - newest          # the newest order is one hour old
newest = orders.Timestamp.max()
skus = skus.copy()
skus["SKU_ID"], orders["SKU_ID"], orders["Order_ID"] = skus.SKU_ID.astype(str), orders.SKU_ID.astype(str), orders.Order_ID.astype(str)
if "Units_per_Case" not in skus.columns:
    skus["Units_per_Case"] = np.random.default_rng(c["seed"] + 3).integers(6, 25, len(skus))

recent = orders[orders.Timestamp > newest - pd.Timedelta(weeks=a.weeks)]
recent = recent[recent.SKU_ID.isin(skus.SKU_ID)]
if len(recent) > a.max_lines:                                                                   # keep whole orders, deterministic
    keep = pd.Series(recent.Order_ID.unique()).sample(frac=a.max_lines / len(recent), random_state=1)
    recent = recent[recent.Order_ID.isin(set(keep))]
layout_orders = orders[orders.Timestamp <= newest - pd.Timedelta(weeks=4)]
if layout_orders.Order_ID.nunique() < 200:
    layout_orders = orders
print(f"{a.profile}: {len(locs)} bins, {len(skus)} SKUs; layout from {len(layout_orders):,} older lines; loading {len(recent):,} recent lines")

p = prepare_frames(locs, skus, layout_orders)
if not p["ok"]:
    sys.exit(p["report"].text())
p["tables"]["orders"] = recent[["Order_ID", "SKU_ID", "Quantity", "Timestamp"]].reset_index(drop=True)

# opening stock: most pick faces 45-100% full and reserve for 14-60 days of the recent rate; a few products are deliberately low
# (about 8 faces nearly empty, about 12 products close to running out), so the first look at Work Orders and Alerts has something to show
rng = np.random.default_rng(c["seed"] + 4)
days = max(1.0, (recent.Timestamp.max() - recent.Timestamp.min()).total_seconds() / 86400)
rate = (recent.groupby("SKU_ID").Quantity.sum() / days).to_dict()
selling = sorted(rate)
low_face = set(rng.choice(selling, size=min(8, len(selling)), replace=False)) if selling else set()
low_stock = set(rng.choice(selling, size=min(12, len(selling)), replace=False)) if selling else set()
opening = []
for r in p["tables"]["skus"].itertuples(index=False):
    cap = int(r.Cases) * int(r.Units_per_Case)
    fill = rng.uniform(0.05, 0.25) if r.SKU_ID in low_face else rng.uniform(0.45, 1.0)
    opening.append((r.SKU_ID, "@FACE", max(1, int(round(cap * fill)))))
    cover = rng.uniform(1, 6) if r.SKU_ID in low_stock else rng.uniform(14, 60)
    res = int(round(rate.get(r.SKU_ID, 0.0) * cover))
    if res > 0:
        opening.append((r.SKU_ID, live.RESERVE, res))

Session = session_factory(make_engine())
with Session.begin() as db:
    if not a.keep:
        for w in db.query(Warehouse).filter(Warehouse.source == "demo").all():
            live.delete_warehouse(db, w.id)
    names = {"fulfilment_centre": "Demo fulfilment centre", "dark_store": "Demo dark store"}
    wh = live.import_warehouse(db, names.get(a.profile, a.profile), p, source="demo", opening=opening)
    live.review_all(db, wh)
    wid = wh.id
with Session.begin() as db:
    wh = live.get_wh(db, wid)
    job = live_jobs.run_reslot(db, wh)
    st = live.live_status(db, wh)
print(f"warehouse {wid} ready: {st['kpis']['bins_occupied']} of {st['kpis']['bins_total']} bins occupied, {st['kpis']['units_in_faces']:,} units in pick faces, "
      f"{st['kpis']['units_in_reserve']:,} in reserve")
print(f"first re-slotting run: {job['summary']['proposed']} proposed moves, {st['kpis']['open_replenish']} replenishments, {st['kpis']['open_alerts']} alerts")
