import { Async, Card, LABEL, LADDER, Note, Plot, fmt, less, useApi } from "../ui.jsx";

const val = (k, p, m) => k[p]?.kpis?.[m]?.value;

export default function Overview({ run }) {
  const kp = useApi(`/api/runs/${run.id}/kpis`);
  const sens = useApi(`/api/runs/${run.id}/sensitivity`);
  return (
    <Async state={kp}>
      {(k) => {
        const H = run.summary.headline;
        const ci = k[H].ci.return;
        const best = LADDER.filter((p) => !["naive", "B0_random", "B1_chaotic"].includes(p) && k[p]?.violations === 0).sort(
          (a, b) => val(k, a, "total_distance_m") - val(k, b, "total_distance_m"),
        )[0];
        const t0 = val(k, "B0_random", "avg_route_time_s");
        const t1 = val(k, H, "avg_route_time_s");
        return (
          <>
            <div className="grid cards">
              <Card
                tone="good"
                label="Travel distance vs random"
                value={less(ci.reduction_pct)}
                sub={`95% CI ${fmt(ci.reduction_ci_low)} to ${fmt(ci.reduction_ci_high)} · ${LABEL[H]}`}
              />
              <Card
                tone="good"
                label="Route time vs random"
                value={less(100 * (1 - t1 / t0))}
                sub={`${fmt(t1, 0)} s vs ${fmt(t0, 0)} s per order`}
              />
              <Card
                label="Fill rate"
                value={`${fmt(val(k, H, "fill_rate_pct"))}%`}
                sub={`random: ${fmt(val(k, "B0_random", "fill_rate_pct"))}%`}
              />
              <Card
                tone={k[H].violations === 0 ? "good" : "bad"}
                label="Rule violations"
                value={k[H].violations}
                sub={`naive layout: ${k.naive.violations}`}
              />
            </div>

            <div className="panel">
              <h2>Ablation ladder: what each component adds</h2>
              <p style={{ color: "var(--muted)" }}>
                Evaluated on {run.summary.n_test.toLocaleString()} held-out orders (later 30% of the period). Random layouts average
                several seeds. CIs are bootstrapped over order-days against the B0 baseline.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Layout</th>
                      <th>m / order</th>
                      <th>vs B0 (95% CI)</th>
                      <th>m / order, S-shape</th>
                      <th>Route time (s)</th>
                      <th>Fill %</th>
                      <th>A-picks at golden height %</th>
                      <th>Co-ordered pair distance (m)</th>
                      <th>Refills / day</th>
                      <th>Lines / labour h</th>
                      <th>Violations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LADDER.map((p) => (
                      <tr key={p} className={p === H ? "hl" : ""}>
                        <td>{LABEL[p]}</td>
                        <td>{fmt(val(k, p, "avg_distance_per_order_m"))}</td>
                        <td>
                          {p === "B0_random" ? "baseline" : `${less(k[p].ci.return.reduction_pct)} [${fmt(k[p].ci.return.reduction_ci_low)}, ${fmt(k[p].ci.return.reduction_ci_high)}]`}
                        </td>
                        <td>{fmt(val(k, p, "avg_distance_per_order_m_s_shape"))}</td>
                        <td>{fmt(val(k, p, "avg_route_time_s"), 0)}</td>
                        <td>{fmt(val(k, p, "fill_rate_pct"))}</td>
                        <td>{fmt(val(k, p, "class_a_golden_share_pct"), 0)}</td>
                        <td>{fmt(val(k, p, "pair_distance_m"))}</td>
                        <td>{fmt(val(k, p, "replenishments_per_day"), 0)}</td>
                        <td>{fmt(val(k, p, "lines_per_labour_hour"), 0)}</td>
                        <td className={k[p].violations === 0 ? "zero" : "nonzero"}>{k[p].violations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid two" style={{ marginTop: 16 }}>
              <div className="panel">
                <h3>Distance reduction vs B0, with 95% CI</h3>
                <Plot
                  height={340}
                  data={[
                    {
                      type: "bar",
                      x: LADDER.filter((p) => p !== "B0_random").map((p) => LABEL[p]),
                      y: LADDER.filter((p) => p !== "B0_random").map((p) => k[p].ci.return.reduction_pct),
                      error_y: {
                        type: "data",
                        symmetric: false,
                        array: LADDER.filter((p) => p !== "B0_random").map((p) => k[p].ci.return.reduction_ci_high - k[p].ci.return.reduction_pct),
                        arrayminus: LADDER.filter((p) => p !== "B0_random").map((p) => k[p].ci.return.reduction_pct - k[p].ci.return.reduction_ci_low),
                      },
                      marker: { color: LADDER.filter((p) => p !== "B0_random").map((p) => (k[p].violations ? "#f87171" : p === H ? "#38bdf8" : "#64748b")) },
                    },
                  ]}
                  layout={{ yaxis: { title: "% less distance" }, xaxis: { tickangle: -30 }, margin: { l: 56, r: 16, t: 16, b: 110 } }}
                />
              </div>
              <div className="panel">
                <h3>Does the ranking survive different time assumptions?</h3>
                <Async state={sens}>
                  {(s) => (
                    <>
                      <p>
                        The time model (walking speed, seconds per pick, height penalty) is an <b>assumption</b>. Across {s.grid.length} settings:
                      </p>
                      <ul>
                        <li>
                          Full layout beats random in <b>{fmt(100 * s.headline_beats_random_share, 0)}%</b> of settings.
                        </li>
                        <li>
                          The ordering of B0, B2 and Full is unchanged in <b>{fmt(100 * s.same_ranking_share, 0)}%</b> of settings.
                        </li>
                      </ul>
                    </>
                  )}
                </Async>
                <Note>
                  Gains are measured in a simulator replaying real order patterns, not on a real floor. Dimensions, hazard classes and the warehouse
                  grid are synthetic and seeded.
                </Note>
              </div>
            </div>

            <Note kind="warn">
              <b>Reading the table honestly.</b> The lowest distance among rule-compliant layouts is <b>{LABEL[best]}</b>. Adding the golden zone, affinity and best-fit
              terms spends some distance to buy ergonomics (more A-picks at golden height), shorter co-order distances, a higher fill rate and shorter route times. Tighter bins also mean more refills per day, so best-fit is a real trade-off. The naive layout is short only
              because it ignores {k.naive.violations} safety rules. Chaotic stow (B1) behaves like B0 here because baskets are multi-line.
            </Note>
          </>
        );
      }}
    </Async>
  );
}
