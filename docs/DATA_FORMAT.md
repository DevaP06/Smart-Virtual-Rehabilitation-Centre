# Data format for your own warehouse

Three CSV files. Examples are in `templates/`. Units: centimetres, kilograms, litres, metres. Validate first:

    python scripts/run_company.py --validate-only --name "My DC" --orders orders.csv --skus sku_master.csv --locations locations.csv

Problems are listed with the CSV row numbers. **Anything that could give an unsafe or meaningless layout is an error, and nothing is stored** until it is fixed.

## orders.csv (at least 28 days of history)
`Order_ID, SKU_ID, Quantity, Timestamp`. One row per order line. Repeated (Order_ID, SKU_ID) lines are merged. Order lines for SKUs missing from the SKU master are an error above 1% of lines.

## sku_master.csv
`SKU_ID, Width, Height, Depth, Weight, Category, Hazard_Class, Handling_Type` and optional `Cases` (cases held in the pick face, default 1).
- Dimensions are of one case (cm), `Weight` is kg per case.
- `Hazard_Class`: `none`, `flammable`, `oxidizer`. Any other value is rejected because the engine cannot separate an unknown class safely.
- `Handling_Type`: `standard`, `fragile` (levels 2-4 only), `heavy` (levels 1-2 only). A case heavier than `--heavy-kg` (default 15) is treated as heavy either way.

## locations.csv (one row per bin / pick face)
`Location_ID, Zone, Aisle_Number, Rack_ID, Bay, Shelf_Level, X, Y, Z, Max_Weight_Capacity, Volumetric_Capacity, Distance_to_Dispatch_Depot, Bin_Width, Bin_Height, Bin_Depth`
- `Zone`: `STD` or `HAZ` (hazard cage). Hazardous SKUs go only in `HAZ`; others never do.
- `Shelf_Level` 1..5 (levels 3-4 are the golden zone).
- `Y` is the distance from the front cross-aisle along the aisle; `X` across aisles. Walking distance uses aisle-centre X and Y.
- Optional: `Side` (0/1), `Bin`, `AisleX`, `Beam_Cap` (kg per shelf beam), `Frame_Cap` (kg per rack frame). When absent they are derived and a warning says how.
- Aisle and bay numbers are renumbered 0-based in order.

## What you get
A run in the dashboard (layout, KPIs with confidence intervals, constraint report) and downloadable CSVs: the optimized assignment and a **move list** from your current layout to the proposed one.
Gains are *simulated* on your order history with an assumed time model. Check the assumptions (walking speed, seconds per pick) against your operation before acting on the numbers.
