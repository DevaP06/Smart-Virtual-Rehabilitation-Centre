# Smart Warehouse Slotting & Optimization Engine

Maps SKUs to warehouse bins under hard physical and safety rules, using demand velocity, basket affinity and ergonomics, and proves the gain against baselines on held-out orders. React dashboard + FastAPI + Postgres (Neon), deployable on Vercel.

* `v1` tag: Streamlit prototype, greedy optimizer.
* Current: v2 (this branch). Method, results and limits are in [TECHNICAL_DOC.md](TECHNICAL_DOC.md).

## Layout

| Path | What |
|---|---|
| `core/` | data generation/loading, optimizer (greedy, CP-SAT, local search), simulator, independent validator, forecasting + re-slotting, experiment runner |
| `slotdb/` | SQLAlchemy models and the writer that stores an experiment |
| `scripts/seed_db.py` | runs the experiments and stores them in the database |
| `api/index.py` | read-only FastAPI service (Vercel Python function) |
| `web/` | React + Plotly dashboard (Vite) |
| `tests/` | 19 tests: planted-violation validator tests, algorithm checks, DB + API end to end |

## Run locally

    pip install -r requirements-engine.txt
    cp .env.example .env                  # optional: put your Postgres URL here; default is SQLite (data/slotting.db)
    pytest -q tests

    # real orders: download UCI "Online Retail II", convert both sheets to data/raw/online_retail_II.csv
    python scripts/seed_db.py --orders data/raw/online_retail_II.csv
    python scripts/seed_db.py             # or: synthetic orders for both scenarios (about 3 minutes)

    uvicorn api.index:app --port 8000     # API (also serves web/dist when built)
    cd web && npm install && npm run dev  # dashboard on http://localhost:5173 (proxies /api to :8000)

## Deploy (Neon + Vercel)

1. **Database.** Create a Neon project; copy the *pooled* connection string. Put it in a local `.env` as `DATABASE_URL=...` (git-ignored).
2. **Seed.** `python scripts/seed_db.py --orders data/raw/online_retail_II.csv` writes the experiment results to Neon (tables are created automatically).
3. **Vercel.** Import the GitHub repo. Framework preset "Other"; `vercel.json` sets the build (`web/` -> `web/dist`) and routes `/api/*` to the Python function. In Project Settings > Environment Variables add `DATABASE_URL` (the same string). Deploy.
4. **Check.** `https://<your-app>.vercel.app/api/health` should return `{"status":"ok","runs":2}`.

The deployed API only reads stored results, so no optimizer runs on Vercel. To refresh results, re-run step 2.

## Docker

    docker build -t slotting . && docker run -p 8000:8000 -e DATABASE_URL=... slotting

## API

`GET /api/health`, `/api/runs`, `/api/runs/{id}`, `/api/runs/{id}/kpis`, `/violations`, `/layout?policy=`, `/eda`, `/forecast`, `/reslot`, `/sensitivity`, `/paths`.

## Data honesty

Orders are real (Online Retail II) for the fulfilment-centre scenario and synthetic for the dark store. SKU dimensions, weights, hazard classes and the warehouse layout are synthetic and seeded. Gains are simulated, not measured on a real floor.
