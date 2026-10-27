"""Instacart Market Basket (Kaggle) -> orders and a synthetic grocery SKU master.

Real: basket composition, product names/aisles/departments, each customer's reorder rhythm (days since prior order, hour).
Synthesised (Instacart has none): calendar timestamps (each customer starts on a random day in the first 90 days, then
follows their real gaps) and physical SKU data (dimensions, weight, hazard class, handling type) from department/aisle.
"""
import os
import numpy as np
import pandas as pd

# (w, h, d cm), kg per case, hazard, handling
GROCERY = {
    "produce": ((15, 35), (10, 25), (15, 30), (0.5, 3.0), "none", "standard"),
    "chilled": ((10, 30), (8, 25), (10, 25), (0.4, 3.0), "none", "standard"),
    "eggs": ((20, 32), (8, 14), (20, 32), (0.6, 2.0), "none", "fragile"),
    "frozen": ((15, 35), (8, 25), (15, 30), (0.4, 3.0), "none", "standard"),
    "dry_goods": ((10, 30), (15, 35), (8, 20), (0.3, 3.0), "none", "standard"),
    "canned": ((15, 30), (10, 20), (15, 30), (3.0, 9.0), "none", "standard"),
    "snacks": ((15, 35), (20, 40), (8, 20), (0.2, 1.5), "none", "standard"),
    "beverages": ((15, 32), (20, 35), (10, 25), (5.0, 12.0), "none", "standard"),
    "water": ((20, 35), (25, 35), (15, 25), (15.5, 20.0), "none", "heavy"),
    "alcohol": ((15, 30), (25, 35), (10, 22), (5.0, 10.0), "none", "fragile"),
    "pet_food": ((25, 45), (30, 50), (10, 25), (15.5, 22.0), "none", "heavy"),
    "household": ((15, 35), (20, 38), (10, 25), (0.8, 6.0), "none", "standard"),
    "cleaning": ((12, 28), (20, 35), (10, 22), (1.0, 6.0), "oxidizer", "standard"),
    "candles_air": ((8, 20), (10, 25), (8, 20), (0.2, 1.5), "flammable", "standard"),
    "personal_care": ((8, 25), (12, 28), (6, 18), (0.2, 1.5), "none", "standard"),
    "baby": ((15, 40), (15, 40), (10, 30), (0.5, 5.0), "none", "standard"),
}
DEPT = {"produce": "produce", "dairy eggs": "chilled", "frozen": "frozen", "meat seafood": "chilled", "deli": "chilled",
        "bakery": "dry_goods", "pantry": "dry_goods", "breakfast": "dry_goods", "dry goods pasta": "dry_goods", "bulk": "dry_goods",
        "canned goods": "canned", "snacks": "snacks", "beverages": "beverages", "alcohol": "alcohol", "pets": "pet_food",
        "household": "household", "personal care": "personal_care", "babies": "baby"}


def grocery_category(dept, aisle):
    a = aisle.lower()
    if "air fresheners" in a or "candles" in a:
        return "candles_air"
    if "cleaning" in a or "laundry" in a:
        return "cleaning"
    if a == "eggs":
        return "eggs"
    if "water seltzer" in a:
        return "water"
    if dept == "pets" and "food" in a:
        return "pet_food"
    return DEPT.get(dept, "dry_goods")


def load_instacart(root, c, n_orders=20000, n_sku=600, seed=3):
    """Returns (orders, skus). orders has the standard four columns plus user_id and order_number for cohort analysis."""
    rng = np.random.default_rng(seed)
    o = pd.read_csv(os.path.join(root, "orders.csv"), usecols=["order_id", "user_id", "eval_set", "order_number",
                                                                  "order_hour_of_day", "days_since_prior_order"])
    o = o[o.eval_set == "prior"]
    users = rng.permutation(o.user_id.unique())
    per_user = o.groupby("user_id").size()
    take, total = [], 0
    for u in users:                                         # whole customers, so reorder rhythm and cohorts stay intact
        take.append(u); total += per_user[u]
        if total >= n_orders:
            break
    o = o[o.user_id.isin(take)].sort_values(["user_id", "order_number"]).copy()
    start = pd.Series(rng.integers(0, 90, len(take)), index=take)
    o["gap"] = o.days_since_prior_order.fillna(0)
    o["day"] = o.groupby("user_id").gap.cumsum() + o.user_id.map(start)         # per-customer running day count
    o["Timestamp"] = pd.Timestamp("2025-01-01") + pd.to_timedelta(o.day, unit="D") + pd.to_timedelta(o.order_hour_of_day, unit="h")
    keep = set(o.order_id)
    parts = []
    for ch in pd.read_csv(os.path.join(root, "order_products__prior.csv"), usecols=["order_id", "product_id"], chunksize=4_000_000):
        parts.append(ch[ch.order_id.isin(keep)])
    lines = pd.concat(parts)
    top = lines.product_id.value_counts().head(n_sku).index
    lines = lines[lines.product_id.isin(top)].drop_duplicates(["order_id", "product_id"])
    o = o[o.order_id.isin(set(lines.order_id))]
    orders = lines.merge(o[["order_id", "user_id", "order_number", "Timestamp"]], on="order_id")
    orders = orders.rename(columns={"order_id": "Order_ID", "product_id": "SKU_ID"})
    orders["Quantity"] = 1
    orders["Order_ID"] = "I" + orders.Order_ID.astype(str)
    orders["SKU_ID"] = "P" + orders.SKU_ID.astype(str)
    orders = orders[["Order_ID", "SKU_ID", "Quantity", "Timestamp", "user_id", "order_number"]].sort_values("Timestamp").reset_index(drop=True)

    p = pd.read_csv(os.path.join(root, "products.csv"))
    p = p.merge(pd.read_csv(os.path.join(root, "aisles.csv")), on="aisle_id").merge(pd.read_csv(os.path.join(root, "departments.csv")), on="department_id")
    p = p[p.product_id.isin(top)].set_index("product_id").loc[list(top)]
    rows = []
    for pid, r in p.iterrows():
        cat = grocery_category(r.department, r.aisle)
        w, h, d, kg, hz, hd = GROCERY[cat]
        rows.append(dict(SKU_ID=f"P{pid}", Width=int(rng.integers(*w)), Height=int(rng.integers(*h)), Depth=int(rng.integers(*d)),
                         Weight=round(float(rng.uniform(*kg)), 2), Category=cat, Hazard_Class=hz, Handling_Type=hd,
                         Cases=1 if hd == "heavy" else int(rng.integers(1, 4)), Name=r.product_name, Aisle=r.aisle, Department=r.department))
    return orders, pd.DataFrame(rows)
