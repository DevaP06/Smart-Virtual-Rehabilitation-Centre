import { useState } from "react";
import { BarChart3, Boxes, CalendarDays, Database, FlaskConical, Footprints, ShieldCheck, Table2, Timer, Warehouse } from "lucide-react";
import { Async, Card, Chip, InfoTip, LABEL, LADDER, Legend, Note, Panel, Plot, Segmented, TableScroll, fmt, less, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";
import { scenarioName } from "../nav.js";

const val = (k, p, m) => k[p]?.kpis?.[m]?.value;

// Plain-language definitions of every column (shown on hover or keyboard focus).
const HINT = {
  dist: "Average metres a picker walks per order on the held-out orders, using the standard return route.",
  vsB0: "Change in walking distance compared with the random rule-compliant layout (B0), with the 95% confidence interval from resampling order-days.",
  sshape: "The same average walking distance if the warehouse had a rear cross-aisle and pickers walked every visited aisle end to end (S-shape routing).",
  time: "Average seconds per order under the assumed time model: walking speed, seconds per pick and a height penalty.",
  fill: "Stored volume divided by the volume of the bins in use.",
  golden: "Share of fast-mover (class A) pick lines taken from chest-to-waist shelf levels 3 and 4.",
  pair: "Average walking distance between the bins of the strongest bought-together product pairs, weighted by how often they are ordered together.",
  refills: "Estimated bin refills per day: daily demand divided by how many units fit in the bin.",
  lph: "Pick lines completed per labour hour under the assumed time model.",
  viol: "Rule breaches found by the independent validator (size, weight, hazard zone, shelf level, neighbours). Zero is required.",
};

function Th({ children, hint }) {
  return (
    <th scope="col">
      <span className="th-in">
        {children}
        {hint && <InfoTip text={hint} />}
      </span>
    </th>
  );
}

export default function Overview({ run }) {
  const kp = useApi(`/api/runs/${run.id}/kpis`);
  const sens = useApi(`/api/runs/${run.id}/sensitivity`);
  const [view, setView] = useState("compact");
  return (
    <Async state={kp} skeleton="page" label="the results">
      {(k) => {
        const H = run.summary.headline;
        const ci = k[H].ci.return;
        const best = LADDER.filter((p) => !["naive", "B0_random", "B1_chaotic"].includes(p) && k[p]?.violations === 0).sort(
          (a, b) => val(k, a, "total_distance_m") - val(k, b, "total_distance_m"),
        )[0];
        const t0 = val(k, "B0_random", "avg_route_time_s");
        const t1 = val(k, H, "avg_route_time_s");
        const timeGain = 100 * (1 - t1 / t0);
        const fill = val(k, H, "fill_rate_pct");
        const fillRandom = val(k, "B0_random", "fill_rate_pct");
        const shown = LADDER.filter((p) => p !== "B0_random");
        const detailed = view === "detailed";
        const computed = run.created_at ? new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

        return (
          <div className="stack">
            <div className="chips">
              <Chip icon={Warehouse}>
                Scenario <b>{scenarioName(run)}</b>
              </Chip>
              <Chip icon={Database}>{run.dataset}</Chip>
              <Chip icon={FlaskConical}>
                Layout shown: <b>{LABEL[H]}</b>
              </Chip>
              <Chip icon={BarChart3}>
                Tested on <b>{run.summary.n_test.toLocaleString()}</b> held-out orders
              </Chip>
              <Chip icon={Table2}>Stored simulation results, not a live run</Chip>
              {computed && <Chip icon={CalendarDays}>Computed {computed}</Chip>}
            </div>

            <div className="kpi-grid">
              <Card
                icon={Footprints}
                tone={ci.reduction_pct > 0 ? "good" : "bad"}
                label="Travel distance vs random"
                value={less(ci.reduction_pct)}
                sub={`95% CI ${fmt(ci.reduction_ci_low)} to ${fmt(ci.reduction_ci_high)} · ${LABEL[H]}`}
              />
              <Card icon={Timer} tone={timeGain > 0 ? "good" : "bad"} label="Route time vs random" value={less(timeGain)} sub={`${fmt(t1, 0)} s vs ${fmt(t0, 0)} s per order`} />
              <Card icon={Boxes} tone={fill > fillRandom ? "good" : ""} label="Fill rate" value={`${fmt(fill)}%`} sub={`random: ${fmt(fillRandom)}%`} />
              <Card
                icon={ShieldCheck}
                tone={k[H].violations === 0 ? "good" : "bad"}
                label="Rule violations"
                value={k[H].violations}
                sub={`${k[H].violations === 0 ? "Every rule satisfied · " : ""}naive layout: ${k.naive.violations}`}
              />
            </div>

            <div className="grid-main">
              <Panel
                title="Walking distance saved, layout by layout"
                subtitle="How much less walking each layout needs than a random rule-compliant layout. Whiskers show the 95% confidence interval."
                icon={BarChart3}
              >
                <Legend
                  items={[
                    [COLORS.accent, `${LABEL[H]} (headline layout)`],
                    [COLORS.slate, "Other rule-compliant layouts"],
                    [COLORS.bad, "Layout that breaks rules"],
                  ]}
                />
                <Plot
                  height={380}
                  compactHeight={340}
                  summary={`Bar chart of the percentage reduction in walking distance versus the random layout. The headline layout, ${LABEL[H]}, reaches ${fmt(ci.reduction_pct)} percent; the shortest rule-compliant layout is ${LABEL[best]}.`}
                  data={[
                    {
                      type: "bar",
                      x: shown.map((p) => LABEL[p]),
                      y: shown.map((p) => k[p].ci.return.reduction_pct),
                      error_y: {
                        type: "data",
                        symmetric: false,
                        array: shown.map((p) => k[p].ci.return.reduction_ci_high - k[p].ci.return.reduction_pct),
                        arrayminus: shown.map((p) => k[p].ci.return.reduction_pct - k[p].ci.return.reduction_ci_low),
                        color: COLORS.text2,
                        thickness: 1.4,
                      },
                      marker: { color: shown.map((p) => (k[p].violations ? COLORS.bad : p === H ? COLORS.accent : COLORS.slate)) },
                      hovertemplate: "%{x}<br>%{y:.1f}% less walking<extra></extra>",
                    },
                  ]}
                  layout={{ yaxis: { title: "% less walking than random" }, xaxis: { tickangle: -30 }, showlegend: false }}
                />
              </Panel>

              <Panel title="Can the ranking be trusted?" subtitle="The time model is an assumption, so the ranking is re-checked under many different assumptions." icon={FlaskConical}>
                <Async state={sens} skeleton="kpis" label="the sensitivity check">
                  {(s) => (
                    <div className="stack">
                      <div className="stat-grid">
                        <div className="stat">
                          <div className="stat-value">{fmt(100 * s.headline_beats_random_share, 0)}%</div>
                          <div className="stat-label">of {s.grid.length} settings: Full beats the random layout</div>
                        </div>
                        <div className="stat">
                          <div className="stat-value">{fmt(100 * s.same_ranking_share, 0)}%</div>
                          <div className="stat-label">of settings: the order of B0, B2 and Full is unchanged</div>
                        </div>
                      </div>
                      <p className="muted" style={{ margin: 0 }}>
                        Settings vary walking speed, seconds per pick and the shelf-height penalty.
                      </p>
                    </div>
                  )}
                </Async>
                <div className="stack" style={{ marginTop: 14 }}>
                  <Note>
                    Gains are measured in a simulator replaying real order patterns, not on a real floor. Dimensions, hazard classes and the warehouse grid are synthetic and seeded.
                  </Note>
                  <Note kind="warn">
                    <b>Reading the table honestly.</b> The lowest distance among rule-compliant layouts is <b>{LABEL[best]}</b>. Adding the golden zone, affinity and best-fit terms spends some distance to buy
                    ergonomics (more A-picks at golden height), shorter co-order distances, a higher fill rate and shorter route times. Tighter bins also mean more refills per day, so best-fit is a real
                    trade-off. The naive layout is short only because it ignores {k.naive.violations} safety rules. Chaotic stow (B1) behaves like B0 here because baskets are multi-line.
                  </Note>
                </div>
              </Panel>
            </div>

            <Panel
              title="Ablation ladder: what each component adds"
              subtitle={`Evaluated on ${run.summary.n_test.toLocaleString()} held-out orders (later 30% of the period). Random layouts average several seeds. Confidence intervals are bootstrapped over order-days against the B0 baseline.`}
              icon={Table2}
              actions={
                <Segmented
                  label="Table detail"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "compact", label: "Key columns" },
                    { value: "detailed", label: "All columns" },
                  ]}
                />
              }
            >
              <TableScroll label="Ablation ladder table">
                <table className="data">
                  <caption className="sr-only">Each row is a layout. Columns compare walking distance, time, space use and rule violations.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Layout</th>
                      <Th hint={HINT.dist}>m / order</Th>
                      <Th hint={HINT.vsB0}>vs B0 (95% CI)</Th>
                      {detailed && <Th hint={HINT.sshape}>m / order, S-shape</Th>}
                      <Th hint={HINT.time}>Route time (s)</Th>
                      <Th hint={HINT.fill}>Fill %</Th>
                      {detailed && <Th hint={HINT.golden}>A-picks at golden height %</Th>}
                      {detailed && <Th hint={HINT.pair}>Co-ordered pair distance (m)</Th>}
                      {detailed && <Th hint={HINT.refills}>Refills / day</Th>}
                      {detailed && <Th hint={HINT.lph}>Lines / labour h</Th>}
                      <Th hint={HINT.viol}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {LADDER.map((p) => (
                      <tr key={p} className={p === H ? "hl" : ""}>
                        <td>
                          {LABEL[p]} {p === H && <span className="badge accent">headline</span>}
                        </td>
                        <td>{fmt(val(k, p, "avg_distance_per_order_m"))}</td>
                        <td>{p === "B0_random" ? "baseline" : `${less(k[p].ci.return.reduction_pct)} [${fmt(k[p].ci.return.reduction_ci_low)}, ${fmt(k[p].ci.return.reduction_ci_high)}]`}</td>
                        {detailed && <td>{fmt(val(k, p, "avg_distance_per_order_m_s_shape"))}</td>}
                        <td>{fmt(val(k, p, "avg_route_time_s"), 0)}</td>
                        <td>{fmt(val(k, p, "fill_rate_pct"))}</td>
                        {detailed && <td>{fmt(val(k, p, "class_a_golden_share_pct"), 0)}</td>}
                        {detailed && <td>{fmt(val(k, p, "pair_distance_m"))}</td>}
                        {detailed && <td>{fmt(val(k, p, "replenishments_per_day"), 0)}</td>}
                        {detailed && <td>{fmt(val(k, p, "lines_per_labour_hour"), 0)}</td>}
                        <td className={k[p].violations === 0 ? "zero" : "nonzero"}>
                          <span className="cell-flag">
                            {k[p].violations === 0 ? "✓ " : "✕ "}
                            {k[p].violations}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          </div>
        );
      }}
    </Async>
  );
}
