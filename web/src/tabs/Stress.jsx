// Demand Surge: what happens to a layout when a group of products suddenly sells much more?
//
// Two parts, kept apart on purpose:
//  1. A what-if explorer. It takes the STORED layout of the selected scenario (the SKU -> bin table from /api/runs/:id/layout) and scales the demand of the
//     products you choose. Everything on it is arithmetic on stored numbers, done in the browser; the optimizer is NOT re-run, so it proposes no new
//     placement. The cost it uses is the optimizer's own slot cost (distance to the depot + shelf-height penalty, core/engine.py World.slot_cost).
//  2. The stored stress test (/api/runs/:id/surge): a real offline simulation with the re-slotting planner. It exists only for scenarios with enough history.
import { Component, Suspense, lazy, useMemo, useState } from "react";
import { BarChart3, Boxes, CalendarClock, Footprints, Layers, Repeat, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { Async, Badge, Card, EmptyState, Legend, Note, Panel, Plot, Segmented, Select, Skeleton, TableScroll, fmt, less, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

const Warehouse3D = lazy(() => import("../components/Warehouse3D.jsx"));

class Safe extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? <Note kind="warn">The 3D view could not start ({String(this.state.error.message || this.state.error)}). The numbers and tables on this page do not depend on it.</Note> : this.props.children;
  }
}

const FACTORS = [1.5, 2, 4, 8, 12];
const SHARES = [5, 10, 20];
const WHO = [
  { value: "sample", label: "A sample of mid and slow movers" },
  { value: "category", label: "One category" },
  { value: "class", label: "One ABC class" },
];

const fnv = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Same rule as core/engine.py abc_classes: A = products whose share of demand BEFORE them is under 80%. Returns the number of A products. */
function countA(v) {
  const s = [...v].sort((a, b) => b - a);
  const tot = sum(s) || 1;
  let cum = 0;
  let a = 0;
  for (const x of s) {
    if (cum / tot < 0.8) a += 1;
    cum += x;
  }
  return a;
}

/** Which products surge. "sample" mirrors the offline stress test's pool (the slowest 80% of products, no hazardous ones) but takes a fixed pseudo-random sample by SKU id. */
function pickSkus(rows, who, { share, category, cls }) {
  if (who === "category") return new Set(rows.filter((r) => r.category === category).map((r) => r.sku));
  if (who === "class") return new Set(rows.filter((r) => r.abc === cls).map((r) => r.sku));
  const slow = [...rows].sort((a, b) => a.velocity - b.velocity).slice(0, Math.floor(rows.length * 0.8)).filter((r) => r.hazard === "none");
  const take = Math.max(1, Math.round((slow.length * share) / 100));
  return new Set(slow.sort((a, b) => fnv(a.sku) - fnv(b.sku)).slice(0, take).map((r) => r.sku));
}

function analyse(rows, erg, picked, factor) {
  const n = rows.length;
  const cost = rows.map((r) => r.x + r.y + (erg[r.level - 1] ?? 0)); // distance to the depot + shelf-height penalty of the bin each product sits in
  const base = rows.map((r) => r.velocity);
  const scn = rows.map((r) => (picked.has(r.sku) ? r.velocity * factor : r.velocity));
  const tb = sum(base) || 1;
  const ts = sum(scn) || 1;
  const wsum = (v) => sum(v.map((x, i) => x * cost[i]));
  const sortedCost = [...cost].sort((a, b) => a - b);
  // Giving the cheapest bins to the busiest products is the cheapest any assignment of these bins to these products can be (rearrangement inequality).
  // It ignores every size, weight and hazard rule, so it is a yardstick, not a layout.
  const rank = (v) => v.map((_, i) => i).sort((a, b) => v[b] - v[a] || a - b);
  const idealOf = (v) => {
    const per = new Array(n);
    rank(v).forEach((i, r) => (per[i] = sortedCost[r]));
    return per;
  };
  const idealBaseCost = idealOf(base);
  const idealScnCost = idealOf(scn);
  const dot = (v, c) => sum(v.map((x, i) => x * c[i]));
  const desc = (v) => [...v].sort((a, b) => b - a);
  const share20 = (v) => sum(desc(v).slice(0, Math.max(1, Math.ceil(0.2 * n)))) / (sum(v) || 1);
  const pareto = (v) => {
    const s = desc(v);
    const tot = sum(s) || 1;
    let c = 0;
    const cum = s.map((x) => (c += x) / tot);
    const pts = Array.from({ length: 101 }, (_, p) => Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1)));
    return { x: pts.map((_, p) => p), y: pts.map((i, p) => (p === 0 ? 0 : 100 * cum[i])) };
  };
  const excess = rows.map((r, i) => ({ r, i, v: scn[i], ex: scn[i] * (cost[i] - idealScnCost[i]), cost: cost[i], ideal: idealScnCost[i] })).sort((a, b) => b.ex - a.ex);
  const top = rows.map((r, i) => ({ sku: r.sku, base: base[i], scn: scn[i], hit: picked.has(r.sku) })).sort((a, b) => b.scn - a.scn).slice(0, 12);
  const sel = rows.filter((r) => picked.has(r.sku));
  return {
    n,
    totalBase: tb,
    totalScn: ts,
    nSel: sel.length,
    selLocs: sel.length,
    aisles: new Set(sel.map((r) => r.aisle)).size,
    selDemandShare: sum(sel.map((r) => r.velocity)) / tb,
    aBase: countA(base),
    aScn: countA(scn),
    topBase: share20(base),
    topScn: share20(scn),
    avgBase: wsum(base) / tb,
    avgScn: wsum(scn) / ts,
    idealBase: dot(base, idealBaseCost) / tb,
    idealScn: dot(scn, idealScnCost) / ts,
    paretoBase: pareto(base),
    paretoScn: pareto(scn),
    excess: excess.slice(0, 10),
    top,
    scn,
  };
}

function Explorer({ run, rows }) {
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  const [factor, setFactor] = useState(8);
  const [who, setWho] = useState("sample");
  const [share, setShare] = useState(10);
  const [category, setCategory] = useState(cats[0]);
  const [cls, setCls] = useState("C");
  const [level, setLevel] = useState("all");
  const erg = run.config.erg_pen;
  const picked = useMemo(() => pickSkus(rows, who, { share, category, cls }), [rows, who, share, category, cls]);
  const a = useMemo(() => analyse(rows, erg, picked, factor), [rows, erg, picked, factor]);
  const rows3d = useMemo(() => rows.map((r, i) => ({ ...r, velocity: a.scn[i] })), [rows, a.scn]);
  const gapBase = (100 * (a.avgBase - a.idealBase)) / a.idealBase;
  const gapScn = (100 * (a.avgScn - a.idealScn)) / a.idealScn;
  const costUp = (100 * (a.avgScn - a.avgBase)) / a.avgBase;
  const aisleTotal = run.summary.grid?.aisles;
  const what = who === "sample" ? `${a.nSel} mid and slow-moving products (${share}% of that group)` : who === "category" ? `all ${a.nSel} products in "${category}"` : `all ${a.nSel} class ${cls} products`;
  const levelOptions = [{ value: "all", label: "All" }, ...[1, 2, 3, 4, 5].map((l) => ({ value: l, label: String(l) }))];

  return (
    <div className="stack">
      <Panel
        title="Demand scenario"
        subtitle="A what-if on the stored layout. Choose which products sell more and by how much; every figure below is recalculated from the stored numbers. Nothing here changes the warehouse."
        icon={Zap}
        actions={<Badge tone="warn">What-if: the optimizer is not re-run</Badge>}
      >
        <div className="toolbar">
          <Select label="Sales multiplier" value={factor} onChange={(v) => setFactor(Number(v))} options={FACTORS.map((f) => ({ value: f, label: `${f}×` }))} hint="How many times as many pick lines the chosen products get." />
          <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
            <span className="field-label">Which products surge</span>
            <Segmented label="Which products surge" value={who} onChange={setWho} options={WHO} />
          </div>
          {who === "sample" && (
            <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
              <span className="field-label">Share of that group</span>
              <Segmented label="Share of mid and slow movers" value={String(share)} onChange={(v) => setShare(Number(v))} options={SHARES.map((s) => ({ value: String(s), label: `${s}%` }))} />
            </div>
          )}
          {who === "category" && <Select label="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} />}
          {who === "class" && (
            <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
              <span className="field-label">ABC class</span>
              <Segmented label="ABC class" value={cls} onChange={setCls} options={["A", "B", "C"].map((c) => ({ value: c, label: c }))} />
            </div>
          )}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }} aria-live="polite">
          Scenario: <b>{what}</b> sell <b>{factor}×</b> as many pick lines as in the training period. Only these products' own demand is scaled; products ordered together with them are not (the offline stress test below also repeats whole orders). The sample is a fixed pseudo-random pick by SKU id, so it is the same every time.
        </p>
      </Panel>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <Card icon={TrendingUp} label="Total demand" value={`+${fmt(100 * (a.totalScn / a.totalBase - 1))}%`} sub={`${Math.round(a.totalBase).toLocaleString()} → ${Math.round(a.totalScn).toLocaleString()} pick lines`} />
        <Card icon={Boxes} label="Products and bins affected" value={a.nSel.toLocaleString()} sub={`of ${a.n.toLocaleString()} · in ${a.aisles}${aisleTotal ? ` of ${aisleTotal}` : ""} aisle(s) · ${fmt(100 * a.selDemandShare)}% of baseline demand`} />
        <Card icon={Layers} label="Class A products" value={`${a.aBase} → ${a.aScn}`} sub="products that make up the first 80% of demand" />
        <Card icon={BarChart3} label="Demand held by the top 20% of products" value={`${fmt(100 * a.topBase, 0)}% → ${fmt(100 * a.topScn, 0)}%`} sub="concentration before and after" />
        <Card
          icon={Footprints}
          tone={costUp > 0.05 ? "bad" : ""}
          label="Average slot cost per pick line"
          value={`${fmt(a.avgBase)} → ${fmt(a.avgScn)}`}
          sub={`${less(-costUp)} metre-equivalents (distance to depot + shelf penalty), layout unchanged`}
        />
      </div>

      <div className="grid-2">
        <Panel title="Who sells how much" subtitle="The twelve busiest products in the scenario: baseline against scenario pick lines. Highlighted names are the ones that surge." icon={BarChart3}>
          <Legend items={[[COLORS.slate, "Baseline (training period)"], [COLORS.warn, "Scenario"]]} />
          <Plot
            height={360}
            compactHeight={300}
            summary={`Grouped bars of the twelve busiest products in the scenario, baseline and scenario pick lines. ${a.top.filter((t) => t.hit).length} of them are surging products.`}
            data={[
              { type: "bar", name: "baseline", x: a.top.map((t) => t.sku), y: a.top.map((t) => t.base), marker: { color: COLORS.slate }, hovertemplate: "%{x}<br>%{y:,.0f} pick lines<extra>baseline</extra>" },
              { type: "bar", name: "scenario", x: a.top.map((t) => t.sku), y: a.top.map((t) => t.scn), marker: { color: a.top.map((t) => (t.hit ? COLORS.warn : COLORS.slate)), opacity: 0.95 }, hovertemplate: "%{x}<br>%{y:,.0f} pick lines<extra>scenario</extra>" },
            ]}
            layout={{ barmode: "group", showlegend: false, xaxis: { title: "product", tickangle: -40 }, yaxis: { title: "pick lines" } }}
          />
        </Panel>
        <Panel title="How concentrated demand is" subtitle="Share of all pick lines covered as products are added, busiest first. A steeper curve means a few products matter more." icon={TrendingUp}>
          <Legend items={[[COLORS.slate, "Baseline"], [COLORS.warn, "Scenario"]]} />
          <Plot
            height={360}
            compactHeight={300}
            summary={`Pareto curves of baseline and scenario demand. The top 20 percent of products hold ${fmt(100 * a.topBase, 0)} percent of pick lines in the baseline and ${fmt(100 * a.topScn, 0)} percent in the scenario.`}
            data={[
              { type: "scatter", mode: "lines", name: "baseline", x: a.paretoBase.x, y: a.paretoBase.y, line: { color: COLORS.slate, width: 3 }, hovertemplate: "top %{x}% of products: %{y:.0f}% of pick lines<extra>baseline</extra>" },
              { type: "scatter", mode: "lines", name: "scenario", x: a.paretoScn.x, y: a.paretoScn.y, line: { color: COLORS.warn, width: 3 }, hovertemplate: "top %{x}% of products: %{y:.0f}% of pick lines<extra>scenario</extra>" },
            ]}
            layout={{ showlegend: false, xaxis: { title: "% of products, busiest first", range: [0, 100] }, yaxis: { title: "% of pick lines", range: [0, 101] } }}
          />
        </Panel>
      </div>

      <Panel
        title="Where it hits the warehouse"
        subtitle="The stored layout with each product coloured by its scenario demand (brighter = more pick lines, log scale). The surging products stay bright and everything else is dimmed, so you can see which racks, aisles and shelf levels carry the new load."
        icon={Boxes}
      >
        <div className="toolbar">
          <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
            <span className="field-label">Shelf level</span>
            <Segmented label="Shelf level" value={String(level)} onChange={(v) => setLevel(v === "all" ? "all" : Number(v))} options={levelOptions.map((o) => ({ ...o, value: String(o.value) }))} />
          </div>
        </div>
        <Safe>
          <Suspense fallback={<Skeleton variant="chart" label="the 3D warehouse" />}>
            <Warehouse3D rows={rows3d} grid={run.summary.grid} config={run.config} nBins={run.summary.n_bins} level={level} marked={picked} velocityText="pick lines in the scenario" />
          </Suspense>
        </Safe>
      </Panel>

      <Panel
        title="What it means for slotting"
        subtitle="The layout was built for the training-period demand. Under the scenario, how far is it from the best it could be if only distance and shelf height mattered?"
        icon={Repeat}
      >
        <div className="grid-2">
          <div className="stack">
            <ul className="help-list">
              <li>
                <Footprints size={16} aria-hidden="true" />
                <span>
                  Average slot cost per pick line with the layout unchanged: <b>{fmt(a.avgBase)}</b> → <b>{fmt(a.avgScn)}</b> metre-equivalents ({less(-costUp)}).
                </span>
              </li>
              <li>
                <Footprints size={16} aria-hidden="true" />
                <span>
                  Yardstick: if the cheapest bins went to the busiest products, ignoring every size, weight and hazard rule, that average would be <b>{fmt(a.idealBase)}</b> for the baseline and <b>{fmt(a.idealScn)}</b> for the scenario. The layout sits <b>{fmt(gapBase)}%</b> above the yardstick today and <b>{fmt(gapScn)}%</b> above it under the surge.
                </span>
              </li>
              <li>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  The yardstick is not a layout and not a recommendation: the real engine only moves products where every rule still holds, and it moves them only when the saving beats the cost of the move.
                </span>
              </li>
            </ul>
            <div className="btn-row">
              <a className="btn" href="#orders">
                <Repeat size={15} aria-hidden="true" /> Preview real re-slotting (Work Orders)
              </a>
              <a className="btn" href="#forecast">
                <CalendarClock size={15} aria-hidden="true" /> Forecast &amp; re-slotting study
              </a>
            </div>
          </div>
          <div>
            <h3 className="eyebrow" style={{ marginBottom: 8 }}>
              Products most out of place under this scenario
            </h3>
            <TableScroll label="Products most out of place">
              <table className="data compact">
                <caption className="sr-only">The ten products with the largest gap between the slot cost of their bin and the cheapest bin the yardstick would give them, weighted by their scenario demand.</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Bin</th>
                    <th scope="col">Pick lines</th>
                    <th scope="col" title="Slot cost of its bin, and of the bin the yardstick would give it">Slot cost now → yardstick</th>
                  </tr>
                </thead>
                <tbody>
                  {a.excess.map(({ r, v, cost, ideal }) => (
                    <tr key={r.sku}>
                      <td>
                        <code>{r.sku}</code> {picked.has(r.sku) && <Badge tone="warn">surging</Badge>}
                      </td>
                      <td>
                        <code>{r.loc}</code>
                      </td>
                      <td className="num">{fmt(v, 0)}</td>
                      <td className="num">
                        {fmt(cost)} → {fmt(ideal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** The offline stress test stored with the run (only for scenarios with enough history). Real planner, real simulation. */
function StoredTest({ s }) {
  return (
    <div className="stack">
      <Panel
        title="Stored stress test: does the layout recover?"
        subtitle={`Computed offline with the re-slotting planner. In the last 4 weeks, ${s.n_surge_skus} mid and slow-moving SKUs sell about ${s.factor}× as much, together with the items ordered with them. The static layout is frozen after training; the planner forecasts each week, swaps mis-slotted SKUs when the saving beats a relocation cost of ${s.move_cost_m} m-equivalents, and keeps every rule satisfied.`}
        icon={TrendingUp}
      >
        <div className="kpi-grid">
          <Card icon={Footprints} label="Frozen layout" value={`${fmt(s.static_total / 1000, 0)} km`} sub="whole held-out period" />
          <Card icon={Repeat} tone={s.reslot_total_with_moves < s.static_total ? "good" : "bad"} label="Re-slotted, incl. move cost" value={`${fmt(s.reslot_total_with_moves / 1000, 0)} km`} sub={`${fmt(100 * (1 - s.reslot_total_with_moves / s.static_total))}% less · ${s.total_moves} swaps`} />
          <Card icon={ShieldCheck} tone={s.violations === 0 ? "good" : "bad"} label="Rule violations after re-slotting" value={s.violations} sub={s.violations === 0 ? "Every rule still satisfied" : undefined} />
        </div>
        {s.total_moves === 0 && (
          <div style={{ marginTop: 14 }}>
            <Note>No swap met the planner's conditions in this scenario (weekly saving above the relocation cost, every rule still satisfied), so the re-slotted layout is identical to the frozen one.</Note>
          </div>
        )}
      </Panel>
      <Panel title="Walking distance, week by week" subtitle="The shaded band is the simulated surge period." icon={TrendingUp}>
        <Legend items={[[COLORS.bad, "Frozen layout"], [COLORS.accent, "Re-slotted layout"], [COLORS.warn, "Simulated surge weeks"]]} />
        <Plot
          height={360}
          compactHeight={300}
          summary={`Line chart of kilometres walked each week for a frozen layout and a re-slotted layout. The surge begins in week ${s.surge_start_week}.`}
          data={[
            { type: "scatter", mode: "lines+markers", name: "frozen layout", x: s.weeks.map((w) => w.week), y: s.weeks.map((w) => w.static_m / 1000), line: { color: COLORS.bad, width: 2.5 }, marker: { size: 5 }, hovertemplate: "week %{x}<br>%{y:,.0f} km<extra>frozen</extra>" },
            { type: "scatter", mode: "lines+markers", name: "re-slotted", x: s.weeks.map((w) => w.week), y: s.weeks.map((w) => w.reslot_m / 1000), line: { color: COLORS.accent, width: 2.5 }, marker: { size: 5 }, hovertemplate: "week %{x}<br>%{y:,.0f} km<extra>re-slotted</extra>" },
          ]}
          layout={{
            xaxis: { title: "week" },
            yaxis: { title: "km walked that week" },
            showlegend: false,
            shapes: [{ type: "rect", xref: "x", x0: s.surge_start_week - 0.5, x1: Math.max(...s.weeks.map((w) => w.week)) + 0.5, yref: "paper", y0: 0, y1: 1, fillcolor: "rgba(216,149,69,0.14)", line: { width: 0 }, layer: "below" }],
            annotations: [{ x: s.surge_start_week, y: 1, yref: "paper", text: "surge", showarrow: false, font: { color: COLORS.warn }, xanchor: "left", yanchor: "top" }],
          }}
        />
      </Panel>
      <Note kind="warn">The surge is simulated by repeating real orders; it is a stress test, not a prediction. The planner only sees demand after it happens (it forecasts from past weeks), so it lags the first surge week and then catches up.</Note>
    </div>
  );
}

export default function Stress({ run }) {
  const lay = useApi(`/api/runs/${run.id}/layout?policy=Full`);
  const st = useApi(`/api/runs/${run.id}/surge`);
  return (
    <div className="stack">
      <Async state={lay} skeleton="page" label="the stored layout">
        {(rows) => (rows.length ? <Explorer run={run} rows={rows} /> : <EmptyState icon={Boxes} title="No stored layout">This scenario has no stored layout to analyse.</EmptyState>)}
      </Async>
      <Async state={st} skeleton="panel" label="the stored stress test">
        {(s) =>
          s ? (
            <StoredTest s={s} />
          ) : (
            <Note>
              <CalendarClock size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
              <b>No stored stress test for this scenario.</b> The offline stress test (with the real re-slotting planner) needs at least 8 training weeks and several weeks after them, and this scenario's history is shorter. The what-if above works for every scenario; a scenario seeded from a longer order history can include the stored test.
            </Note>
          )
        }
      </Async>
    </div>
  );
}
