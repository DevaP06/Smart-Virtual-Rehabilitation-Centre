import { CalendarClock, Footprints, LineChart, Repeat, ShieldCheck } from "lucide-react";
import { Async, Badge, Card, EmptyState, InfoTip, Legend, Panel, Plot, TableScroll, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

const MODEL = { lightgbm: "LightGBM (P50)", last_week: "same as last week", mean_4wk: "mean of last 4 weeks" };
const MODEL_COLOR = { lightgbm: COLORS.accent, last_week: COLORS.slate, mean_4wk: COLORS.violet };

export default function Forecast({ run }) {
  const f = useApi(`/api/runs/${run.id}/forecast`);
  const r = useApi(`/api/runs/${run.id}/reslot`);
  return (
    <div className="stack">
      <Async state={f} skeleton="chart" label="the forecast">
        {(fc) =>
          !fc ? (
            <EmptyState icon={CalendarClock} title="Not enough history to forecast">
              Not enough weekly history in this dataset to train and test a forecaster (needs at least 8 training weeks and 2 test weeks).
            </EmptyState>
          ) : (
            <Panel
              title="Demand forecast: LightGBM quantile model vs naive baselines"
              subtitle={`Weekly pick lines per SKU, one week ahead, evaluated on ${fc.test_weeks} held-out weeks. A forecast that does not beat the naive baselines is not used.`}
              icon={LineChart}
              actions={<Badge tone={fc.beats_naive ? "good" : "warn"}>{fc.beats_naive ? "Beats both baselines" : "Does not beat both baselines"}</Badge>}
            >
              <div className="grid-2">
                <div>
                  <Legend items={["lightgbm", "last_week", "mean_4wk"].map((m) => [MODEL_COLOR[m], MODEL[m]])} />
                  <Plot
                    height={300}
                    compactHeight={260}
                    summary={`Bar chart of weighted forecast error in percent. LightGBM ${fmt(fc.wmape.lightgbm * 100)}, same as last week ${fmt(fc.wmape.last_week * 100)}, mean of last 4 weeks ${fmt(fc.wmape.mean_4wk * 100)}. Lower is better.`}
                    data={["lightgbm", "last_week", "mean_4wk"].map((m) => ({
                      type: "bar", name: MODEL[m], x: ["wMAPE"], y: [fc.wmape[m] * 100], marker: { color: MODEL_COLOR[m] },
                      hovertemplate: `${MODEL[m]}: %{y:.1f}%<extra></extra>`,
                    }))}
                    layout={{ yaxis: { title: "% error (lower is better)" }, barmode: "group", showlegend: false }}
                  />
                </div>
                <div className="stack">
                  <p className="muted" style={{ margin: 0 }}>
                    Pinball loss measures how good the forecast ranges are (P10, P50, P90); lower is better.
                  </p>
                  <TableScroll label="Pinball loss">
                    <table className="data compact">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="th-in">
                              Pinball loss <InfoTip text="Error measure for quantile forecasts: it penalises a forecast more when it is wrong in the costly direction for that quantile. Lower is better." />
                            </span>
                          </th>
                          <th scope="col">LightGBM</th>
                          <th scope="col">Last week</th>
                          <th scope="col">4-wk mean</th>
                        </tr>
                      </thead>
                      <tbody>
                        {["p10", "p50", "p90"].map((q) => (
                          <tr key={q}>
                            <td>{q.toUpperCase()}</td>
                            <td>{fmt(fc[`pinball_${q}`].lightgbm, 3)}</td>
                            <td>{fmt(fc[`pinball_${q}`].last_week, 3)}</td>
                            <td>{fmt(fc[`pinball_${q}`].mean_4wk, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <p style={{ margin: 0 }}>
                    Beats both baselines on wMAPE: <b>{fc.beats_naive ? "yes" : "no"}</b>.
                  </p>
                </div>
              </div>
            </Panel>
          )
        }
      </Async>

      <Async state={r} skeleton="chart" label="the re-slotting result">
        {(rs) =>
          !rs ? (
            <EmptyState icon={Repeat} title="No re-slotting result for this scenario">
              The weekly re-slotting replay was not stored for this scenario, so there is nothing to compare here.
            </EmptyState>
          ) : (
            <Panel
              title="Dynamic re-slotting: nightly swaps net of move cost"
              subtitle={`Each week the planner forecasts demand (${rs.forecast_used}), proposes swaps of mis-slotted SKUs, and applies only those whose weekly distance saving exceeds a relocation cost of ${rs.move_cost_m} m-equivalents, within a weekly budget. Every swap is rule-checked.`}
              icon={Repeat}
            >
              <div className="kpi-grid">
                <Card icon={Footprints} label="Static layout" value={`${fmt(rs.static_total / 1000, 0)} km`} sub="frozen after the training period" />
                <Card icon={Repeat} tone="good" label="Re-slotted, incl. move cost" value={`${fmt(rs.reslot_total_with_moves / 1000, 0)} km`} sub={`${fmt(100 * (1 - rs.reslot_total_with_moves / rs.static_total))}% less · ${rs.total_moves} swaps`} />
                <Card icon={ShieldCheck} tone={rs.violations === 0 ? "good" : "bad"} label="Violations after re-slotting" value={rs.violations} sub={rs.violations === 0 ? "Every rule still satisfied" : undefined} />
              </div>
              <div style={{ marginTop: 16 }}>
                <Legend
                  items={[
                    [COLORS.bad, "Static layout"],
                    [COLORS.accent, "Re-slotted layout"],
                  ]}
                />
                <Plot
                  height={320}
                  compactHeight={280}
                  summary="Line chart of kilometres walked each held-out week for a static layout and a re-slotted layout."
                  data={[
                    { type: "scatter", mode: "lines+markers", name: "static", x: rs.weeks.map((w) => w.week), y: rs.weeks.map((w) => w.static_m / 1000), line: { color: COLORS.bad, width: 2.5 }, marker: { size: 5 }, hovertemplate: "week %{x}<br>%{y:,.0f} km<extra>static</extra>" },
                    { type: "scatter", mode: "lines+markers", name: "re-slotted", x: rs.weeks.map((w) => w.week), y: rs.weeks.map((w) => w.reslot_m / 1000), line: { color: COLORS.accent, width: 2.5 }, marker: { size: 5 }, hovertemplate: "week %{x}<br>%{y:,.0f} km<extra>re-slotted</extra>" },
                  ]}
                  layout={{ xaxis: { title: "week of the held-out period" }, yaxis: { title: "km walked" }, showlegend: false }}
                />
              </div>
            </Panel>
          )
        }
      </Async>
    </div>
  );
}
