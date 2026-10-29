// Methodology: how a product gets its bin and how the result is tested. Every statement here is taken from the code (core/*.py,
// slotdb/*.py, docs/LIVE_OPERATIONS.md); numbers come from the selected stored run (its config, summary and EDA), not from this file.
import { BookOpen, Boxes, Clock, Cpu, Database, FlaskConical, GitBranch, Route, Scale, ShieldCheck, SlidersHorizontal, TrendingUp, Workflow } from "lucide-react";
import { Async, InfoTip, LABEL, LADDER, Note, Panel, Plot, RULE_LABEL, TableScroll, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

const LAYERS = [
  ["L1 Data", "Orders (real or synthetic), SKU master, warehouse grid"],
  ["L2 Ingest", "Clean returns and non-products, join SKU master, time split into training and held-out orders"],
  ["L3 Features", "Velocity and ABC, bought-together pair counts, weekly forecast, feasibility mask"],
  ["L4 Optimizer", "Greedy placement by cost, CP-SAT refinement, swap search, re-slot planner"],
  ["L5 Validator", "Independent re-check of every rule; no shared code with L4"],
  ["L6 Simulator", "Held-out replay, two routing policies, time model, KPIs, bootstrap CIs"],
  ["L7 Service + UI", "Database, FastAPI read API, React dashboard"],
];

// What each rung of the ablation ladder adds (core/experiment.py: LADDER and _ladder_cfg).
const RUNG = {
  naive: "SKUs in ID order into bins in ID order. Ignores every rule: the careless baseline.",
  B0_random: "Random order, random bin, but only bins that pass every rule. Averaged over several seeds. The baseline for all percentages.",
  B1_chaotic: "Software-directed random stow: a random legal bin, products in order of first appearance.",
  B2_abc: "Fastest products first into the cheapest bins by distance to the depot. No shelf-height, affinity or fit terms.",
  B3_golden: "Adds the shelf-height (ergonomic) penalty, so fast movers prefer the golden-zone levels.",
  B4_affinity: "Adds the bought-together term and the pull toward the depot for zero-demand products.",
  Full: "Adds the best-fit term (small products do not waste big bins). This is the headline layout.",
  "Full+CPSAT": "Re-solves the fastest products exactly with CP-SAT on top of Full.",
  "Full+CPSAT+LS": "Then runs a swap / relocate local search on top.",
};

function Eq({ title, src, children }) {
  return (
    <div className="eq">
      <div className="eq-head">
        <b>{title}</b>
        <code>{src}</code>
      </div>
      <div className="formula">{children}</div>
    </div>
  );
}

function Flow({ steps }) {
  return (
    <ol className="m-flow" aria-label="Flow">
      {steps.map(([t, d], i) => (
        <li key={t} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="m-flow-n">{i + 1}</span>
          <b>{t}</b>
          <span>{d}</span>
        </li>
      ))}
    </ol>
  );
}

function Architecture() {
  const boxes = [
    [Database, "Inputs", "Orders, SKU master, warehouse grid (your CSV files or seeded synthetic data)"],
    [Cpu, "core/ engine (Python)", "Features, optimizer, validator, simulator, forecaster. Runs offline: scripts/seed_db.py"],
    [Boxes, "Database", "Stored runs, KPIs, layouts and artefacts; live stock, movements and work orders (SQLite locally, Postgres when deployed)"],
    [GitBranch, "FastAPI", "api/index.py: read-only /api/runs/… · server/live_routes.py: /api/live/…"],
    [Workflow, "React + Vite dashboard", "Plotly charts and three.js 3D. Shows exactly what is stored; never recomputes a second copy"],
  ];
  return (
    <div className="m-arch" role="img" aria-label="Architecture: inputs go to the Python engine, which stores results in the database; FastAPI serves them to the React dashboard.">
      {boxes.map(([Icon, t, d], i) => (
        <div className="m-arch-step" key={t} style={{ animationDelay: `${i * 90}ms` }}>
          <div className="m-arch-box">
            <Icon size={18} aria-hidden="true" />
            <b>{t}</b>
            <span>{d}</span>
          </div>
          {i < boxes.length - 1 && <span className="m-arch-arrow" aria-hidden="true">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function Method({ run }) {
  const c = run.config;
  const s = run.summary;
  const eda = useApi(`/api/runs/${run.id}/eda`);
  const kp = useApi(`/api/runs/${run.id}/kpis`);
  const dpo = (p) => kp.data?.[p]?.kpis?.avg_distance_per_order_m?.value; // held-out metres per order
  const ladder = LADDER.filter((p) => RUNG[p]);
  const cp = s.extra?.cpsat;
  const ls = s.extra?.local_search;
  const hardRules = Object.keys(RULE_LABEL).filter((k) => k !== "total");
  return (
    <div className="stack">
      <Panel title="What this engine does" subtitle="One question: which bin should each product live in, so pickers walk less, space is used well and every safety and capacity rule holds?" icon={BookOpen}>
        <div className="grid-2">
          <div>
            <p>
              Given an order history, a product master (sizes, weights, hazard class, handling) and a warehouse grid, the engine places every product in exactly one bin. Bins that break a hard rule are never considered. Among the legal bins the lowest-cost one
              wins, where cost balances demand, distance to the depot, shelf height, wasted volume and distance to bought-together products.
            </p>
            <p style={{ marginBottom: 0 }}>
              The result is then tested on orders the optimizer never saw, against a random rule-compliant layout, and every placement is re-checked by a validator that shares no code with the optimizer.
            </p>
          </div>
          <dl className="dl">
            <dt>Products</dt>
            <dd>{s.n_skus.toLocaleString()}</dd>
            <dt>Bins</dt>
            <dd>{s.n_bins.toLocaleString()}</dd>
            <dt>Orders</dt>
            <dd>
              {s.n_orders.toLocaleString()} ({s.n_train.toLocaleString()} train · {s.n_test.toLocaleString()} held out)
            </dd>
            <dt>Training share</dt>
            <dd>{Math.round(100 * c.train_frac)}% of orders by time</dd>
          </dl>
        </div>
      </Panel>

      <Panel
        title="From raw orders to a tested layout"
        subtitle="Seven stages. The first six run offline and store their results; the dashboard you are looking at only reads those stored results."
        icon={Workflow}
      >
        <ol className="pipeline" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Pipeline stages">
          {LAYERS.map(([t, d], i) => {
            const [tag, ...name] = t.split(" ");
            return (
              <li className="stage m-in" key={t} style={{ animationDelay: `${i * 60}ms` }}>
                <span className="stage-tag">{tag}</span>
                <h3>{name.join(" ")}</h3>
                <p>{d}</p>
              </li>
            );
          })}
        </ol>
        <p style={{ marginTop: 14, marginBottom: 0 }}>
          The optimizer, simulator and forecaster run offline (<code>python scripts/seed_db.py</code>) and store every layout, KPI and artefact in the database. The API only reads them, so the dashboard shows exactly the stored results and never a second
          copy of the numbers.
        </p>
      </Panel>

      <div className="grid-2">
        <Panel title="1 · Demand analysis" subtitle="Computed on the training orders only." icon={TrendingUp}>
          <Flow
            steps={[
              ["Velocity", "pick lines per product in the training orders"],
              ["ABC classes", "products ranked by velocity; A covers the first 80% of demand, B up to 95%, C the rest (core/engine.py: abc_classes)"],
              ["Bought-together pairs", `how often two products share an order (baskets up to ${c.max_basket} lines); each product keeps its top ${c.topk} partners`],
            ]}
          />
          <Async state={eda} skeleton="panel" label="the demand profile">
            {(e) => (
              <div className="stack" style={{ marginTop: 12 }}>
                <p className="muted" style={{ margin: 0 }}>
                  In this run: <b>{e.abc_counts.A}</b> A, <b>{e.abc_counts.B}</b> B and <b>{e.abc_counts.C}</b> C products; the top 20% of products make <b>{fmt(e.top20pct_share, 0)}%</b> of pick lines.
                </p>
                <Plot
                  height={230}
                  compactHeight={200}
                  summary="Pareto curve: the share of pick lines covered as more products are included, fastest first."
                  data={[{ type: "scatter", mode: "lines", x: e.pareto.pct_skus, y: e.pareto.pct_lines, hoverinfo: "skip", line: { color: COLORS.accent, width: 3 } }]}
                  layout={{ xaxis: { title: "% of products, fastest first", range: [0, 100] }, yaxis: { title: "% of pick lines", range: [0, 101] }, showlegend: false }}
                />
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Placement uses the pair counts. Lift, Jaccard similarity and Louvain communities ({e.clusters?.n_clusters ?? "–"} groups in this run) are computed for the Data Analysis page; they describe the pairs, they do not move products.
                </p>
              </div>
            )}
          </Async>
        </Panel>

        <Panel title="2 · Constraints" subtitle="Hard rules decide which bins are candidates at all. Cost weights only choose among the legal ones." icon={ShieldCheck}>
          <ul className="help-list">
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <b>Size and volume:</b> the product's sorted dimensions must fit the bin's, and its pick-face volume must fit the bin's volume.
              </span>
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <b>Weight:</b> within the bin rating ({c.bin_cap.join(", ")} kg by level), the shelf beam ({c.beam_cap.join(", ")} kg) and the rack frame ({c.frame_cap} kg).
              </span>
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <b>Hazard:</b> hazardous products only go in the hazard zone and nothing else does; flammable and oxidizer products may not sit within one bay of each other.
              </span>
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <b>Shelf level:</b> fragile products on levels {c.fragile_levels[0]}–{c.fragile_levels[1]}; heavy products (heavy handling or over {c.heavy_kg} kg) on level {c.heavy_max_level} or lower.
              </span>
            </li>
          </ul>
          <p className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
            The independent validator (core/validate.py) re-derives these from the raw tables and counts breaches of each of its {hardRules.length} checks:
          </p>
          <div className="chips" style={{ marginBottom: 0 }}>
            {hardRules.map((k) => (
              <span className="chip" key={k}>
                {RULE_LABEL[k]}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="3 · How a SKU picks its bin" subtitle="Bins that break a hard rule never get a score. Among the rest, the lowest cost wins; SKUs are placed fastest first." icon={Cpu}>
          <Eq title="Placement cost of one product in one candidate bin" src="core/engine.py: assign_full">
            <div>
              cost = (demand + floor) <span className="op">×</span> (distance_to_depot + shelf_penalty)
            </div>
            <div>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="op">+</span> μ · scale · (1 − product_volume / bin_volume)
            </div>
            <div>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="op">+</span> λ · Σ co_orders(sku, partner) <span className="op">×</span> walk(bin, partner_bin)
            </div>
          </Eq>
          <p className="muted" style={{ fontSize: 13 }}>
            demand is the product's velocity; floor = v_floor × mean velocity keeps zero-demand products near the depot; the affinity sum runs over the top partners already placed. This is a greedy heuristic: it places one product at a time and does not guarantee a global optimum.
          </p>
          <dl className="dl">
            <dt>λ (affinity)</dt>
            <dd>{c.lam_aff}</dd>
            <dt>μ (best-fit)</dt>
            <dd>{c.mu_fill}</dd>
            <dt>floor</dt>
            <dd>{c.v_floor} × mean demand</dd>
            <dt>Shelf penalty</dt>
            <dd>{c.erg_pen.join(", ")} (metre-equivalents, levels 1 to 5)</dd>
          </dl>
        </Panel>

        <Panel title="4 · Refinement" subtitle="Two optional passes on top of the greedy layout. Both keep every rule." icon={SlidersHorizontal}>
          <ul className="help-list">
            <li>
              <Cpu size={16} aria-hidden="true" />
              <span>
                <b>CP-SAT:</b> re-solves the placement of the fastest non-hazardous products exactly (a generalised assignment with beam and rack-frame load limits) within a time limit. The solver's optimality gap is reported, so a feasible-but-not-proven answer is shown as such.
                {cp && (
                  <>
                    {" "}
                    This run: {cp.subset} products, status {cp.status}, {cp.moved} moved, gap {fmt(100 * cp.gap, 0)}%, {cp.seconds}s.
                  </>
                )}
              </span>
            </li>
            <li>
              <Cpu size={16} aria-hidden="true" />
              <span>
                <b>Local search:</b> swaps two products (or relocates one to a free, cheaper bin) when training pick distance plus shelf cost drops and all rules still hold; hazardous products are left alone.
                {ls && (
                  <>
                    {" "}
                    This run: {ls.trials.toLocaleString()} trials, {ls.accepted} accepted.
                  </>
                )}
              </span>
            </li>
          </ul>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            Whether they help is measured, not assumed.
            {dpo("Full") != null && dpo("Full+CPSAT") != null && dpo("Full+CPSAT+LS") != null && (
              <>
                {" "}
                Held-out walking per order in this run: greedy {fmt(dpo("Full"))} m, with CP-SAT {fmt(dpo("Full+CPSAT"))} m, with local search {fmt(dpo("Full+CPSAT+LS"))} m.
              </>
            )}
          </p>
        </Panel>
      </div>

      <Panel title="The ablation ladder" subtitle="Each rung adds one idea, so the Overview chart shows what each idea is worth. Same held-out orders, same simulator." icon={Scale}>
        <TableScroll label="Layouts compared">
          <table className="data compact">
            <caption className="sr-only">The layouts compared and what each one adds.</caption>
            <thead>
              <tr>
                <th scope="col">Layout</th>
                <th scope="col">What it is</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((p) => (
                <tr key={p}>
                  <td>
                    <b>{LABEL[p]}</b>
                  </td>
                  <td className="wrap">{RUNG[p]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      <div className="grid-2">
        <Panel title="5 · Pick-path planning" subtitle="Both policies serve the two sides of an aisle in one walk and start and end at the depot." icon={Route}>
          <Eq title="Return route (front cross-aisle only)" src="core/simulate.py: route_stats">
            <div>distance = 2 · Σ deepest_pick(aisle) + 2 · x_far_aisle</div>
          </Eq>
          <Eq title="S-shape (needs a rear cross-aisle)" src="core/simulate.py: route_stats">
            <div>distance = k · L + 2 · x_far_aisle + L · (k mod 2)</div>
          </Eq>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            k = aisles visited, L = aisle length, x_far_aisle = distance across to the farthest visited aisle. The Pick Path Simulator draws these walks for single orders.
          </p>
        </Panel>

        <Panel title="6 · Simulation and evaluation" subtitle="Everything is scored on orders the layouts never saw." icon={FlaskConical}>
          <Eq title="Assumed time model" src="core/simulate.py + core/config.py">
            <div>time = distance / {c.speed} m/s + lines × {c.pick_s} s + Σ level_seconds</div>
            <div>level_seconds by shelf level = [{c.level_sec.join(", ")}] s</div>
          </Eq>
          <ul className="help-list">
            <li>
              <FlaskConical size={16} aria-hidden="true" />
              <span>
                <b>Baseline:</b> the random rule-compliant layout, averaged over several random seeds (5 in a normal run, 3 with <code>--fast</code>).
              </span>
            </li>
            <li>
              <FlaskConical size={16} aria-hidden="true" />
              <span>
                <b>Confidence intervals:</b> bootstrap over order-days (1,000 resamples; 2.5th and 97.5th percentiles), paired against the baseline for the percentage reduction.
              </span>
            </li>
            <li>
              <FlaskConical size={16} aria-hidden="true" />
              <span>
                <b>Time-model sensitivity:</b> the ranking is re-checked over a grid of walking speeds, seconds per pick and shelf-height penalties, because the time model is assumed.
              </span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="7 · Forecasting and re-slotting" subtitle="Demand changes; the layout can follow it, if the move is worth its cost." icon={TrendingUp}>
          <ul className="help-list">
            <li>
              <TrendingUp size={16} aria-hidden="true" />
              <span>
                <b>Offline study:</b> LightGBM quantile models (p10, p50, p90) on weekly pick lines, compared with “same as last week” and “mean of the last 4 weeks”. The Forecast page reports whether it actually beats them; the study only uses it if it does.
              </span>
            </li>
            <li>
              <TrendingUp size={16} aria-hidden="true" />
              <span>
                <b>Live planner:</b> uses a recency-weighted average of the last 8 weekly pick counts (a lighter model that fits a serverless function), not LightGBM.
              </span>
            </li>
          </ul>
          <Eq title="When a swap is proposed (fast product a, slow product b)" src="core/reslot.py: propose">
            <div>(pred_a − pred_b) · (bin_cost_a − bin_cost_b) − 150 &gt; 0</div>
            <div>moving a to a free closer bin: pred_a · (bin_cost_a − bin_cost_free) − 75 &gt; 0</div>
          </Eq>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Costs are in metre-equivalents (a swap handles two products: 150; a move handles one: 75), at most 20 changes per run, every rule re-checked. The planner only proposes: nothing changes until the floor does the move and it is marked done.
          </p>
        </Panel>

        <Panel title="8 · Live operations" subtitle="Setup, Live Warehouse, Inventory, Receiving and Work Orders." icon={Boxes}>
          <ul className="help-list">
            <li>
              <Boxes size={16} aria-hidden="true" />
              <span>
                <b>Stock is the sum of movements.</b> The movement log is append-only; a health check recomputes stock from it and raises an alert on any mismatch.
              </span>
            </li>
            <li>
              <Boxes size={16} aria-hidden="true" />
              <span>
                <b>Putaway uses the same rules and the same cost function</b> as the offline placer, then the independent validator runs on the whole layout before anything is saved.
              </span>
            </li>
            <li>
              <Boxes size={16} aria-hidden="true" />
              <span>
                <b>Simulate orders</b> applies random orders drawn from recent demand and bought-together habits exactly as real orders; each pick is recorded as a movement.
              </span>
            </li>
          </ul>
        </Panel>
      </div>

      <Panel title="Architecture" subtitle="Where each piece runs." icon={GitBranch}>
        <Architecture />
      </Panel>

      <Panel title="Measured on this run" subtitle="Seconds spent in each step when this scenario was computed." icon={Clock}>
        <dl className="dl">
          {Object.entries(s.timing).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}s</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Note kind="warn">
        <b>Validation and limits.</b> Automated tests cover the validator, the end-to-end experiment, company imports and live operations (tests/). SKU dimensions, hazard classes and the warehouse grid are synthetic and seeded. The time model is assumed, not
        measured. Gains are simulated on real order patterns, not on a real floor, and are not a statement of statistical significance beyond the reported confidence intervals. CP-SAT stops at its time limit with the optimality gap reported above, which is not proof of an optimal layout. The live pages have no
        login or roles. Proprietary industry slotting algorithms are not public; this is built from public practice and published research.
      </Note>
    </div>
  );
}
