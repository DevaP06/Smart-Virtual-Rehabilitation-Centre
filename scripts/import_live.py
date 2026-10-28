"""Import your own warehouse (bins, products, optional order history and starting stock) into the live system.

    python scripts/import_live.py --name "ACME DC1" --bins bins.csv --products products.csv [--orders orders.csv] [--stock stock.csv]
    python scripts/import_live.py --validate-only ...      # only check the files
Same checks as the Setup page in the dashboard (see docs/LIVE_OPERATIONS.md for the file formats); use this for files too large for the
browser upload. Nothing is imported unless every check passes.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.live_setup import prepare  # noqa: E402
from slotdb import live  # noqa: E402
from slotdb.models import make_engine, session_factory  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True)
ap.add_argument("--bins", required=True)
ap.add_argument("--products", required=True)
ap.add_argument("--orders")
ap.add_argument("--stock")
ap.add_argument("--validate-only", action="store_true")
a = ap.parse_args()


def text(path):
    return None if not path else open(path, encoding="utf-8-sig").read()


p = prepare(text(a.bins), text(a.products), text(a.orders), text(a.stock))
print(p["report"].text())
if not p["ok"]:
    sys.exit("\nRejected: fix the errors above. Nothing was imported.")
print("\n" + ", ".join(f"{k}: {v}" for k, v in p["summary"].items()))
if a.validate_only:
    sys.exit(0)
Session = session_factory(make_engine())
with Session.begin() as db:
    wh = live.import_warehouse(db, a.name, p)
    live.review_all(db, wh)
    wid = wh.id
print(f"imported as warehouse {wid}: open the dashboard, Operations > Live Warehouse")
