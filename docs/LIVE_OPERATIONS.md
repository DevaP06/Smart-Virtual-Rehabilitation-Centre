# Live operations: stock, putaway and re-slotting

The experiment pages of the dashboard show analysis computed offline. The **Operations** pages (Live Warehouse, Inventory, Receiving, Work Orders) and **Setup** run a warehouse day to day on top of the same rules and cost function.

## What it does

| Page | What it is for |
|---|---|
| **Setup** | Import your bins, products, and optionally order history and starting stock. Every row is checked; nothing is imported until all checks pass. |
| **Live Warehouse** | 3D (or 2D) view of every bin coloured by stock level, demand, low stock or open work orders. Click a bin for its contents. Refreshes every 10 s. KPIs, alerts, system health. |
| **Inventory** | Units in the pick face and in reserve per product, days of cover, status. Record a sale or a stock correction. Full movement log. CSV export. |
| **Receiving** | Book a delivery. An existing product tops up its pick face (the rest goes to reserve). A new product gets the three best legal bins, with the cost split behind the ranking. |
| **Work Orders** | Refills (reserve to pick face) raised automatically, and re-slotting moves proposed by the planner. The floor does the work, you mark it done. |

## How it works

* **One SKU, one pick face.** Each product has exactly one bin (`assignments`, unique on both product and bin, so double booking is impossible) and may also have units in `RESERVE`. Capacity of a pick face is `Cases x Units_per_Case` units.
* **Stock is the sum of movements.** `stock_movements` is append-only (receive, pick, move, adjust); `stock` is a cache of it. `GET /api/live/health` recomputes stock from the log and compares; a mismatch raises a high-severity alert. Stock cannot go below zero and a face cannot exceed its capacity.
* **Sales.** `POST /api/live/orders`: units come from the pick face first, then reserve. An order that cannot be fully served is refused and changes nothing (or, with `allow_partial`, what exists is picked and the shortfall is reported). Each accepted line is also demand history.
* **Replenishment.** When a pick face falls to 30% of capacity or less and reserve has units, a refill work order is created (once per product). Marking it done moves the units, re-checks the numbers, and closes it.
* **Alerts.** Stock-out (nothing anywhere), reorder (total at or below `ceil(units/day over 28 days x (7 + 2 days))`, or a value you set via `POST /api/live/reorder-rules`), layout drift, data integrity. They clear themselves when the cause is fixed.
* **Putaway.** `core/putaway.py` applies the same hard-rule mask as the offline engine (size, volume, weight, hazard zone, fragile/heavy levels), then the same cost: demand x distance + shelf height + wasted space + distance to bought-together products. The server re-checks the chosen bin and then runs the independent validator (`core/validate.py`) on the whole layout before saving; any violation refuses the change. A product with no sales history is scored with the median demand of its category and labelled *New item*; a missing size or weight is estimated from the category and flagged *estimated*. `tests/test_live.py` proves that placing every product with this code gives exactly the offline engine's layout.
* **Re-slotting.** `core/reslot.py`, run by the **Run re-slotting now** button or nightly (`scripts/live_job.py`, `.github/workflows/nightly-reslot.yml`). Predicted demand is a recency-weighted average of the last 8 weekly pick counts. A swap of a fast product with a slow one in a closer bin is proposed only if `(predicted lines/week difference) x (bin cost difference) > 150` metre-equivalents (two products handled); moving a fast product into a *free* closer bin must beat 75. At most 20 moves per run, every rule re-checked. The job only **proposes**: moves become work orders and the layout changes when someone marks them done, at which point the rules are checked again and an out-of-date order is closed instead of applied. Running it again replaces proposals that are still open.
* **Layout drift.** Share of "fast" products (those making up 80% of predicted pick lines) sitting in the far 40% of bins. Above 25% raises an alert.
* **Idempotency.** Writes accept `idempotency_key`; a retried request returns the first answer and is applied once.

## Setup file formats

Same columns as [DATA_FORMAT.md](DATA_FORMAT.md) (units: cm, kg, litres, metres), plus optional `Name` and `Units_per_Case` in the product file, and:

* **Order history** (optional): `Order_ID, SKU_ID, Quantity, Timestamp`. Without it products are placed by size and rules only and demand is learned from the orders recorded in the system.
* **Starting stock** (optional): `SKU_ID, Location_ID, Quantity`. A bin id in `Location_ID` says where the product sits **today** (it must already obey every rule: the independent validator checks it and rejects the file otherwise); `RESERVE` or blank means reserve. Products without a bin are placed by the engine. One bin per product, one product per bin, face quantity at most the capacity.
* A product with a blank width, height, depth or weight and a known category is imported with an **estimated** size, flagged in the report and in the tables. An unknown category cannot be estimated and is rejected.
* IDs longer than 40 characters (60 for order ids) are rejected.

Download working samples from the Setup page. Files over about 4 MB in total (a browser/Vercel limit) are imported with `python scripts/import_live.py --name "My DC" --bins ... --products ... [--orders ...] [--stock ...]`, which runs the same checks (`--validate-only` to just check).

## Demo data

`python scripts/seed_live.py` (needs `DATABASE_URL`, run it once after deploying) builds the demo warehouse from the fulfilment-centre scenario: its 4,000 bins and 1,500 products, a layout slotted from demand up to four weeks before the newest order, the last 8 weeks of orders shifted so the newest is "now", opening stock sized from demand (a few products deliberately low), and a first re-slotting run. It replaces the previous demo warehouse; `--keep` keeps it. The **Simulate 25 orders (demo)** button on the Live Warehouse page applies random orders drawn from recent demand and bought-together habits exactly like real ones.

## Honest limits

* **No login or roles.** Anyone who can open the site can record sales, receive stock or mark work orders done, and the write endpoints are public. Fine for a demo; put it behind your own access control before using real stock.
* **Row locking is Postgres-only.** `SELECT ... FOR UPDATE` stops two pickers taking the last unit on Postgres (Neon). The tests run on SQLite, which serialises writers, so the locking itself is not exercised by them.
* **Forecast.** The planner uses a recency-weighted average, not the offline LightGBM study (that needs far more history and a heavier dependency than the serverless function carries). The Forecast page still shows that study.
* **One pick face per product.** Overflow lives in an uncounted-location `RESERVE`; there is no multi-bin reserve, lot-level FEFO picking, cold chain or temperature zones. Lot and expiry are recorded on receipts only.
* **Gains are estimates.** Savings are in metre-equivalents under the assumed time model, not measured on a floor.
* **Serverless limits.** Picks, receipts and work-order actions take well under a second locally. Importing a large warehouse in one request can exceed a Vercel function's time limit: use `scripts/import_live.py`.
* **Not built:** WMS/ERP connectors, barcode scanning, drag-and-drop floor-plan editor, multi-site rollups beyond the warehouse chooser.

## API

All under `/api/live`, optional `?warehouse=<id>` (default: newest). `GET`: `/warehouses`, `/status`, `/bins`, `/inventory` (`q`, `status`, `sort`, `desc`, `limit`, `offset`, `format=csv`), `/movements`, `/tasks?status=open|all|done|stale`, `/alerts`, `/jobs`, `/health`, `/templates/{bins|products|orders|stock}.csv`. `POST`: `/orders`, `/simulate`, `/adjust`, `/receive/plan`, `/receive/confirm`, `/tasks/{id}/complete`, `/tasks/{id}/reject`, `/jobs/reslot` (`dry_run`), `/alerts/{id}/resolve`, `/reorder-rules`, `/setup/validate`, `/setup/import`. Errors are `{"detail": {"message": "...", "data": ...}}` with 404 (unknown), 409 (refused: not enough stock, rule would break, out of date) or 422 (bad input).
