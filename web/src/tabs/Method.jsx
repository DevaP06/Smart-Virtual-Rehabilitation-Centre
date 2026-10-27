import { Note } from "../ui.jsx";

const LAYERS = [
  ["L1 Data", "Orders (real or synthetic), SKU master, warehouse grid"],
  ["L2 Ingest", "Clean returns and non-products, join SKU master, time split 70/30"],
  ["L3 Features", "Velocity and ABC, affinity (counts, lift, Jaccard, Louvain), weekly forecast, feasibility mask"],
  ["L4 Optimizer", "Greedy zoning by cost, CP-SAT refinement, swap search, re-slot planner"],
  ["L5 Validator", "Independent re-check of every rule; no shared code with L4"],
  ["L6 Simulator", "Held-out replay, two routing policies, time model, KPIs, bootstrap CIs"],
  ["L7 Service + UI", "Postgres (Neon), FastAPI read API, React dashboard on Vercel"],
];

export default function Method({ run }) {
  return (
    <>
      <div className="panel">
        <h2>Architecture</h2>
        <div className="arch">
          {LAYERS.map(([t, d]) => (
            <div className="box" key={t}>
              <b>{t}</b>
              <span>{d}</span>
            </div>
          ))}
        </div>
        <p>
          The optimizer, simulator and forecaster run offline (<code>python scripts/seed_db.py</code>) and store every layout, KPI and artefact in Postgres. The
          deployed API only reads, so the dashboard shows exactly the stored results and never a second copy of the numbers.
        </p>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>How a SKU picks its bin</h2>
          <p>Bins that break a hard rule never get a score. Among the rest, the lowest cost wins; SKUs are placed fastest first.</p>
          <div className="formula">
            cost = (demand + floor) × (distance_to_depot + shelf_penalty)
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ μ · wasted_volume_ratio
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ λ · Σ co_orders(sku, partner) × walk(bin, partner_bin)
          </div>
          <p style={{ marginTop: 10 }}>
            λ = {run.config.lam_aff}, μ = {run.config.mu_fill}, floor = {run.config.v_floor} × mean demand. Shelf penalty (metre-equivalents, levels 1 to 5):{" "}
            {run.config.erg_pen.join(", ")}.
          </p>
        </div>
        <div className="panel">
          <h2>Complexity</h2>
          <p>N SKUs, M bins, b lines per order.</p>
          <ul>
            <li>Feasibility mask: O(N·M), vectorised</li>
            <li>Greedy placement: O(N·M log M)</li>
            <li>Pair mining: O(Σ b²) over orders (large baskets capped)</li>
            <li>CP-SAT: NP-hard in general; run on the fastest SKUs with pruned candidates and a time limit; the gap is reported</li>
            <li>Local search: O(trials × orders touching the swapped SKUs)</li>
            <li>Route simulation: O(orders × lines)</li>
          </ul>
          <p>
            Measured on this run: {Object.entries(run.summary.timing).map(([k, v]) => `${k} ${v}s`).join(" · ")}.
          </p>
        </div>
      </div>

      <Note kind="warn">
        <b>Limits.</b> SKU dimensions, hazard classes and the warehouse grid are synthetic and seeded. The time model is assumed, not measured. Gains are simulated on
        real order patterns, not on a real floor. CP-SAT closes {run.summary.extra?.cpsat?.gap != null ? `${(100 * (1 - run.summary.extra.cpsat.gap)).toFixed(0)}%` : "part"} of its optimality
        gap within the time limit, and neither CP-SAT nor local search improved held-out distance beyond the greedy layout here. Proprietary industry slotting algorithms are
        not public; this is built from public practice and published research.
      </Note>
    </>
  );
}
