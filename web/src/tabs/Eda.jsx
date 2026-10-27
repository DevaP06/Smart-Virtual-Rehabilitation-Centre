import { Async, Note, Plot, fmt, useApi } from "../ui.jsx";

export default function Eda({ run }) {
  const st = useApi(`/api/runs/${run.id}/eda`);
  return (
    <Async state={st}>
      {(e) => {
        const bins = e.volume.edges.slice(0, -1).map((x, i) => (x + e.volume.edges[i + 1]) / 2);
        const classes = Object.entries(e.volume.bin_classes);
        return (
          <>
            <div className="grid two">
              <div className="panel">
                <h3>Velocity: Pareto curve</h3>
                <Plot
                  data={[
                    { type: "scatter", mode: "lines", x: e.pareto.pct_skus, y: e.pareto.pct_lines, name: "cumulative demand", line: { color: "#38bdf8", width: 3 } },
                    { type: "scatter", mode: "lines", x: [0, 100], y: [0, 100], name: "even demand", line: { color: "#64748b", dash: "dot" } },
                  ]}
                  layout={{ xaxis: { title: "% of SKUs (fastest first)" }, yaxis: { title: "% of pick lines" } }}
                />
                <p>
                  Class A / B / C: <b>{e.abc_counts.A}</b> / <b>{e.abc_counts.B}</b> / <b>{e.abc_counts.C || 0}</b> SKUs. The top 20% of SKUs carry{" "}
                  <b>{fmt(e.top20pct_share, 0)}%</b> of pick lines.
                </p>
              </div>
              <div className="panel">
                <h3>Affinity: orders containing both SKUs</h3>
                <Plot
                  data={[{ type: "heatmap", z: e.cooc.matrix.map((r) => r.map((v) => Math.log1p(v))), text: e.cooc.matrix, x: e.cooc.skus, y: e.cooc.skus,
                    hovertemplate: "%{x} and %{y}<br>%{text} orders together<extra></extra>", colorscale: "Viridis", colorbar: { title: { text: "log(1+orders)" }, thickness: 12 } }]}
                  layout={{
                    // SKU ids such as 22423 look like numbers to Plotly: force category axes or the cells collapse to a dot
                    xaxis: { type: "category", showticklabels: false },
                    yaxis: { type: "category", showticklabels: false, autorange: "reversed" },
                  }}
                />
                <p>
                  The 30 fastest SKUs. Louvain clustering on lift-filtered pairs finds <b>{e.clusters.n_clusters}</b> communities
                  {e.clusters.sizes?.length ? ` (largest: ${e.clusters.sizes.slice(0, 4).join(", ")} SKUs)` : ""}.
                </p>
              </div>
              <div className="panel">
                <h3>Volumetric density: SKU volume vs bin classes</h3>
                <Plot
                  data={[{ type: "bar", x: bins, y: e.volume.hist, marker: { color: "#64748b" }, name: "SKUs" }]}
                  layout={{
                    xaxis: { title: "stored volume per SKU (litres)" },
                    yaxis: { title: "SKUs" },
                    shapes: classes.map(([, v]) => ({ type: "line", x0: v, x1: v, yref: "paper", y0: 0, y1: 1, line: { color: "#fbbf24", dash: "dot" } })),
                    annotations: classes.map(([k, v]) => ({ x: v, y: 1, yref: "paper", text: `bin ${k}`, showarrow: false, font: { color: "#fbbf24" } })),
                  }}
                />
                <p>Most SKUs fill only a small part of even the smallest bin, so volume is the main source of wasted cube.</p>
              </div>
              <div className="panel">
                <h3>Basket structure</h3>
                <Plot
                  data={[{ type: "bar", x: e.baskets.hist.map((_, i) => i + 1), y: e.baskets.hist, marker: { color: "#34d399" } }]}
                  layout={{ xaxis: { title: "lines per order (30 = 30 or more)" }, yaxis: { title: "orders" } }}
                />
                <p>
                  Single-line orders: <b>{fmt(e.baskets.single_line_share, 0)}%</b>; mean lines per order: <b>{fmt(e.baskets.mean_lines)}</b>. Affinity only helps
                  multi-line orders.
                </p>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>Strongest co-ordered pairs</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>SKU A</th><th>SKU B</th><th>Orders together</th><th>Support</th><th>Lift</th><th>Jaccard</th></tr>
                  </thead>
                  <tbody>
                    {e.top_pairs.map((p) => (
                      <tr key={p.a + p.b}>
                        <td>{p.a}</td><td>{p.b}</td><td>{p.count}</td><td>{fmt(p.support * 100, 2)}%</td><td>{fmt(p.lift)}</td><td>{fmt(p.jaccard, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note>Hazardous SKUs: {fmt(e.hazard_share)}% of the catalogue (assigned from category, seeded and illustrative, not a regulatory mapping).</Note>
            </div>
          </>
        );
      }}
    </Async>
  );
}
