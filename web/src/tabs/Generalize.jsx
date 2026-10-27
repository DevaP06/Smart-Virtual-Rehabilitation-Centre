import { Async, Card, Note, Plot, fmt, useApi } from "../ui.jsx";

const PROFILE = { fulfilment_centre: "Fulfilment centre", grocery: "Grocery dark store", dark_store: "Dark store (synthetic)" };
const SHORT = { avg_distance_per_order_m: "distance", fill_rate_pct: "fill", class_a_golden_share_pct: "golden" };

function Cohorts({ run }) {
  const st = useApi(`/api/runs/${run.id}/cohort`);
  return (
    <Async state={st}>
      {(c) =>
        !c ? (
          <Note kind="warn">This scenario has no cohorts large enough to train and test on.</Note>
        ) : (
          <>
            <p style={{ color: "var(--muted)" }}>
              Each row trains the layout on one group of orders from the early period; each column scores it on a different group from the later period, against a random layout on the
              same test orders. The diagonal is "same group, later in time"; the other cells are a real shift in who is ordering.
            </p>
            {(() => {
              const z = c.train_rows.map((x) => c.cohorts.map((y) => c.matrix[x][y].reduction_pct));
              const flat = z.flat();
              const lo = Math.min(...flat);
              const hi = Math.max(...flat);
              // label colour chosen per cell so it stays readable on both the dark and the bright end of the scale
              const notes = c.train_rows.flatMap((x, i) => c.cohorts.map((y, j) => ({
                x: y, y: x, text: `${fmt(z[i][j])}%`, showarrow: false,
                font: { size: 13, color: z[i][j] < lo + (hi - lo) * 0.6 ? "#f8fafc" : "#0b1220" },
              })));
              return (
                <Plot
                  height={90 + 60 * c.train_rows.length}
                  data={[{
                    type: "heatmap", x: c.cohorts, y: c.train_rows, colorscale: "Viridis", z, zmin: lo, zmax: hi,
                    hovertemplate: "trained on %{y}<br>tested on %{x}<br>%{z:.1f}% less walking than random<extra></extra>",
                    colorbar: { title: { text: "% less walking" }, thickness: 12 },
                  }]}
                  layout={{ annotations: notes, xaxis: { title: "tested on (later period)", tickangle: -20, side: "bottom" },
                    yaxis: { title: "trained on (early period)", autorange: "reversed" }, margin: { l: 190, r: 8, t: 8, b: 110 } }}
                />
              );
            })()}
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr><th>Test group</th><th>Orders</th><th>Trained on itself</th><th>Trained on all orders</th><th>Worst other group</th><th>Drop vs itself</th></tr>
                </thead>
                <tbody>
                  {c.cohorts.map((y) => {
                    const self = c.matrix[y][y].reduction_pct;
                    const others = c.cohorts.filter((x) => x !== y).map((x) => [x, c.matrix[x][y].reduction_pct]);
                    const [wx, wv] = others.reduce((a, b) => (b[1] < a[1] ? b : a));
                    return (
                      <tr key={y}>
                        <td>{y}</td><td>{c.sizes[y].test.toLocaleString()}</td><td>{fmt(self)}%</td><td>{fmt(c.matrix["all orders"][y].reduction_pct)}%</td>
                        <td>{fmt(wv)}% ({wx})</td><td className={self - wv > 5 ? "nonzero" : ""}>{fmt(self - wv)} pts</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Note>
              A large drop means the layout learned the habits of one group (plausibly: small-basket orders reward putting the fastest single items closest, large baskets reward
              grouping items bought together) and does worse for another. We did not test the reason. It is a reason to retrain or re-slot when the customer mix changes. Every layout in this grid was rule-checked: {c.violations} violations.
            </Note>
          </>
        )
      }
    </Async>
  );
}

function Datasets() {
  const st = useApi("/api/compare");
  return (
    <Async state={st}>
      {(d) => {
        const rows = [...d.datasets].sort((a, b) => b.full_reduction.pct - a.full_reduction.pct);
        return (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Dataset</th><th>SKUs</th><th>Orders</th><th>Lines / order</th><th>Single-line %</th><th>Top 20% of SKUs carry</th><th>Less walking (Full vs random)</th><th>ABC zoning alone</th><th>Route time</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.run_id}>
                      <td>{PROFILE[r.profile] || r.profile}<div style={{ color: "var(--muted)", fontSize: 12 }}>{r.dataset}</div></td>
                      <td>{r.n_skus.toLocaleString()}</td><td>{r.n_orders.toLocaleString()}</td><td>{fmt(r.lines_per_order)}</td><td>{fmt(r.single_line_pct, 0)}%</td>
                      <td>{fmt(r.top20_share, 0)}%</td>
                      <td><b>{fmt(r.full_reduction.pct)}%</b> [{fmt(r.full_reduction.lo)}, {fmt(r.full_reduction.hi)}]</td>
                      <td>{fmt(r.abc_reduction)}%</td><td>−{fmt(r.time_reduction_pct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid two" style={{ marginTop: 16 }}>
              <div>
                <h3>Do the same weights work on every dataset?</h3>
                <p style={{ color: "var(--muted)" }}>
                  The 36 weight settings were ranked on each dataset (distance = walking per order, fill = fill rate, golden = class-A picks at golden height). Spearman ρ near 1 means a setting that is good on one dataset is good on the other; near 0 means the choice
                  does not transfer.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Datasets</th>{Object.keys(d.rank_correlation).map((m) => <th key={m}>ρ {SHORT[m]}</th>)}</tr></thead>
                    <tbody>
                      {(Object.values(d.rank_correlation)[0] || []).map((p, i) => (
                        <tr key={i}>
                          <td>{PROFILE[p.a] || p.a} ↔ {PROFILE[p.b] || p.b}</td>
                          {Object.values(d.rank_correlation).map((arr, j) => <td key={j}>{fmt(arr[i].rho, 2)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3>Best weights for walking distance, per dataset</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Dataset</th><th>Affinity</th><th>Best-fit</th><th>Golden zone</th></tr></thead>
                    <tbody>
                      {Object.entries(d.best_setting).map(([p, b]) => (
                        <tr key={p}><td>{PROFILE[p] || p}</td><td>{b.lam}</td><td>{b.mu}</td><td>{b.erg}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <Note kind="warn">
              A layout cannot be moved between datasets because the SKUs differ, so this compares the <i>method and its settings</i>. The gain varies with basket structure: the
              synthetic dark store has the most clearly clustered baskets by construction; the two real datasets show what real demand does. Instacart timestamps and all three
              SKU masters' physical data are synthesised.
            </Note>
          </>
        );
      }}
    </Async>
  );
}

export default function Generalize({ run }) {
  return (
    <>
      <div className="panel">
        <h2>Across cohorts: does a layout survive a change in who is ordering?</h2>
        <Cohorts run={run} />
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Across datasets: three different operations, one method</h2>
        <Datasets />
      </div>
    </>
  );
}
