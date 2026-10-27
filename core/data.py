"""Builds the three input tables: warehouse grid, SKU master, orders.

Orders come from Online Retail II if its CSV is supplied, else a seeded synthetic
generator (Zipf demand + bundle baskets). SKU physical data is always synthesized
(no open dataset has it); it is seeded and derived from the product category.
"""
import os
import numpy as np
import pandas as pd

# name: (w range, h range, d range, kg range, hazard, handling, share, keywords for real descriptions)
CATS = {
    "stationery": ((5, 25), (3, 20), (2, 20), (0.1, 1.5), "none", "standard", 0.15, ("PEN", "CARD", "NOTEBOOK", "PAPER", "STICKER")),
    "home_decor": ((10, 40), (10, 40), (8, 30), (0.3, 4), "none", "standard", 0.15, ("FRAME", "HEART", "SIGN", "CUSHION", "LANTERN")),
    "kitchen": ((10, 40), (8, 30), (8, 30), (0.3, 6), "none", "standard", 0.15, ("MUG", "CAKE", "TEA", "SPOON", "BOWL", "JAR")),
    "toys": ((10, 45), (10, 35), (8, 30), (0.2, 3), "none", "standard", 0.12, ("TOY", "DOLL", "GAME", "PUZZLE")),
    "glassware": ((8, 30), (8, 30), (8, 30), (0.3, 4), "none", "fragile", 0.08, ("GLASS", "VASE", "CERAMIC", "CHINA")),
    "candles": ((6, 20), (6, 20), (6, 20), (0.2, 2), "flammable", "standard", 0.05, ("CANDLE", "INCENSE", "LIGHTER", "FIRELIGHTER")),
    "cleaning": ((10, 25), (15, 30), (8, 20), (0.5, 5), "oxidizer", "standard", 0.03, ("BLEACH", "CLEAN", "SOAP")),
    "tools_bulk": ((25, 50), (15, 30), (15, 40), (12, 25), "none", "heavy", 0.07, ("TOOL", "BRICK", "DOORSTOP", "CAST IRON", "HAMMER")),
    "textiles": ((20, 45), (10, 30), (15, 35), (0.3, 3), "none", "standard", 0.20, ("BAG", "APRON", "TOWEL", "BLANKET", "SCARF")),
}


def make_warehouse(c):
    rows = []
    for a in range(c["aisles"]):
        for side in (0, 1):
            for bay in range(c["bays"]):
                for lv in range(1, 6):
                    for b in range(c["bins"]):
                        dims = c["bin_dims"][c["level_bins"][lv - 1][b]]
                        ax, y = a * c["aisle_pitch"], c["y0"] + bay * c["bay_pitch"]
                        frame = f"R{a}-{side}-{bay:02d}"
                        rows.append(dict(
                            Location_ID=f"{frame}-L{lv}-B{b}",
                            Zone="HAZ" if a in c["haz_aisles"] else "STD",
                            Aisle_Number=a, Side=side, Rack_ID=frame, Bay=bay, Shelf_Level=lv, Bin=b,
                            X=ax + (-0.75 if side == 0 else 0.75), Y=y, Z=c["level_z"][lv - 1],
                            Bin_Width=dims[0], Bin_Height=dims[1], Bin_Depth=dims[2],
                            Volumetric_Capacity=dims[0] * dims[1] * dims[2] / 1000,
                            Max_Weight_Capacity=c["bin_cap"][lv - 1],
                            Beam_ID=f"{frame}-L{lv}", Beam_Cap=c["beam_cap"][lv - 1], Frame_Cap=c["frame_cap"],
                            AisleX=ax, Distance_to_Dispatch_Depot=ax + y,   # walk the cross-aisle, then up the aisle
                        ))
    return pd.DataFrame(rows)


def make_skus(c, sku_ids, desc=None):
    rng = np.random.default_rng(c["seed"] + 1)
    names = list(CATS)
    if desc is None:
        cat = rng.choice(names, len(sku_ids), p=[CATS[n][6] for n in names])
    else:  # keyword match on the real product description, else random category
        cat = []
        for s in sku_ids:
            d = str(desc.get(s, "")).upper()
            hit = [n for n in names if any(k in d for k in CATS[n][7])]
            cat.append(hit[0] if hit else rng.choice(names, p=[CATS[n][6] for n in names]))
    rows = []
    for s, n in zip(sku_ids, cat):
        w, h, d, kg, hz, hd, _, _ = CATS[n]
        rows.append(dict(SKU_ID=s, Width=rng.integers(*w), Height=rng.integers(*h), Depth=rng.integers(*d),
                         Weight=round(rng.uniform(*kg), 2), Category=n, Hazard_Class=hz, Handling_Type=hd,
                         Cases=1 if hd == "heavy" else int(rng.integers(1, 4))))
    return pd.DataFrame(rows)


def synth_orders(c):
    rng = np.random.default_rng(c["seed"])
    ids = np.array([f"SKU{i:04d}" for i in range(c["n_sku"])])
    pop = 1 / np.arange(1, c["n_sku"] + 1) ** 1.0
    pop = pop[rng.permutation(c["n_sku"])]
    pop /= pop.sum()
    perm = rng.permutation(c["n_sku"])                       # bundles: groups of 3-5 SKUs bought together
    groups, i = [], 0
    while i < len(perm):
        k = int(rng.integers(3, 6)); groups.append(perm[i:i + k]); i += k
    gof = {s: g for g in groups for s in g}
    t0 = pd.Timestamp("2025-01-01")
    rows = []
    for o in range(c["n_orders"]):
        seed_sku = rng.choice(c["n_sku"], p=pop)
        basket = {seed_sku}
        if rng.random() < 0.5:
            basket |= set(rng.choice(gof[seed_sku], size=min(len(gof[seed_sku]), int(rng.integers(2, 5))), replace=False))
        basket |= set(rng.choice(c["n_sku"], size=int(rng.poisson(1.5)), p=pop))
        ts = t0 + pd.Timedelta(seconds=int(o * 90 * 86400 / c["n_orders"]))
        rows += [(f"O{o:06d}", ids[s], int(rng.integers(1, 5)), ts) for s in basket]
    return pd.DataFrame(rows, columns=["Order_ID", "SKU_ID", "Quantity", "Timestamp"]), None


def load_retail(path, c):
    """Online Retail II (UCI/Kaggle) -> Order_ID, SKU_ID, Quantity, Timestamp (+ descriptions)."""
    df = pd.read_excel(path) if path.endswith("xlsx") else pd.read_csv(path)
    df = df.rename(columns={"Invoice": "Order_ID", "StockCode": "SKU_ID", "InvoiceDate": "Timestamp"})
    df["Order_ID"] = df["Order_ID"].astype(str)
    df["SKU_ID"] = df["SKU_ID"].astype(str)
    df = df[~df.Order_ID.str.startswith("C") & (df.Quantity > 0) & df.SKU_ID.str.match(r"^\d{5}")]  # drop returns, POST/M/DOT...
    keep = df.groupby("SKU_ID").size().nlargest(c["n_sku"]).index
    df = df[df.SKU_ID.isin(keep)].drop_duplicates(["Order_ID", "SKU_ID"])
    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    desc = df.drop_duplicates("SKU_ID").set_index("SKU_ID")["Description"].to_dict()
    return df[["Order_ID", "SKU_ID", "Quantity", "Timestamp"]].sort_values("Timestamp"), desc


def load_inputs(c, orders_path=None, out_dir="data/processed", regen=False):
    paths = [os.path.join(out_dir, f) for f in ("orders.csv", "skus.csv", "locations.csv")]
    if not regen and not orders_path and all(os.path.exists(p) for p in paths):
        return (pd.read_csv(paths[0], parse_dates=["Timestamp"]), pd.read_csv(paths[1]), pd.read_csv(paths[2]))
    orders, desc = load_retail(orders_path, c) if orders_path else synth_orders(c)
    skus = make_skus(c, sorted(orders.SKU_ID.unique()), desc)
    locs = make_warehouse(c)
    os.makedirs(out_dir, exist_ok=True)
    for df, p in zip((orders, skus, locs), paths):
        df.to_csv(p, index=False)
    return orders, skus, locs
