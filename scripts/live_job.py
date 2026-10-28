"""Nightly job for the live warehouse: forecast demand, propose re-slotting moves as work orders, check layout drift and stock integrity.

    python scripts/live_job.py                 # the newest warehouse
    python scripts/live_job.py --warehouse 3
    python scripts/live_job.py --dry-run       # show what it would propose, change nothing
Runs the same code as the "Run re-slotting now" button. Scheduled by .github/workflows/nightly-reslot.yml (needs the DATABASE_URL secret).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from slotdb import live, live_jobs  # noqa: E402
from slotdb.models import make_engine, session_factory  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--warehouse", type=int)
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()

Session = session_factory(make_engine())
with Session.begin() as db:
    wh = live.get_wh(db, a.warehouse)
    out = live_jobs.run_reslot(db, wh, dry_run=a.dry_run)
    s = out["summary"]
    print(f"warehouse {wh.id} '{wh.name}': {s['proposed']} proposed ({s['swaps']} swaps, {s['relocations']} relocations), "
          f"weekly saving {s['weekly_saving']} metre-equivalents, fast sellers in far bins {100 * s['far_share']:.0f}%"
          + (" [dry run]" if a.dry_run else ""))
    if s.get("drift_alert"):
        print("ALERT:", s["drift_alert"])
