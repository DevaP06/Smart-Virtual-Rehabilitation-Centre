import { BarChart3, Boxes, Grid3x3, Network, ShoppingBasket } from "lucide-react";
import { Async, Legend, Note, Panel, Plot, TableScroll, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

export default function Eda({ run }) {
  const st = useApi(`/api/runs/${run.id}/eda`);
  return (
    <Async state={st} skeleton="page" label="the data analysis">
      {(e) => {
        const bins = e.volume.edges.slice(0, -1).map((x, i) => (x + e.volume.edges[i + 1]) / 2);
        const classes = Object.entries(e.volume.bin_classes);
        return (
          <div className="stack">
            <div className="grid-2">
              <Panel title="Demand concentration" subtitle="A few products account for most of the picks. Fastest products on the left." icon={BarChart3}>
                <Plot
                  height={340}
                  compactHeight={290}
                  summary={`Line chart of cumulative share of pick lines against share of SKUs. The top 20 percent of SKUs carry ${fmt(e.top20pct_share, 0)} percent of pick lines.`}
                  data={[
                    { type: "scatter", mode: "lines", x: e.pareto.pct_skus, y: e.pareto.pct_lines, name: "cumulative demand", line: { color: COLORS.accent, width: 3 }, hovertemplate: "%{x:.0f}% of SKUs carry %{y:.0f}% of pick lines<extra></extra>" },
                    { type: "scatter", mode: "lines", x: [0, 100], y: [0, 100], name: "even demand", line: { color: COLORS.slate, dash: "dot" }, hoverinfo: "skip" },
                  ]}
                  layout={{ xaxis: { title: "% of SKUs (fastest first)" }, yaxis: { title: "% of pick lines" }, legend: { y: -0.28 } }}
                />
                <p className="chart-caption">
                  Class A / B / C: <b>{e.abc_counts.A}</b> / <b>{e.abc_counts.B}</b> / <b>{e.abc_counts.C || 0}</b> SKUs. The top 20% of SKUs carry <b>{fmt(e.top20pct_share, 0)}%</b> of pick lines.
                </p>
              </Panel>

              <Panel title="Products bought together" subtitle="How often each pair among the 30 fastest products appears in the same order." icon={Network}>
                <Plot
                  height={340}
                  compactHeight={290}
                  summary="Heatmap of how many orders contain both products, for the 30 fastest products. Hover a cell to see the two product ids."
                  data={[
                    {
                      type: "heatmap", z: e.cooc.matrix.map((r) => r.map((v) => Math.log1p(v))), text: e.cooc.matrix, x: e.cooc.skus, y: e.cooc.skus,
                      hovertemplate: "%{x} and %{y}<br>%{text} orders together<extra></extra>", colorscale: "Viridis", colorbar: { title: { text: "log(1+orders)" }, thickness: 12 },
                    },
                  ]}
                  layout={{
                    // SKU ids such as 22423 look like numbers to Plotly: force category axes or the cells collapse to a dot
                    xaxis: { type: "category", showticklabels: false, title: "30 fastest SKUs (hover a cell for the ids)" },
                    yaxis: { type: "category", showticklabels: false, autorange: "reversed", title: "30 fastest SKUs" },
                  }}
                />
                <p className="chart-caption">
                  Louvain clustering on lift-filtered pairs finds <b>{e.clusters.n_clusters}</b> communities
                  {e.clusters.sizes?.length ? ` (largest: ${e.clusters.sizes.slice(0, 4).join(", ")} SKUs)` : ""}.
                </p>
              </Panel>

              <Panel title="Product size against bin size" subtitle="Most products fill only a small part of a bin." icon={Boxes}>
                <Plot
                  height={340}
                  compactHeight={290}
                  summary="Histogram of the stored volume per SKU in litres, with dotted vertical lines marking each bin size."
                  data={[{ type: "bar", x: bins, y: e.volume.hist, marker: { color: COLORS.slate }, name: "SKUs", hovertemplate: "%{x:.0f} L: %{y} SKUs<extra></extra>" }]}
                  layout={{
                    xaxis: { title: "stored volume per SKU (litres)" },
                    yaxis: { title: "SKUs" },
                    showlegend: false,
                    shapes: classes.map(([, v]) => ({ type: "line", x0: v, x1: v, yref: "paper", y0: 0, y1: 1, line: { color: COLORS.warn, dash: "dot" } })),
                    annotations: classes.map(([k, v]) => ({ x: v, y: 1, yref: "paper", yanchor: "bottom", text: `bin ${k}`, showarrow: false, font: { color: COLORS.warn, size: 11 } })),
                    margin: { t: 28 },
                  }}
                />
                <p className="chart-caption">Most SKUs fill only a small part of even the smallest bin, so volume is the main source of wasted cube.</p>
              </Panel>

              <Panel title="Order size" subtitle="How many product lines a typical order contains." icon={ShoppingBasket}>
                <Plot
                  height={340}
                  compactHeight={290}
                  summary={`Bar chart of orders by number of lines. ${fmt(e.baskets.single_line_share, 0)} percent are single-line; the mean is ${fmt(e.baskets.mean_lines)} lines per order.`}
                  data={[{ type: "bar", x: e.baskets.hist.map((_, i) => i + 1), y: e.baskets.hist, marker: { color: COLORS.good }, hovertemplate: "%{x} lines: %{y} orders<extra></extra>" }]}
                  layout={{ xaxis: { title: "lines per order (30 = 30 or more)" }, yaxis: { title: "orders" }, showlegend: false }}
                />
                <p className="chart-caption">
                  Single-line orders: <b>{fmt(e.baskets.single_line_share, 0)}%</b>; mean lines per order: <b>{fmt(e.baskets.mean_lines)}</b>. Affinity only helps multi-line orders.
                </p>
              </Panel>
            </div>

            <Panel title="Strongest bought-together pairs" icon={Grid3x3}>
              <TableScroll label="Strongest co-ordered pairs">
                <table className="data">
                  <caption className="sr-only">Top 20 product pairs by number of orders containing both.</caption>
                  <thead>
                    <tr>
                      <th scope="col">SKU A</th>
                      <th scope="col">SKU B</th>
                      <th scope="col">Orders together</th>
                      <th scope="col">Support</th>
                      <th scope="col">Lift</th>
                      <th scope="col">Jaccard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.top_pairs.map((p) => (
                      <tr key={p.a + p.b}>
                        <td>{p.a}</td>
                        <td style={{ textAlign: "right" }}>{p.b}</td>
                        <td>{p.count}</td>
                        <td>{fmt(p.support * 100, 2)}%</td>
                        <td>{fmt(p.lift)}</td>
                        <td>{fmt(p.jaccard, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <div style={{ marginTop: 14 }}>
                <Note>Hazardous SKUs: {fmt(e.hazard_share)}% of the catalogue (assigned from category, seeded and illustrative, not a regulatory mapping).</Note>
              </div>
            </Panel>
          </div>
        );
      }}
    </Async>
  );
}
