# Technical & Algorithmic Documentation: Smart Warehouse Slotting Engine

## 1. Architecture

```
orders.csv ─┐                       ┌─ route simulator (core/simulate.py) ─┐
skus.csv   ─┼─ core/data.py ─▶ core/engine.py ─▶ assignment (SKU→bin) ─┤  KPIs: distance, time, fill rate
locations.csv┘   (load/synthesize)  velocity · affinity · feasibility ·   └─ independent validator (core/validate.py): rule violations
                                    greedy placement                              │
                                                                        Streamlit dashboard (app.py)
```
- `core/config.py` holds every tunable (grid size, capacities, speeds, objective weights).
- `core/pipeline.py` runs everything: split orders 80/20 by time, learn the layout on the first 80%, score it on the last 20% (an honest test; the layout never sees the orders it is judged on).
- Three layouts are compared on the same test orders: **naive** (SKU_ID order into location order, ignores all rules), **random feasible** (rule-compliant, random; the "initial/random baseline" the PS asks for), **optimized**.

## 2. Data

| Table | Source | Honest notes |
|---|---|---|
| Orders `Order_ID, SKU_ID, Quantity, Timestamp` | UCI Online Retail II (both sheets, 1.07M rows). Returns (`C` invoices), non-product codes and quantities ≤ 0 removed; top 1,500 SKUs by pick lines kept (39,132 orders). A seeded synthetic generator is the offline fallback. | Real transactions. Because we kept only the 1,500 most frequently ordered SKUs, the demand curve is flatter than a full catalogue would be. |
| SKU master `Width, Height, Depth, Weight, Category, Hazard_Class, Handling_Type, Cases` | **Synthesized.** Category from keywords in the product description, then dimensions and weight sampled from per-category ranges (seeded). | No open dataset has SKU physical data. Hazard classes and dimensions are assumptions, not measurements. Keyword matching is crude (e.g. "SOAP" counts as a cleaning/oxidizer item). |
| Warehouse grid | **Generated**: 10 aisles × 2 sides × 20 bays × 5 levels × 2 bins = 4,000 bins. Depot at aisle 0 front. Aisle 9 is a hazard cage. Bin sizes and weight ratings vary by level. | A design choice, fully configurable. |

## 3. Constraints (all hard; zero tolerance)

| Rule | How it is enforced | Source of truth |
|---|---|---|
| Dimensions | Sorted SKU dims ≤ sorted bin dims (equivalent to allowing any axis rotation) | engine mask, validated independently |
| Volume | Case volume × cases ≤ bin volume | same |
| Bin weight | Case weight × cases ≤ bin rating | same |
| Beam and rack-frame load | Running totals per beam (both bins of one level) and per frame; checked before every placement | engine loop; validator re-sums from scratch |
| Hazard isolation | Hazardous SKUs only in the hazard cage, standard SKUs never in it | mask |
| Incompatible neighbours | Flammable and oxidizer may not share a rack frame or an adjacent bay on the same aisle side | engine loop |
| Fragile | Levels 2–4 only | mask |
| Heavy (> 15 kg or Handling = heavy) | Levels 1–2 only | mask |

`core/validate.py` does not import the optimizer. It re-derives each rule from the raw tables, and counts violations. The optimized layout scores 0. The naive layout scores 259, mostly hazard-zone breaches, heavy items on high shelves, volume/dimension overflow and flammable/oxidizer adjacency.

## 4. Optimization method

SKUs are placed in order of descending training-set velocity. For each SKU:
1. A vectorized **feasibility mask** removes every bin that breaks a static rule (dimensions, volume, weight, hazard zone, fragile/heavy level).
2. Remaining bins are ranked by
   `cost = (velocity + floor) × (distance_to_depot + ergonomic_penalty(level)) + μ × wasted_volume_ratio + λ × Σ cooccurrence(sku, placed_partner) × walking_distance(bin, partner_bin)`
   - **Velocity term**: fast movers go near the depot.
   - **Ergonomics**: penalty is 0 for levels 3–4 (chest-to-waist), higher for floor and top shelf.
   - **Affinity**: the 15 strongest co-ordered partners already placed pull the SKU toward them. Pairs are mined from baskets by direct pair counts (a pair must co-occur at least twice).
   - **Best-fit**: prefers bins that the SKU fills well, which raises the fill rate.
   - **Floor**: lets zero-demand SKUs still prefer nearer bins so they don't scatter across the warehouse.
3. The first ranked bin that also passes the **dynamic** checks (beam/frame load, incompatible neighbour) is taken.

**Complexity.** n SKUs, m bins, b = average basket size, N orders. Mask per SKU is O(m) → O(n·m) overall; ranking is O(m log m) per SKU, so O(n·m log m); the affinity term adds O(k·m) per SKU for k partners. Pair mining is O(N·b²). With n = 1,500 and m = 4,000 a full run takes about 14 s including the three layouts and the simulation.

**Route model.** From the depot the picker walks the cross-aisle to each needed aisle, walks to the deepest pick in that aisle and back, then moves on; distance per order = 2 × (farthest aisle's x) + 2 × Σ(deepest pick per aisle). Time = distance / 1.2 m/s + 10 s per line + a small penalty for floor/top-shelf picks.

## 5. Results (real orders, 6,991 held-out test orders, one seed)

| Layout | Total distance | Avg route time | Fill rate | Violations |
|---|---|---|---|---|
| Naive (rules ignored) | 995 km | 417 s | 14.3% | 259 |
| Random, rule-compliant | 2,158 km | 555 s | 13.7% | 0 |
| **Optimized** | **1,171 km** | **412 s** | **15.7%** | **0** |

Against the random compliant baseline: **−45.8% distance, −25.7% route time, +2.0 points fill rate, 0 violations.** Random-baseline distance varies by about ±10.6 km (standard deviation over 5 seeds), which is tiny next to the gap.

**Reading the naive row honestly.** The naive layout travels less than the optimized one, but it breaks 259 rules, so it can't be deployed. Likely reasons it is short (we did not isolate them): it packs every SKU into the first four aisles, and in Online Retail II consecutive stock codes are often colour variants of one product, so sorting by ID may accidentally group items that are ordered together. Its route time is slightly worse than the optimized layout's (417 s vs 412 s); we expect that comes from ignoring shelf height, but we did not test it.

## 6. EDA insights

- **Velocity.** After keeping the top-1,500 SKUs, the top 20% of SKUs carry 47% of pick lines, so the curve is flatter than the classic 80/20. A/B/C split: 812 / 425 / 243 SKUs (A = first 80% of demand, B = next 15%). Slotting value comes more from affinity than from velocity alone.
- **Affinity.** 377,726 SKU pairs co-occur at least twice. The strongest pairs (about 570 orders each) are colour variants or matching items, which justifies placing partners adjacent.
- **Volumetric density.** The median SKU case-lot takes 13 L and the largest 123 L, while bins are 36 / 96 / 240 L. Most bins are much larger than what they hold, so overall cube utilization is only 5.4% of the warehouse and fill rate inside used bins is 15.7%. Smaller bin classes would raise it.

## 7. Trade-offs and limits

- **Greedy, not optimal.** Placement is greedy; Hungarian assignment or swap search is a documented next step (`# ponytail:` note in `core/engine.py`). The sweep on real data showed diminishing returns from tuning: affinity weight and partner count moved distance by only a few percent.
- **Affinity vs velocity.** Strong affinity can pull a moderately fast SKU away from the best slots. The weights live in the config and as sidebar sliders so this can be shown live.
- **Ergonomics vs distance.** Penalising low and high shelves pushes items sideways. The route model counts only horizontal walking, so the ergonomic benefit appears only in the time metric.
- **Hazard cage location.** Aisle 9 (far from the depot) is realistic for segregation but costs distance when hazardous items sell well. Moving the cage to aisle 0 cut the optimized distance by about 4% in a test.
- **Synthetic SKU master and a simple route model** (no congestion, single picker, return routing rather than a full S-shape or optimal TSP route).
- **One data split and one warehouse design.** Results are not confidence intervals; the estimates would shift with other splits.

## 8. Reproduce

    pip install -r requirements.txt
    python run.py --orders data/raw/online_retail_II.csv --regen   # real data
    python run.py                                                  # synthetic, offline
    streamlit run app.py
    pytest -q tests
