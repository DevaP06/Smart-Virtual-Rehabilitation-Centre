# Smart Warehouse Slotting & Optimization Engine

    pip install -r requirements.txt
    python run.py                  # data + baselines + optimized, prints KPIs, writes out/
    python run.py --orders data/raw/online_retail_II.csv --regen   # real orders (UCI/Kaggle Online Retail II)
    streamlit run app.py           # dashboard
    pytest -q tests

- `core/data.py` builds orders (real or seeded synthetic), SKU master (always synthesized, seeded, by category), warehouse grid.
- `core/engine.py` ABC velocity, co-occurrence, feasibility masks + greedy assignment (cost = velocity x distance + ergonomics + affinity + best-fit).
- `core/simulate.py` pick-route simulation; `core/validate.py` independent rule checker; `core/config.py` all tunables.
- Technical write-up: TECHNICAL_DOC.md
- Layout is learned on the first 80% of orders and scored on the last 20%.
