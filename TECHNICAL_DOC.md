# Technical & Algorithmic Documentation: Smart Warehouse Slotting & Optimization Engine (v2)

v1 (tag `v1`) was a Streamlit prototype with a greedy optimizer. v2 adds a database, an API, a React dashboard, an ablation ladder with confidence intervals, CP-SAT and swap-search refinement, demand forecasting, re-slotting, and a second warehouse scenario. All numbers below come from one seeded run (`scripts/seed_db.py`); treat them as estimates.

## 1. Architecture

```
L1 data ─▶ L2 ingest ─▶ L3 features ─▶ L4 optimizer ─▶ L5 validator ─▶ L6 simulator ─▶ Postgres ─▶ L7 API + UI
orders      clean,        velocity/ABC,   greedy zoning     independent     held-out replay,   (Neon)      FastAPI read API,
SKU master  join,         affinity,       by cost → CP-SAT   re-check of     2 routing          runs, kpis,  React dashboard
layout grid 70/30 split   forecast,       → swap search →    every rule      policies, CIs      slots,       on Vercel
                          feasibility     re-slot planner                                       artifacts
```

| Layer | Code | Notes |
|---|---|---|
| L1-L2 | `core/data.py` | Online Retail II loader (cleaning: returns, non-products, quantity ≤ 0), seeded synthetic order generator, SKU master synthesis, layout generator with two presets |
| L3 | `core/engine.py`, `core/forecast.py` | velocity/ABC, pair counts, support/lift/Jaccard, Louvain communities, LightGBM quantile forecast |
| L4 | `core/engine.py`, `core/refine.py`, `core/forecast.py` | greedy placement; CP-SAT; swap/relocate search; weekly re-slotting |
| L5 | `core/validate.py` | shares no code with L4; planted-violation tests for every rule |
| L6 | `core/simulate.py`, `core/experiment.py` | return and S-shape routing, KPIs, bootstrap CIs, sensitivity sweep |
| L7 | `slotdb/`, `api/index.py`, `web/` | SQLAlchemy models (Postgres in production, SQLite in tests), FastAPI, React + Plotly |

The heavy computation runs offline (`python scripts/seed_db.py`) and is stored in Postgres. The deployed API is read-only, so the dashboard shows exactly the stored results and there is no second copy of the numbers. This also fits Vercel's serverless limits (short functions, small bundle).

Cross-cutting: all tunables in `core/config.py`, fixed seeds, run timings stored in `run_log`, tests in `tests/` (19), CI in `.github/workflows/ci.yml`, `Dockerfile`.

## 2. Data

| Table | Source | Notes |
|---|---|---|
| Orders | UCI Online Retail II (1.07M lines). Removed returns (`C` invoices), non-product codes, quantity ≤ 0; kept the 1,500 most frequently picked SKUs → 39,132 orders | Real transactions. Because only the 1,500 busiest SKUs are kept, demand is flatter than a full catalogue: the top 20% of SKUs carry 47% of pick lines. |
| SKU master | **Synthetic**, seeded: category from description keywords, then dimensions, weight, hazard class and handling type from per-category ranges | No open dataset has Hazard_Class or Handling_Type. Hazard classes are illustrative, not a regulatory mapping. |
| Layout | **Generated.** Fulfilment centre: 10 aisles × 2 sides × 20 bays × 5 levels × 2 bins = 4,000 bins, aisle 9 is a hazard cage. Dark store: 4 aisles × 10 bays = 800 bins, 600 SKUs, 15,000 synthetic orders | Presets in `core/experiment.py` |

Evaluation uses a strict time split: layouts are learned on the first 70% of the period and scored on the later 30% (10,823 held-out orders for the fulfilment centre).

## 3. Constraints (hard, zero tolerance)

Dimensions (any axis rotation) · volume · bin weight · shelf-beam load · rack-frame load · hazard cage · flammable and oxidizer never in the same or an adjacent bay · fragile only on levels 2-4 · heavy (>15 kg) only on levels 1-2.

The static rules form a vectorised feasibility mask (`World.static_mask`); the aggregate rules (beam, frame, hazard neighbours) are checked in `State.ok` before every placement and every swap. `core/validate.py` re-derives all of them from the raw tables. Tests plant one violation per rule and require the validator to flag it; a further test requires the validator not to import the optimizer.

## 4. Method

**Greedy placement** (the base of every optimized layout). SKUs are placed fastest first; each takes the cheapest allowed bin:

```
cost = (demand + floor) × (distance_to_depot + shelf_penalty)
     + μ · (1 − sku_volume / bin_volume)                              # best-fit
     + λ · Σ over placed partners  co_orders × walking_distance(bin, partner_bin)   # affinity
```

**Ablation ladder** (each row adds one thing; weights are switched on in `_ladder_cfg`):

| Policy | What it is |
|---|---|
| naive | SKU_ID order into location order, rules ignored (shows the safety gap) |
| B0 random | random rule-compliant layout (primary baseline; 5 seeds) |
| B1 chaotic | software-directed random stow, SKUs in order of first arrival (Amazon-style benchmark) |
| B2 ABC | velocity × distance only |
| B3 + golden zone | adds the shelf-height penalty |
| B4 + affinity | adds the co-order pull |
| Full | adds best-fit |
| Full + CP-SAT | re-solves the 250 fastest non-hazardous SKUs exactly (OR-Tools), beam and frame limits as linear constraints |
| Full + CP-SAT + local search | swaps and relocations accepted only if training pick distance drops and every rule still holds |

**Affinity** uses pair counts for the placement pull; support, lift and Jaccard are computed for the EDA table, and Louvain communities on lift-filtered pairs are reported (35 clusters on the 400 fastest SKUs).

**Forecasting.** Weekly pick lines per SKU, one week ahead, LightGBM quantile models (P10/P50/P90) on lag, rolling-mean and calendar features, against "same as last week" and "mean of last 4 weeks". The forecast is used only if it beats both on held-out weeks.

**Re-slotting.** Each held-out week the planner forecasts demand, proposes swaps of a fast SKU in a poor bin with a slow SKU in a good bin, and applies a swap only if its weekly distance saving exceeds a relocation cost (150 m-equivalents), within a budget of 20 swaps per week. Every swap passes the same rule checks. The result is compared with a frozen layout, with move cost counted.

## 5. Evaluation protocol

- Replay held-out orders under two routing policies: **return** (front cross-aisle only) and **S-shape** (rear cross-aisle; every visited aisle walked end to end). Time = distance / 1.2 m/s + 10 s per line + a height penalty by level.
- 95% confidence intervals: bootstrap over order-days (1,000 resamples), paired against B0. Random layouts average 5 seeds.
- Sensitivity: 18 settings of walking speed, seconds per pick and height penalty. In this run, Full beat random in 100% of them and the ranking of B0, B2 and Full never changed.
- KPIs: distance, route time (mean, p95), fill rate, cube utilisation, lines per labour hour, refills per day, share of class-A picks at golden height, distance between co-ordered pairs, rule violations.

## 6. Results

### Fulfilment centre, Online Retail II, return routing

| Layout | m / order | vs B0 (95% CI) | S-shape vs B0 | Route time | Fill % | A-picks at golden height | Pair distance | Refills / day | Violations |
|---|---|---|---|---|---|---|---|---|---|
| naive | 141.7 | −53.4% [53.2, 53.6] | −53.7% | 407 s | 14.3 | 37% | 14.5 m | 2,370 | **259** |
| B0 random | 304.2 | baseline | baseline | 541 s | 13.8 | 39% | 39.7 m | 1,898 | 0 |
| B1 chaotic | 305.0 | +0.3% | −0.2% | 542 s | 13.8 | 39% | 36.7 m | 1,938 | 0 |
| B2 ABC | 157.5 | −48.2% [47.9, 48.5] | −30.6% | 420 s | 14.3 | 40% | 7.2 m | 1,937 | 0 |
| B3 + golden | 169.7 | −44.2% [44.0, 44.5] | −27.7% | 412 s | 15.1 | 65% | 9.8 m | 2,146 | 0 |
| B4 + affinity | 163.0 | −46.4% [45.8, 47.0] | −29.4% | 403 s | 15.1 | 58% | 3.4 m | 2,122 | 0 |
| **Full** | **165.9** | **−45.5% [44.9, 46.0]** | −25.8% | **404 s** | **15.9** | 61% | 3.3 m | 2,679 | 0 |
| Full + CP-SAT | 165.9 | −45.5% [44.9, 46.0] | −25.8% | 404 s | 15.9 | 61% | 3.4 m | 2,742 | 0 |
| Full + CP-SAT + LS | 166.9 | −45.1% [44.6, 45.7] | −25.5% | 403 s | 15.9 | 63% | 5.2 m | 2,744 | 0 |

"S-shape vs B0" is the change in average distance per order under S-shape routing; the other columns use return routing.

### Dark store (600 SKUs, 800 bins, synthetic orders)

| Layout | m / order | vs B0 (95% CI) | Route time | Fill % | Violations |
|---|---|---|---|---|---|
| naive | 55.6 | −2.9% [2.2, 3.5] | 93 s | 14.5 | 123 |
| B0 random | 57.3 | baseline | 93 s | 14.2 | 0 |
| B2 ABC | 31.3 | −45.4% [44.3, 46.5] | 74 s | 14.4 | 0 |
| B4 + affinity | 29.7 | −48.1% [47.3, 49.0] | 66 s | 14.8 | 0 |
| Full | 29.8 | −47.9% [47.2, 48.7] | 66 s | 15.0 | 0 |
| Full + CP-SAT + LS | 30.2 | −47.3% [46.6, 48.1] | 66 s | 15.0 | 0 |

### Forecasting and re-slotting (fulfilment centre, 25 held-out weeks)

| | LightGBM P50 | same as last week | mean of last 4 weeks |
|---|---|---|---|
| wMAPE | **35.9%** | 41.4% | 38.4% |

Re-slotting with the LightGBM forecast made 74 swaps and walked **1,664 km including move cost vs 1,766 km for the frozen layout (−5.8%)**, with 0 violations. On the dark-store scenario (stationary synthetic demand) the forecast did not beat the naive baselines, so the planner used the 4-week mean and made no moves, which is the intended behaviour.

## 7. What the numbers say, honestly

1. **ABC zoning does most of the work.** B2 already removes 48% of distance. Each later term trades some distance for something else: the golden zone raises class-A picks at golden height from 40% to 65% and cuts route time; affinity cuts co-order pair distance from 7.2 m to 3.4 m and route time again; best-fit raises fill rate but **increases refills per day by about 26%** (smaller bins empty sooner). Full is not the shortest layout, it is the best compromise across the KPIs.
2. **CP-SAT and local search did not help held-out distance.** CP-SAT returned FEASIBLE with a 28% gap after 20 s (not proven optimal) and its objective omits affinity between re-solved SKUs. The local search lowers training distance (about 0.7%) but the gain does not transfer to held-out orders, a sign of overfitting. We report these rows rather than hide them.
3. **The naive layout is not a fair winner.** It breaks 259 rules and, in this dataset, sorting by stock code may accidentally group colour variants that are ordered together. We did not isolate the cause.
4. **S-shape routing shrinks the gain** (25.8% vs 45.5%) because every visited aisle is walked end to end, so item depth matters less than the number of aisles touched. The ranking of layouts is unchanged.
5. **Chaotic stow (B1) behaves like B0** here: orders are multi-line (19.8 lines on average, 9.7% single-line), which is where random stow is expected to lose.
6. **Re-slotting is the one refinement with a clear net gain**, because it responds to demand drift rather than refitting the training period.

## 8. Complexity (N SKUs, M bins, b lines per order)

| Component | Complexity | Measured (N=1,500, M=4,000) |
|---|---|---|
| Feasibility mask | O(N·M), vectorised | part of the 4 s greedy ladder |
| Greedy placement | O(N·M log M) | about 1 s per layout |
| Pair mining | O(Σ b²), baskets over 30 lines skipped | included in load+features (12 s with CSV parsing) |
| CP-SAT | NP-hard in general; 250 SKUs × 25 candidate bins | 20 s limit, gap 28% |
| Local search | O(trials × orders touching a SKU) | 30 s budget, about 900 trials |
| Simulation | O(orders · lines) | about 10 s for all layouts and both routings |
| Full experiment | | about 93 s |

## 9. Trade-offs and limitations

- **Synthetic parts:** SKU dimensions, weights, hazard classes, handling types, the layout and the dark-store orders. The time model is assumed, not measured. Gains are simulated, not observed on a floor.
- **Affinity is pairwise in the greedy placer**, which is a quadratic-assignment-style term; we handle it sequentially (partners already placed) instead of clustering first, which scales but is order-dependent.
- **CP-SAT scope:** only the fastest 250 non-hazardous SKUs are re-solved; hazard-neighbour rules are left to the greedy stage.
- **Single picker, no congestion, no batching waves.** Aisle contention and batching are not modelled.
- **No Prod2Vec, Temporal Fusion Transformer, reinforcement learning, multi-robot path finding, 3D packing or MLflow;** run timings are stored in a `run_log` table instead.
- **Proprietary industry algorithms are not public.** The design follows public practice and the published literature; nothing here claims to replicate Amazon, Flipkart, Blinkit or Zepto internals.
- **Single seed per dataset;** the CIs capture order-day variation, not alternative warehouse designs.

## 10. Requirement map

| Requirement | Evidence |
|---|---|
| Working allocation prototype, feasible assignments | `core/engine.py`; 0 violations on every compliant layout; `tests/test_validate.py` |
| Rule enforcement (volume, load, hazard, heavy/fragile) | section 3; validator and planted-violation tests |
| ABC, affinity, ergonomics | section 4; B2 / B4 / B3 rows |
| Baseline vs optimized with metrics | sections 5-6; CIs and sensitivity |
| Interactive dashboard | `web/` (Results, Layout with rack elevation, Pick path, Data analysis, Constraints, Forecast & re-slotting, Method) |
| Backend, database, integration | `slotdb/`, `api/index.py`, `scripts/seed_db.py`; end-to-end test `tests/test_e2e.py` |
| EDA (Pareto, co-occurrence, volumetric density) | "Data analysis" tab, `eda` artifact |
| Documentation (architecture, constraints, complexity, EDA insights, trade-offs) | this document |
| Deployed product | `vercel.json`, README "Deploy" |

## 11. Reproduce

    pip install -r requirements-engine.txt
    pytest -q tests                                              # 19 tests, ~15 s
    python scripts/seed_db.py --orders data/raw/online_retail_II.csv   # needs DATABASE_URL (or SQLite default)
    uvicorn api.index:app --port 8000 & (cd web && npm install && npm run dev)
