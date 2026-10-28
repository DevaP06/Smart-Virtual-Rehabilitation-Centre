# Manager's quick start

For a warehouse or operations manager. No technical knowledge needed. The dashboard has two halves: **Operations** (run the warehouse today) and **Results** (prove the value and review the method).

## 1. First day: load your warehouse (Setup)

1. Open **Setup** and download the four sample files. Fill in your own copies:
   * **Bins**: one row per pick face (where it is, its size, weight rating, hazard cage or not).
   * **Products**: size, weight, category, hazard class, handling (standard, fragile, heavy).
   * **Order history** *(optional)*: past order lines. Lets the system put fast sellers near dispatch.
   * **Starting stock** *(optional)*: units on hand, and the bin each product sits in today.
2. Choose the files and press **Check my files**. Problems are listed with line numbers ("line 42: unknown hazard class"). A product with no size can be estimated from its category and is flagged *estimated*. Fix and check again.
3. Press **Import**. Every product without a bin is placed in a legal one. Nothing is imported until every check passes.

## 2. Every day

| Do this | Where | What happens |
|---|---|---|
| See the state of the floor | **Live Warehouse** | Five numbers (bins in use, units, low pick faces, open work, alerts) and a 3D view of every bin coloured by stock. Click a bin to see its product. |
| Record a sale | **Inventory** > Record a sale | Units come from the pick face first, then reserve. Refused if there is not enough stock. |
| Fix a count | **Inventory** > Correct stock | A reason is required. Every change is in the movement log. |
| Book a delivery | **Receiving** | Known product: tops up its pick face, overflow goes to reserve. New product: enter its size and weight, get the three best bins and the reason for each, confirm one. |
| Do the floor jobs | **Work Orders** | Refills ("take 24 units from reserve to bin R2-1-05-L3"). Press **Mark done** when finished. |
| Watch for trouble | **Live Warehouse** > Alerts | Stock-outs, items at their reorder point, layout drift, data-integrity problems. |

## 3. Every week (or night): keep the layout good

1. Open **Work Orders** and press **Preview moves**. It lists swaps and moves with the estimated weekly walking saving of each. Moves are only proposed when the saving is bigger than the cost of the move.
2. Press **Run re-slotting now** to turn them into work orders (or let the nightly job do it).
3. Send the moves to the floor team. When a move is physically done, press **Mark done**: the layout and the stock update, and the rules are re-checked. **Reject** the ones you don't want.

The system never moves anything on its own: the layout only changes when you mark a move done.

## 4. When you need the business case

* **Business Impact**: enter orders per day, picker cost per hour and operating days. It turns the walking saved into hours and money. Every figure is an estimate that follows from your inputs.
* **Overview**: the headline results, with confidence intervals, on orders the layout never saw.
* **Warehouse Layout / Pick Path Simulator**: before-and-after pictures and an animated pick for the floor team and leadership.
* **Constraints**: proof that every safety and capacity rule is satisfied, for compliance.
* **Optimization Trade-offs**: choose what the layout should favour (shortest walks, comfortable shelf height, snug bins) and see the cost.

## 5. Read this before relying on it

* **No login yet.** Anyone with the link can record sales, receive stock or mark work orders done. Put it behind your own access control before using real stock.
* **Savings are simulated estimates**, not measured on your floor. Run a pilot on one zone and compare picker time before and after.
* **The demo warehouse** uses real orders but synthetic product sizes and a synthetic floor layout. Your own data replaces it through Setup.
* **Not covered yet:** barcode scanning, a connection to an existing WMS or ERP, temperature-controlled storage.
* Large files (over about 4 MB in total) are imported with a script instead of the browser: see [LIVE_OPERATIONS.md](LIVE_OPERATIONS.md).

Technical detail, file formats and limits: [LIVE_OPERATIONS.md](LIVE_OPERATIONS.md) and [DATA_FORMAT.md](DATA_FORMAT.md).
