"""Run the engine on a company's own data and store the result in the database.

    python scripts/run_company.py --name "ACME DC1" --orders orders.csv --skus sku_master.csv --locations locations.csv
    python scripts/run_company.py --validate-only ...      # just check the files
See docs/DATA_FORMAT.md for the column definitions and templates/ for examples.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.experiment import run_experiment  # noqa: E402
from core.ingest import validate  # noqa: E402
from slotdb.models import make_engine, session_factory  # noqa: E402
from slotdb.save import PublishRefused, save_run  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True, help="warehouse name shown in the dashboard")
ap.add_argument("--orders", required=True)
ap.add_argument("--skus", required=True)
ap.add_argument("--locations", required=True)
ap.add_argument("--heavy-kg", type=float, default=15.0, help="case weight above which a SKU must sit on levels 1-2")
ap.add_argument("--validate-only", action="store_true")
ap.add_argument("--fast", action="store_true", help="short solver limits (smoke test)")
a = ap.parse_args()

rep, tables = validate(pd.read_csv(a.orders), pd.read_csv(a.skus), pd.read_csv(a.locations), heavy_kg=a.heavy_kg)
print(rep.text())
if not rep.ok:
    sys.exit("\nData rejected: fix the errors above and run again. Nothing was stored.")
if a.validate_only:
    sys.exit(0)

slug = re.sub(r"[^a-z0-9]+", "_", a.name.lower()).strip("_")[:30]
R = run_experiment(f"company_{slug}", tables=tables, regen=True, n_seeds=3 if a.fast else 5, cp_time=5 if a.fast else 20,
                   ls_seconds=5 if a.fast else 30, heavy_kg=a.heavy_kg)
try:
    rid = save_run(session_factory(make_engine()), R, a.name)
except PublishRefused as e:
    sys.exit(f"\nRefused: {e}")
print(f"stored run {rid} for '{a.name}': Full layout {R['results']['Full']['ci']['return']['reduction_pct']:.1f}% less walking than random")
