"""python run.py [--orders path/to/online_retail_II.csv] [--regen]"""
import argparse
import pandas as pd
from core.pipeline import run_all

ap = argparse.ArgumentParser()
ap.add_argument("--orders"); ap.add_argument("--regen", action="store_true")
a = ap.parse_args()
r = run_all(orders_path=a.orders, regen=a.regen)
pd.set_option("display.width", 200)
print(f"{len(r['skus'])} SKUs, {len(r['locs'])} bins, {r['orders'].Order_ID.nunique()} orders "
      f"(train {r['train'].Order_ID.nunique()} / test {r['test'].Order_ID.nunique()}); unplaced: {len(r['unplaced'])}")
print(r["results"].round(1).to_string())
b, o = r["results"].loc["random (feasible)"], r["results"].loc["optimized"]
print(f"\nDistance reduction vs random feasible: {100 * (1 - o.total_distance_m / b.total_distance_m):.1f}%  "
      f"| time: {100 * (1 - o.avg_route_time_s / b.avg_route_time_s):.1f}%  | fill: {b.fill_rate_pct:.1f}% -> {o.fill_rate_pct:.1f}%")
print("\nViolations by rule (naive layout):", {k: v for k, v in r["validation"]["naive (unconstrained)"].items() if v})
r["layouts"]["optimized"].to_csv("out/assignment_optimized.csv", index=False)
r["results"].to_csv("out/kpis.csv")
