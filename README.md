# Smart Warehouse Slotting & Optimization Engine

Maps SKUs to warehouse bins under hard physical and safety rules, using demand velocity, basket affinity and ergonomics, and proves the gain against baselines on held-out orders. React dashboard + FastAPI + Postgres (Neon), deployable on Vercel.

* `v1` tag: Streamlit prototype, greedy optimizer.
* Current: v2 (this branch). Method, results and limits are in [TECHNICAL_DOC.md](TECHNICAL_DOC.md).

## Dashboard tabs

**Operations** (live): Live Warehouse (3D live stock status) · Inventory · Receiving (putaway of new products) · Work Orders (refills and re-slotting) · **Setup** (import your own bins, products, orders and stock). Managers: start with [docs/MANAGER_QUICK_START.md](docs/MANAGER_QUICK_START.md); details in [docs/LIVE_OPERATIONS.md](docs/LIVE_OPERATIONS.md).

**Results** (offline analysis): Results (ablation ladder with CIs) · Business impact (editable ROI) · Layout (heatmaps, rack elevation, per-SKU explanation, CSV downloads) · Pick path (animated) · Trade-offs (weight explorer with Pareto front) · Demand surge (stress test) · Generalization (cross-cohort matrix, cross-dataset comparison) · Data analysis · Constraints · Forecast & re-slotting · Method.

## Layout

| Path | What |
|---|---|
| `core/` | data generation/loading, optimizer (greedy, CP-SAT, local search), simulator, independent validator, forecasting + re-slotting, experiment runner |
| `slotdb/` | SQLAlchemy models and the writer that stores an experiment |
| `scripts/seed_db.py` | runs the experiments and stores them in the database |
| `api/index.py` | read-only FastAPI service (Vercel Python function) |
| `web/` | React + Plotly dashboard (Vite) |
| `core/ingest.py` | validation of a company's own orders, SKU master and locations (fail closed, row-level errors) |
| `templates/`, `docs/DATA_FORMAT.md` | CSV templates and column definitions |
| `tests/` | 37 tests: planted-violation validator tests, algorithm checks, data validation, fail-closed publishing, DB + API end to end |

## Run locally

    pip install -r requirements-engine.txt
    cp .env.example .env                  # optional: put your Postgres URL here; default is SQLite (data/slotting.db)
    pytest -q tests

    # real orders: download UCI "Online Retail II", convert both sheets to data/raw/online_retail_II.csv
    python scripts/seed_db.py --orders data/raw/online_retail_II.csv
    python scripts/seed_db.py             # or: synthetic orders for both scenarios (about 3 minutes)

    # grocery scenario on real Instacart baskets: download the Instacart Market Basket CSVs from Kaggle into ./Instacart (git-ignored)
    python scripts/seed_db.py --instacart Instacart

    uvicorn api.index:app --port 8000     # API (also serves web/dist when built)
    cd web && npm install && npm run dev  # dashboard on http://localhost:5173 (proxies /api to :8000)
    # port 8000 taken (for example by Docker)? run the API on another port and point the dev server at it:
    #   uvicorn api.index:app --port 8765     then     API_URL=http://127.0.0.1:8765 npm run dev   (PowerShell: $env:API_URL="http://127.0.0.1:8765"; npm run dev)

## Run it on your own warehouse data

Format and units: [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md). Templates: `templates/`.

    python scripts/run_company.py --validate-only --name "My DC" --orders orders.csv --skus sku_master.csv --locations locations.csv
    python scripts/run_company.py --name "My DC" --orders orders.csv --skus sku_master.csv --locations locations.csv

Bad data is rejected with CSV row numbers and **nothing is stored**. A run is also refused if any proposed layout breaks a rule or leaves a SKU unplaced. The result appears in the dashboard's scenario list; the Layout tab downloads the **move list** (current -> proposed) and the **assignment** as CSV.

## Live operations (stock, putaway, re-slotting)

    python scripts/seed_live.py                      # demo warehouse in the database named by DATABASE_URL
    python scripts/import_live.py --name "My DC" --bins bins.csv --products products.csv [--orders ...] [--stock ...]
    python scripts/live_job.py                       # nightly re-slotting proposals (also .github/workflows/nightly-reslot.yml)

Or use the Setup page. Stock is the sum of an append-only movement log; sales reduce it, deliveries are put away in the cheapest legal bin, low pick faces raise refill work orders, and the planner proposes swaps that beat the cost of the move. Limits (no login, Postgres-only row locks, estimates): [docs/LIVE_OPERATIONS.md](docs/LIVE_OPERATIONS.md).

## Deploy (Neon + Vercel)

1. **Database.** Create a Neon project; copy the *pooled* connection string. Put it in a local `.env` as `DATABASE_URL=...` (git-ignored).
2. **Seed.** `python scripts/seed_db.py --orders data/raw/online_retail_II.csv` writes the experiment results to Neon (tables are created automatically).
3. **Vercel.** Import the GitHub repo. Framework preset "Other"; `vercel.json` sets the build (`web/` -> `web/dist`) and routes `/api/*` to the Python function. In Project Settings > Environment Variables add `DATABASE_URL` (the same string). Deploy.
4. **Check.** `https://<your-app>.vercel.app/api/health` should return `{"status":"ok","runs":2}`.

The experiment pages read stored results, so no optimizer runs on Vercel; to refresh them re-run step 2. The live pages need the demo warehouse once: `python scripts/seed_live.py` (new tables are created automatically).

## Docker

    docker build -t slotting . && docker run -p 8000:8000 -e DATABASE_URL=... slotting

## API

`GET /api/health`, `/api/runs`, `/api/runs/{id}`, `/api/runs/{id}/kpis`, `/violations`, `/tradeoff`, `/surge`, `/cohort`, `/explain/{sku}`, `/api/compare`, `/layout?policy=`, `/assignment?policy=` (CSV), `/moves?from=&to=` (CSV), `/eda`, `/forecast`, `/reslot`, `/sensitivity`, `/paths`. Live operations: `/api/live/...` (see docs/LIVE_OPERATIONS.md).

## Data honesty

Orders are real (Online Retail II) for the fulfilment-centre scenario and synthetic for the dark store. SKU dimensions, weights, hazard classes and the warehouse layout are synthetic and seeded. Gains are simulated, not measured on a real floor.
