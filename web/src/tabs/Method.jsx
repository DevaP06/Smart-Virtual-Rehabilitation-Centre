import { Clock, Cpu, FlaskConical, Workflow } from "lucide-react";
import { Note, Panel } from "../ui.jsx";

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
    <div className="stack">
      <Panel
        title="From raw orders to a tested layout"
        subtitle="Seven stages. The first six run offline and store their results; the dashboard you are looking at only reads those stored results."
        icon={Workflow}
      >
        <ol className="pipeline" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Pipeline stages">
          {LAYERS.map(([t, d]) => {
            const [tag, ...name] = t.split(" ");
            return (
              <li className="stage" key={t}>
                <span className="stage-tag">{tag}</span>
                <h3>{name.join(" ")}</h3>
                <p>{d}</p>
              </li>
            );
          })}
        </ol>
        <p style={{ marginTop: 14, marginBottom: 0 }}>
          The optimizer, simulator and forecaster run offline (<code>python scripts/seed_db.py</code>) and store every layout, KPI and artefact in Postgres. The deployed API only reads, so the dashboard shows exactly the
          stored results and never a second copy of the numbers.
        </p>
      </Panel>

      <div className="grid-2">
        <Panel title="How a SKU picks its bin" subtitle="Bins that break a hard rule never get a score. Among the rest, the lowest cost wins; SKUs are placed fastest first." icon={Cpu}>
          <div className="formula">
            <div>
              cost = (demand + floor) <span className="op">×</span> (distance_to_depot + shelf_penalty)
            </div>
            <div>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="op">+</span> μ · wasted_volume_ratio
            </div>
            <div>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="op">+</span> λ · Σ co_orders(sku, partner) <span className="op">×</span> walk(bin, partner_bin)
            </div>
          </div>
          <dl className="dl" style={{ marginTop: 14 }}>
            <dt>λ (affinity)</dt>
            <dd>{run.config.lam_aff}</dd>
            <dt>μ (best-fit)</dt>
            <dd>{run.config.mu_fill}</dd>
            <dt>floor</dt>
            <dd>{run.config.v_floor} × mean demand</dd>
            <dt>Shelf penalty</dt>
            <dd>{run.config.erg_pen.join(", ")} (metre-equivalents, levels 1 to 5)</dd>
          </dl>
        </Panel>

        <Panel title="Complexity" subtitle="N SKUs, M bins, b lines per order." icon={FlaskConical}>
          <ul>
            <li>Feasibility mask: O(N·M), vectorised</li>
            <li>Greedy placement: O(N·M log M)</li>
            <li>Pair mining: O(Σ b²) over orders (large baskets capped)</li>
            <li>CP-SAT: NP-hard in general; run on the fastest SKUs with pruned candidates and a time limit; the gap is reported</li>
            <li>Local search: O(trials × orders touching the swapped SKUs)</li>
            <li>Route simulation: O(orders × lines)</li>
          </ul>
        </Panel>
      </div>

      <Panel title="Measured on this run" subtitle="Seconds spent in each step when this scenario was computed." icon={Clock}>
        <dl className="dl">
          {Object.entries(run.summary.timing).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}s</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Note kind="warn">
        <b>Limits.</b> SKU dimensions, hazard classes and the warehouse grid are synthetic and seeded. The time model is assumed, not measured. Gains are simulated on real order patterns, not on a real floor. CP-SAT closes{" "}
        {run.summary.extra?.cpsat?.gap != null ? `${(100 * (1 - run.summary.extra.cpsat.gap)).toFixed(0)}%` : "part"} of its optimality gap within the time limit, and neither CP-SAT nor local search improved held-out
        distance beyond the greedy layout here. Proprietary industry slotting algorithms are not public; this is built from public practice and published research.
      </Note>
    </div>
  );
}
