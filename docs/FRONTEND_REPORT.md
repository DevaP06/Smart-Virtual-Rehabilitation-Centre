# Frontend report: Warehouse Slotting Engine dashboard

Written from the code in `web/src` (1,569 lines) and from tests against the live site, https://smart-virtual-rehabilitation-centre.vercel.app, on 28 Oct 2026. "Observed" means I measured or saw it; "from the code" means I read it but did not test it in a browser. Effort labels (S/M/L) are my rough estimates, not commitments.

---

## 1. What it is

A single-page React dashboard that only **reads** results that the optimizer has already computed and stored in Postgres. It has no logic that changes results, no login, and no way to upload data or start a run. Everything the user sees comes from 15 read-only data endpoints, plus 2 CSV download links (section 4).

| Item | Detail |
|---|---|
| Framework | React 18.3.1, function components and hooks (no router, no state library) |
| Build | Vite 5.4.8, `@vitejs/plugin-react` 4.3.1 |
| Charts | Plotly: `plotly.js-cartesian-dist-min` 2.35.2 through `react-plotly.js` 2.6.0 (cartesian bundle: scatter, bar, heatmap; no 3D, no maps) |
| Styling | One hand-written stylesheet (`styles.css`, 103 lines, 4.1 KB, 1.3 KB gzipped). No CSS framework, no component library |
| Routing | URL hash selects the tab (`#overview`, `#layout`, ...). `?run=<id>` selects a scenario. Nothing else is in the URL |
| Data fetching | A custom hook `useApi(path)` using `fetch`. No caching, no retries, no request de-duplication |
| Hosting | Served by the same FastAPI function as the API on Vercel. `index.html` is sent with `Cache-Control: no-store` |
| Bundle | One JavaScript file: **1,590,360 B (535,525 B gzipped)**, one CSS file. No code splitting |
| Files | `App.jsx` (shell), `ui.jsx` (shared pieces), 11 tab files, `styles.css`, `main.jsx`, `index.html` |

---

## 2. The shell (shown on every page)

| Part | What it does |
|---|---|
| **Header** | Title "Warehouse Slotting Engine" and the line "Demand-aware SKU-to-bin assignment with rule enforcement and measured gains" |
| **Scenario selector** | A dropdown on the right of the header. Lists every stored run, ordered fulfilment centre, grocery, dark store, then company runs. Label is "Profile · dataset", e.g. "Grocery dark store · Instacart Market Basket (Kaggle)". Switching it reloads the current tab for that run |
| **Tab bar** | 11 text buttons in a row, active one underlined in the accent colour. Scrolls sideways when it does not fit. Tabs, in order: Results, Business impact, Layout, Pick path, Trade-offs, Demand surge, Generalization, Data analysis, Constraints, Forecast & re-slotting, Method |
| **Loading state** | Plain centred text "Loading…" (no skeletons, no spinner) |
| **Error state (API)** | Red centred text "Could not load data: 404 Not Found for /api/…" (raw status and path, no retry button) |
| **Error state (code crash)** | An error boundary around the tab body shows "This tab failed to display: <message>" with a "Try again" button, instead of a blank page |
| **Empty state** | "No runs stored yet. Run `python scripts/seed_db.py`…" if the database is empty |
| **Remount rule** | The tab body is keyed on run id plus tab, so every tab switch or scenario switch throws away the page and fetches again |

### Visual design (from `styles.css`)

- **Dark theme only** (`color-scheme: dark`). No light theme, no print stylesheet, no `prefers-color-scheme` handling.
- Colour tokens: background `#0b1220`, panel `#111a2e`, raised panel `#16223b`, border `#243453`, text `#e2e8f0`, muted `#94a3b8`, accent `#38bdf8`, good `#34d399`, bad `#f87171`, warning `#fbbf24`.
- Type: 14 px Inter if installed, otherwise the system font. The Inter font is **not loaded** by the page, so most visitors see their system font.
- Building blocks: `.panel` (rounded box), `.card` (KPI tile), `.note` (info box, `.warn` variant is yellow-brown), `.table-wrap` (sideways scroll), `.controls` (row of filters), `.grid.two` (two columns, minimum 380 px each), `.grid.cards` (auto-fit tiles, minimum 210 px), `a.btn` / `button.btn` (download and reset buttons).
- One responsive breakpoint: at 560 px and below the two-column grid becomes one column and card numbers shrink.

---

## 3. Shared components (`ui.jsx`)

| Piece | Purpose |
|---|---|
| `Plot` | Wrapper around Plotly. Applies the dark look (transparent background, light text, grid colour `#334155`, dark tooltips, legend below the chart, default height 360 px, responsive width). Every chart in the app goes through it. The Plotly toolbar (zoom, pan, reset, download PNG) appears on hover |
| `useApi(path)` / `Async` | Fetch plus the loading and error states above |
| `Card` | KPI tile: small caps label, large number, small sub-line; optional green or red tone |
| `Note` | Explanatory box, info or warning style |
| `fmt`, `less` | Number formatting; `less(x)` prints "−12.3%" for a reduction and "+1.2%" when worse than the baseline |
| `LABEL`, `LADDER`, `RULE_LABEL` | Human names for the 9 layouts and the 11 rule counters (e.g. `B2_abc` is "B2 ABC zoning only") |

---

## 4. Page by page

Legend: **Data** = API calls the page makes. All calls are `GET /api/runs/{id}/…` unless stated.

### 4.1 Results (`#overview`)
**Purpose:** the headline proof and the ablation table.
**Data:** `kpis`, `sensitivity`.

| Component | Detail |
|---|---|
| 4 KPI cards | (1) Travel distance vs random: "−45.5%" plus "95% CI 44.9 to 46.0 · Full (+ best-fit)". (2) Route time vs random with seconds per order. (3) Fill rate with the random layout's value. (4) Rule violations (green if 0) with the naive layout's count |
| Ablation table | 9 rows (naive, B0 random, B1 chaotic, B2 ABC, B3 +golden zone, B4 +affinity, Full, Full+CP-SAT, Full+CP-SAT+local search) by 11 columns: metres per order, change vs B0 with its 95% CI, metres per order under S-shape routing, route time, fill %, class-A picks at golden height %, distance between co-ordered pairs, refills per day, lines per labour hour, violations (green 0, red otherwise). The headline layout's row is tinted. Scrolls sideways |
| Bar chart | "Distance reduction vs B0, with 95% CI": vertical bars for 8 layouts, asymmetric error bars for the CI, bars red when the layout has violations, blue for the headline layout, grey for the rest. X labels tilted 30° |
| Sensitivity text panel | "Across 18 settings: Full beats random in X% of settings; the ordering of B0, B2 and Full is unchanged in Y%". Text only |
| Notes | Info note on simulator limits; warning note "Reading the table honestly" whose text names the shortest rule-compliant layout and the naive layout's violation count |

**Interactions:** hover tooltips and Plotly toolbar on the bar chart; sideways scroll on the table. No sorting, filtering or column help text.

### 4.2 Business impact (`#impact`)
**Purpose:** turn simulated gains into hours and money.
**Data:** `kpis`.

| Component | Detail |
|---|---|
| Two dropdowns | "Compare" (any layout except naive, default the headline) against (any layout, default B0 random) |
| Four number inputs | Orders per day (default: held-out orders ÷ days), operating days per year (300), picker cost per hour (12, "your currency"), minutes per refill (2) |
| 4 KPI cards | Net picker-hours saved per year; net saving per year; walking saved per year in km; time saved per order in seconds. Tone turns red if the net is negative |
| Warning note | States the figures are estimates from an assumed time model, and what is not included |

**Calculation (from the code):** hours saved = time saved per order × orders per day × days ÷ 3600; refill hours = change in refills per day (scaled to the entered order volume) × minutes ÷ 60 × days; net = difference. **No chart on this page.** Interactions: typing in any input recalculates immediately.

### 4.3 Layout (`#layout`)
**Purpose:** see where demand sits, compare layouts, understand a single SKU, get the move list.
**Data:** `layout?policy=` (fetched up to 4 times: left heatmap, right heatmap, elevation, explainer), `explain/{sku}`.

| Component | Detail |
|---|---|
| Three dropdowns | Left layout (default B0 random), Right layout (default headline), Shelf level (all, 1 to 5) |
| Two download buttons | "Download move list (left → right)" and "Download assignment (right)": plain links to CSV endpoints |
| Two heatmaps (side by side) | Top-down view: x is aisle column (2 sides per aisle), y is bay (0 = nearest depot), colour is log(1 + pick lines) stored in that rack face, Viridis scale, colour bar, hover "aisle col, bay, N pick lines". Height 440. **Each heatmap has its own colour scale** |
| Note | How to read the heatmaps |
| Rack elevation panel | Two dropdowns (aisle; side left/right; the last aisle is labelled "hazard cage"). Heatmap with bays across and shelf levels 1 to 5 up, a dotted green rectangle marking the golden zone (levels 3 and 4), hover lists each SKU with category, ABC class and hazard class. Height 300, no colour bar |
| "Why is this SKU here?" panel | Text input with a drop-down list of the 200 fastest SKUs (any id can be typed). Shows a sentence ("sits in R0-0-00-L4-B0: level 4, 3.0 m from the depot… the cheapest alternative would cost 762% more"), a **stacked bar chart** (the chosen bin plus three alternatives; stacks are distance, shelf height, wasted space, distance to bought-together items), and a table of partner SKUs (orders together, walking distance between bins). Unknown SKU shows "No SKU … in this scenario" |

Only the Full layout has explanations (stored for that layout only).

### 4.4 Pick path (`#path`)
**Purpose:** show one order walked on three layouts.
**Data:** `paths` (12 stored sample orders from the held-out period).

| Component | Detail |
|---|---|
| Two dropdowns | Order (12 sample orders, with line counts), routing policy (return or S-shape) |
| Animated scatter plot | x is metres across aisles, y is metres up the aisle. Three faint route lines (B0 random red, B2 ABC amber, Full blue; legend shows the total metres of each), three moving dots labelled with distance walked so far (turning to "done: N m"), depot as a white star. Play, Pause and Reset buttons above the chart (Plotly animation, up to about 160 frames at 45 ms). Routes are offset sideways by ±0.12 m so overlapping routes stay visible. Height 540 |
| Note | Explains the picture |

**Observed limits:** only 12 fixed orders; no speed control or scrubber; the chart does not say whether the chosen order is typical. On one run the Full layout walked 50 m against 46 m for random for a sampled order, which can confuse a viewer. Animation start and the buttons were exercised in the automated click-through; I did not check the animation visually frame by frame.

### 4.5 Trade-offs (`#tradeoff`)
**Purpose:** explore the objective weights.
**Data:** `tradeoff` (36 precomputed layouts).

| Component | Detail |
|---|---|
| Three dropdowns + Reset | Affinity {0, 0.5, 1.5, 3}, best-fit {0, 0.5, 1.5}, golden-zone strength {0, 0.5, 1}; "Reset to the default" |
| 5 KPI cards | Walking per order, route time, fill rate, class-A picks at golden height, refills per day for the chosen setting, each with a difference vs the default (green better, red worse) |
| Two axis dropdowns | Pick any of 6 metrics for X and Y |
| Scatter chart | All 36 settings (grey), the Pareto front for the chosen axes (green, computed in the browser), the selected setting (blue star). Hover shows the three weights. Height 420. A sentence says whether the selection is on the front or dominated |
| Note | Explains that moving along the front is the real decision |

### 4.6 Demand surge (`#stress`)
**Purpose:** stress test with a simulated sale peak.
**Data:** `surge`.

| Component | Detail |
|---|---|
| Description | 150 mid and slow SKUs sell about 8× as much for the last 4 weeks |
| 3 KPI cards | Frozen layout km; re-slotted km including move cost with % less and number of swaps; rule violations after re-slotting |
| Line chart | Weekly km walked, frozen (red) vs re-slotted (blue), with a shaded yellow rectangle and a "surge" label over the surge weeks. Height 340 |
| Warning note | The surge is simulated; the planner lags by a week |
| Empty case | If the history is too short (dark store preset) a warning note says so instead |

**Observed:** for the grocery scenario the page shows 0 swaps and a 0% change with no explanation on the page of why no swap beat the move cost.

### 4.7 Generalization (`#general`)
**Purpose:** does the method survive a change in who is ordering, and across datasets?
**Data:** `cohort` (this scenario) and `/api/compare` (all scenarios, the same on every scenario).

| Component | Detail |
|---|---|
| Cohort heatmap | Rows are the group the layout was trained on (plus "all orders"), columns the group it is tested on; colour and a printed percentage per cell show % less walking than random. Cell text switches between light and dark for readability. Height grows with the number of rows |
| Cohort summary table | Per test group: orders, result when trained on itself, trained on all orders, worst other group (named), and the drop in points (red if more than 5) |
| Note | Explains a large drop; says the reason was not tested |
| Dataset comparison table | One row per scenario: SKUs, orders, lines per order, single-line %, demand concentration, walking reduction with CI, ABC-alone reduction, route time change |
| Rank-correlation table | Spearman ρ between scenarios for distance, fill and golden-zone share |
| Best-weights table | The best setting for walking distance per scenario |
| Warning note | Explains the layout cannot move between datasets |

**Observed:** the dataset section is tables only (no chart). `/api/compare` took about 6 s on the live site because it is computed on each request.

### 4.8 Data analysis (`#eda`)
**Purpose:** the data profile required by the problem statement.
**Data:** `eda`.

| Component | Detail |
|---|---|
| Pareto line chart | Cumulative % of pick lines against % of SKUs (fastest first), with an "even demand" diagonal. Text below gives class A/B/C counts and the share carried by the top 20% |
| Affinity heatmap | 30×30 co-occurrence of the fastest SKUs (log colour scale, Viridis, colour bar). Axis labels are hidden; SKU ids appear in the hover. Text gives the number of Louvain communities and the largest sizes |
| Volume histogram | 30-bin histogram of stored volume per SKU in litres with dotted vertical lines for each bin size (labelled "bin 36 L", "bin 96 L", ...) |
| Basket bar chart | Orders by number of lines (the last bar is "30 or more"); text gives the single-line share and the mean lines |
| Pairs table | Top 20 co-ordered pairs: orders together, support, lift, Jaccard |
| Note | Share of hazardous SKUs and how classes were assigned |

### 4.9 Constraints (`#rules`)
**Purpose:** show the independent validator's findings.
**Data:** `violations`.

| Component | Detail |
|---|---|
| Violations table | 12 rows (11 rule counters plus a bold total) by 8 layouts (naive, B0, B2, B3, B4, Full, Full+CP-SAT, Full+CP-SAT+local search; B1 is not shown). Zero cells green, others red |
| Note | Lists the rules enforced |

No chart on this page.

### 4.10 Forecast & re-slotting (`#forecast`)
**Purpose:** forecasting results and the weekly re-slotting replay.
**Data:** `forecast`, `reslot`.

| Component | Detail |
|---|---|
| Forecast bar chart | Grouped bars of weighted error (wMAPE) for LightGBM P50, "same as last week", and "mean of last 4 weeks"; height 300 |
| Pinball loss table | P10, P50, P90 by the three models, plus "Beats both baselines on wMAPE: yes/no" |
| Re-slotting description | Weekly forecast, swaps only when the saving beats a 150 m-equivalent cost, within a weekly budget |
| 3 KPI cards | Static layout km; re-slotted km including move cost with % less and swaps; violations |
| Line chart | Weekly km, static (red) vs re-slotted (blue), height 300 |
| Empty cases | A warning note if there is not enough weekly history; nothing is shown (no message) if the re-slotting result is missing |

### 4.11 Method (`#method`)
**Purpose:** explain the approach.
**Data:** none (uses the run's stored configuration and timings).

| Component | Detail |
|---|---|
| Architecture grid | 7 layer boxes (data, ingest, features, optimizer, validator, simulator, service and UI) |
| Paragraph | Optimizer runs offline and the site only reads stored results |
| Cost formula block | The cost function in monospace, then the actual weights of this run (λ, μ, floor, shelf penalties) |
| Complexity list | Big-O of each component and the measured timings of this run |
| Limits note | Synthetic data, assumed time model, simulated gains, CP-SAT and local-search result |

**Content error found:** the limits note says "CP-SAT closes N% of its optimality gap within the time limit", computed as 100 × (1 − gap). With a 28% gap that prints 72%. A 28% gap means 28% of the objective is still unproven, so the sentence is misleading. It should say "stopped with a 28% optimality gap".

---

## 5. Inventories

**Charts: 15**

| Type | Where |
|---|---|
| Bar with error bars | Results (1) |
| Heatmap | Layout ×3 (2 top-down, 1 elevation), Generalization (1 cohort matrix), Data analysis (1 affinity) = 5 |
| Stacked bar | Layout, SKU explainer (1) |
| Animated scatter | Pick path (1) |
| Scatter with highlight and Pareto front | Trade-offs (1) |
| Line | Data analysis Pareto (1), Demand surge (1), Forecast re-slotting (1) = 3 |
| Histogram / bar | Data analysis volume (1), Data analysis baskets (1), Forecast error (1) = 3 |

**Tables: 9** (Results ladder; SKU partners; Generalization ×4: cohort summary, dataset comparison, rank correlation, best weights; Data analysis pairs; Forecast pinball loss; Constraints violations).
**KPI cards: 19** (Results 4, Business impact 4, Trade-offs 5, Demand surge 3, Forecast 3).
**Downloads: 2** (move list CSV, assignment CSV).
**Interactive controls:** scenario selector; tab bar; Business impact 2 dropdowns + 4 number inputs; Layout 3 dropdowns + 2 elevation dropdowns + SKU search; Pick path 2 dropdowns + Play/Pause/Reset; Trade-offs 3 weight dropdowns + Reset + 2 axis dropdowns. Everything else is hover and the Plotly toolbar.

**API calls on a first visit to each tab** (every tab switch refetches): Results 2; Business impact 1; Layout 5 (four of them the full layout, about 250 KB for the largest scenario); Pick path 1; Trade-offs 1; Demand surge 1; Generalization 2; Data analysis 1; Constraints 1; Forecast 2; Method 0; plus 2 for the shell (run list, run detail).

---

## 6. What was measured

| Check | Result |
|---|---|
| Automated click-through on the live site (real Chrome), all 11 tabs for all 3 scenarios, plus dropdowns, SKU search (valid and invalid), animation Play and Reset, S-shape routing, trade-off selects, impact inputs including an empty field | No blank screens or crashes. The only console errors were expected 404s from SKU lookups that do not exist in a scenario |
| API latency from outside | Typically 2.4 to 3.5 s per call; the first call after a quiet period took 9.0 s (database waking up); `/api/compare` about 6 s |
| Horizontal overflow of the page at 390 px wide | **53 px on every tab** (page scrolls sideways). None at 768 px or 1,300 px |
| Accessibility markup | No `aria-*` or `role=` attributes anywhere in the frontend |
| Bundle | 1.59 MB, 536 KB gzipped, single chunk |

**Not tested:** other browsers (Firefox, Safari, Edge), real phones, an accessibility audit or colour-contrast measurement, visual correctness of the animation frame by frame, performance on slow networks, print layout.

---

## 7. Observations that could be improved (for you to choose from)

Impact is my view of how visible it is to an evaluator or a company user.

### Fix first (small, visible)
| # | Observation | Evidence | Effort | Impact |
|---|---|---|---|---|
| 1 | Method tab states "CP-SAT closes 72% of its optimality gap" for a 28% gap | `Method.jsx` line 67 | S | High: a wrong claim on a page judges read |
| 2 | Page scrolls sideways on phones | 53 px overflow on all tabs at 390 px | S | Medium |
| 3 | The two layout heatmaps use separate colour scales, so equal colours do not mean equal demand across the pair | `Layout.jsx` `Heat` computes its own scale | S | Medium |
| 4 | Fetch errors print raw text with a status code and no retry | `ui.jsx` `Async` | S | Medium |
| 5 | Demand surge shows 0 swaps for grocery with no explanation; Forecast shows nothing if re-slotting is missing | Tab code and grocery data | S | Low to medium |

### Feels slow or heavy
| # | Observation | Evidence | Effort | Impact |
|---|---|---|---|---|
| 6 | Layout tab downloads the full layout four times; every tab switch refetches; no cache | `useApi`, keyed remount | M | Medium: 2.4 to 3.5 s per call adds up |
| 7 | `/api/compare` takes about 6 s because it is computed per request | Measured | S (precompute at seed time) | Medium |
| 8 | Loading is only the word "Loading…"; first load after idle can take 9 s | Observed | S | Medium |
| 9 | Single 1.59 MB script, mostly Plotly | Build output | M (split per tab) | Low to medium |

### Clarity for non-technical viewers
| # | Observation | Evidence | Effort | Impact |
|---|---|---|---|---|
| 10 | The Results table has 11 dense columns, no explanations or sorting; terms like "A-picks at golden height" are unexplained | `Overview.jsx` | S to M | Medium |
| 11 | No page header showing, for the selected scenario, what is real and what is synthetic (orders real, product sizes synthetic) | Only notes at the bottom of some tabs | S | High for honesty |
| 12 | Pick path shows 12 fixed orders with no summary of how often the layout wins; a viewer may land on an order where it loses | Observed | M (add a distribution chart of per-order savings) | Medium |
| 13 | Dataset comparison is tables only | `Generalize.jsx` | S to M | Medium |
| 14 | Business impact has no chart and an unspecified currency | `Impact.jsx` | S to M | Medium |
| 15 | Affinity heatmap has no axis labels; Instacart product names exist but are not stored or shown | `Eda.jsx` | M | Low |
| 16 | Only one aisle side shown in the rack elevation; "hazard cage" is assumed to be the last aisle | `Layout.jsx` | M | Low |

### Accessibility and polish
| # | Observation | Evidence | Effort | Impact |
|---|---|---|---|---|
| 17 | No `role="tablist"` / `aria-selected` on tabs, no text alternatives for charts, meaning carried by colour alone in several charts | grep: no aria attributes | M | Medium |
| 18 | Dark theme only; no print or export of a report | `styles.css` | M | Low to medium |
| 19 | Inter font is requested but never loaded | `styles.css`, `index.html` | S | Low |
| 20 | Selections (layouts compared, SKU, weights) are not in the URL, so a link cannot reproduce a view | `App.jsx` | S to M | Low |
| 21 | Units and names for the same metric differ between tabs ("m / order" vs "Walking per order (m)") | Several tabs | S | Low |

### Features missing for company use
| # | Observation | Effort | Impact |
|---|---|---|---|
| 22 | No way in the UI to upload a company's data, start a run, or see run status (the optimizer runs from a command line) | L (needs a compute service) | High for "company can use it" |
| 23 | No login or per-company separation; anyone with the URL sees everything | L | High for real use, none for a demo |
| 24 | No way to load the company's real current layout as the "from" side of the move list | M | High for real use |
