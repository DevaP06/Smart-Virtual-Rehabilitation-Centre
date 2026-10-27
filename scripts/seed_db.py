"""Run the experiment(s) and store the results in the database named by DATABASE_URL (Neon Postgres in production).

    python scripts/seed_db.py                                   # both profiles, synthetic orders
    python scripts/seed_db.py --orders data/raw/online_retail_II.csv   # fulfilment centre on real orders
    python scripts/seed_db.py --profile dark_store --fast
DATABASE_URL is read from the environment or from a local .env file (never commit it).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.experiment import PROFILES, run_experiment  # noqa: E402
from slotdb.models import make_engine, session_factory  # noqa: E402
from slotdb.save import save_run  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--profile", choices=list(PROFILES), help="default: all")
ap.add_argument("--orders", help="Online Retail II CSV for the fulfilment_centre profile")
ap.add_argument("--fast", action="store_true", help="short solver time limits (smoke test)")
a = ap.parse_args()

Session = session_factory(make_engine())
for prof in ([a.profile] if a.profile else PROFILES):
    real = a.orders if prof == "fulfilment_centre" else None
    print(f"== {prof} ({'Online Retail II' if real else 'synthetic orders'})")
    R = run_experiment(prof, orders_path=real, regen=True, n_seeds=3 if a.fast else 5,
                       cp_time=5 if a.fast else 20, ls_seconds=5 if a.fast else 30)
    rid = save_run(Session, R, "Online Retail II (UCI)" if real else "synthetic (seeded)")
    print(f"saved run {rid}: best by distance = {R['best']}, total {R['timing']['total']} s")
