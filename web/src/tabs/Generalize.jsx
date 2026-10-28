import { BarChart3, Grid3x3, Layers, Users } from "lucide-react";
import { Async, EmptyState, InfoTip, Note, Panel, Plot, TableScroll, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";
import { PROFILE } from "../nav.js";

const PROFILE_LABEL = { ...PROFILE, dark_store: "Dark store (synthetic)" };
const SHORT = { avg_distance_per_order_m: "distance", fill_rate_pct: "fill", class_a_golden_share_pct: "golden" };

function Cohorts({ run }) {
  const st = useApi(`/api/runs/${run.id}/cohort`);
  return (
    <Async state={st} skeleton="chart" label="the cohort test">
      {(c) =>
        !c ? (
          <EmptyState icon={Users} title="No cohorts to compare">
            This scenario has no cohorts large enough to train and test on.
          </EmptyState>
        ) : (
          <div className="stack">
            {(() => {
              const z = c.train_rows.map((x) => c.cohorts.map((y) => c.matrix[x][y].reduction_pct));
              const flat = z.flat();
              const lo = Math.min(...flat);
              const hi = Math.max(...flat);
              // label colour chosen per cell so it stays readable on both the dark and the bright end of the scale
              const notes = c.train_rows.flatMap((x, i) =>
                c.cohorts.map((y, j) => ({
                  x: y,
                  y: x,
                  text: `${fmt(z[i][j])}%`,
                  showarrow: false,
                  font: { size: 13, color: z[i][j] < lo + (hi - lo) * 0.6 ? "#f8fafc" : "#0b1220" },
                })),
              );
              return (
                <Plot
                  height={110 + 58 * c.train_rows.length}
                  compactHeight={130 + 52 * c.train_rows.length}
                  summary={`Heatmap of percentage less walking than random. Rows are the order group a layout was trained on, columns are the group it was tested on. Values range from ${fmt(lo)} to ${fmt(hi)} percent.`}
                  data={[
                    {
                      type: "heatmap", x: c.cohorts, y: c.train_rows, colorscale: "Viridis", z, zmin: lo, zmax: hi,
                      hovertemplate: "trained on %{y}<br>tested on %{x}<br>%{z:.1f}% less walking than random<extra></extra>",
                      colorbar: { title: { text: "% less walking" }, thickness: 12 },
                    },
                  ]}
                  layout={{
                    annotations: notes,
                    xaxis: { title: "tested on (later period)", tickangle: -25 },
                    yaxis: { title: "trained on (early period)", autorange: "reversed" },
                  }}
                />
              );
            })()}
            <TableScroll label="Cohort results">
              <table className="data">
                <caption className="sr-only">For each test group: result when the layout was trained on itself, on all orders, and on the worst other group.</caption>
                <thead>
                  <tr>
                    <th scope="col">Test group</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Trained on itself</th>
                    <th scope="col">Trained on all orders</th>
                    <th scope="col">Worst other group</th>
                    <th scope="col">Drop vs itself</th>
                  </tr>
                </thead>
                <tbody>
                  {c.cohorts.map((y) => {
                    const self = c.matrix[y][y].reduction_pct;
                    const others = c.cohorts.filter((x) => x !== y).map((x) => [x, c.matrix[x][y].reduction_pct]);
                    const [wx, wv] = others.reduce((a, b) => (b[1] < a[1] ? b : a));
                    return (
                      <tr key={y}>
                        <td>{y}</td>
                        <td>{c.sizes[y].test.toLocaleString()}</td>
                        <td>{fmt(self)}%</td>
                        <td>{fmt(c.matrix["all orders"][y].reduction_pct)}%</td>
                        <td>
                          {fmt(wv)}% ({wx})
                        </td>
                        <td className={self - wv > 5 ? "nonzero" : ""}>{fmt(self - wv)} pts</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <Note>
              A large drop means the layout learned the habits of one group (plausibly: small-basket orders reward putting the fastest single items closest, large baskets reward grouping items bought together) and does
              worse for another. We did not test the reason. It is a reason to retrain or re-slot when the customer mix changes. Every layout in this grid was rule-checked: {c.violations} violations.
            </Note>
          </div>
        )
      }
    </Async>
  );
}

function Datasets() {
  const st = useApi("/api/compare");
  return (
    <Async state={st} skeleton="page" label="the dataset comparison">
      {(d) => {
        const rows = [...d.datasets].sort((a, b) => b.full_reduction.pct - a.full_reduction.pct);
        const nameOf = (p) => PROFILE_LABEL[p] || p;
        return (
          <div className="stack">
            <Panel title="Gain by dataset" subtitle="Walking saved by the Full layout against a random layout, on each dataset's own held-out orders. Whiskers show the 95% confidence interval." icon={BarChart3}>
              <Plot
                height={300}
                compactHeight={280}
                summary={`Bar chart of percentage less walking per dataset: ${rows.map((r) => `${nameOf(r.profile)} ${fmt(r.full_reduction.pct)} percent`).join("; ")}.`}
                data={[
                  {
                    type: "bar",
                    x: rows.map((r) => nameOf(r.profile)),
                    y: rows.map((r) => r.full_reduction.pct),
                    error_y: {
                      type: "data",
                      symmetric: false,
                      array: rows.map((r) => r.full_reduction.hi - r.full_reduction.pct),
                      arrayminus: rows.map((r) => r.full_reduction.pct - r.full_reduction.lo),
                      color: COLORS.text2,
                      thickness: 1.4,
                    },
                    marker: { color: COLORS.accent },
                    hovertemplate: "%{x}<br>%{y:.1f}% less walking<extra></extra>",
                  },
                ]}
                layout={{ yaxis: { title: "% less walking than random", rangemode: "tozero" }, showlegend: false }}
              />
            </Panel>

            <TableScroll label="Dataset comparison">
              <table className="data">
                <caption className="sr-only">One row per dataset: size, basket structure, demand concentration and the gain from the method.</caption>
                <thead>
                  <tr>
                    <th scope="col">Dataset</th>
                    <th scope="col">SKUs</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Lines / order</th>
                    <th scope="col">Single-line %</th>
                    <th scope="col">
                      <span className="th-in">
                        Top 20% of SKUs carry <InfoTip text="Share of all pick lines taken from the fastest 20% of SKUs. Higher means demand is more concentrated." />
                      </span>
                    </th>
                    <th scope="col">Less walking (Full vs random)</th>
                    <th scope="col">ABC zoning alone</th>
                    <th scope="col">Route time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.run_id}>
                      <td>
                        {nameOf(r.profile)}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.dataset}
                        </div>
                      </td>
                      <td>{r.n_skus.toLocaleString()}</td>
                      <td>{r.n_orders.toLocaleString()}</td>
                      <td>{fmt(r.lines_per_order)}</td>
                      <td>{fmt(r.single_line_pct, 0)}%</td>
                      <td>{fmt(r.top20_share, 0)}%</td>
                      <td>
                        <b>{fmt(r.full_reduction.pct)}%</b> [{fmt(r.full_reduction.lo)}, {fmt(r.full_reduction.hi)}]
                      </td>
                      <td>{fmt(r.abc_reduction)}%</td>
                      <td>−{fmt(r.time_reduction_pct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <div className="grid-main">
              <Panel
                title="Do the same weights work on every dataset?"
                subtitle="The 36 weight settings were ranked on each dataset (distance = walking per order, fill = fill rate, golden = class-A picks at golden height). Spearman ρ near 1 means a setting that is good on one dataset is good on the other; near 0 means the choice does not transfer."
                icon={Layers}
              >
                <TableScroll label="Rank correlation between datasets">
                  <table className="data compact">
                    <thead>
                      <tr>
                        <th scope="col">Datasets</th>
                        {Object.keys(d.rank_correlation).map((m) => (
                          <th scope="col" key={m}>
                            ρ {SHORT[m]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.values(d.rank_correlation)[0] || []).map((p, i) => (
                        <tr key={i}>
                          <td>
                            {nameOf(p.a)} ↔ {nameOf(p.b)}
                          </td>
                          {Object.values(d.rank_correlation).map((arr, j) => (
                            <td key={j}>{fmt(arr[i].rho, 2)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
              <Panel title="Best weights for walking distance, per dataset" icon={Grid3x3}>
                <TableScroll label="Best weights per dataset">
                  <table className="data compact">
                    <thead>
                      <tr>
                        <th scope="col">Dataset</th>
                        <th scope="col">Affinity</th>
                        <th scope="col">Best-fit</th>
                        <th scope="col">Golden zone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(d.best_setting).map(([p, b]) => (
                        <tr key={p}>
                          <td>{nameOf(p)}</td>
                          <td>{b.lam}</td>
                          <td>{b.mu}</td>
                          <td>{b.erg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
            </div>
            <Note kind="warn">
              A layout cannot be moved between datasets because the SKUs differ, so this compares the <i>method and its settings</i>. The gain varies with basket structure: the synthetic dark store has the most
              clearly clustered baskets by construction; the two real datasets show what real demand does. Instacart timestamps and all three SKU masters' physical data are synthesised.
            </Note>
          </div>
        );
      }}
    </Async>
  );
}

export default function Generalize({ run }) {
  return (
    <div className="stack">
      <Panel title="Across cohorts: does a layout survive a change in who is ordering?" subtitle="Each row trains the layout on one group of orders from the early period; each column scores it on a different group from the later period, against a random layout on the same test orders. The diagonal is “same group, later in time”; the other cells are a real shift in who is ordering." icon={Users}>
        <Cohorts run={run} />
      </Panel>
      <h2 className="section-heading">
        <Layers size={18} aria-hidden="true" />
        Across datasets: three different operations, one method
      </h2>
      <Datasets />
    </div>
  );
}
