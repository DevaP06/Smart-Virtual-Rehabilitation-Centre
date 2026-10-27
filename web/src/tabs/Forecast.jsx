import { Async, Card, Note, Plot, fmt, useApi } from "../ui.jsx";

export default function Forecast({ run }) {
  const f = useApi(`/api/runs/${run.id}/forecast`);
  const r = useApi(`/api/runs/${run.id}/reslot`);
  return (
    <>
      <Async state={f}>
        {(fc) =>
          !fc ? (
            <Note kind="warn">Not enough weekly history in this dataset to train and test a forecaster (needs at least 8 training weeks and 2 test weeks).</Note>
          ) : (
            <div className="panel">
              <h2>Demand forecast: LightGBM quantile model vs naive baselines</h2>
              <p style={{ color: "var(--muted)" }}>
                Weekly pick lines per SKU, one week ahead, evaluated on {fc.test_weeks} held-out weeks. A forecast that does not beat the naive baselines is not used.
              </p>
              <div className="grid two">
                <Plot
                  height={300}
                  data={["lightgbm", "last_week", "mean_4wk"].map((m) => ({
                    type: "bar",
                    name: { lightgbm: "LightGBM (P50)", last_week: "same as last week", mean_4wk: "mean of last 4 weeks" }[m],
                    x: ["wMAPE"],
                    y: [fc.wmape[m] * 100],
                  }))}
                  layout={{ yaxis: { title: "% error (lower is better)" }, barmode: "group" }}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Pinball loss</th><th>LightGBM</th><th>Last week</th><th>4-wk mean</th></tr>
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
                  <p style={{ marginTop: 10 }}>
                    Beats both baselines on wMAPE: <b>{fc.beats_naive ? "yes" : "no"}</b>.
                  </p>
                </div>
              </div>
            </div>
          )
        }
      </Async>

      <div style={{ height: 16 }} />
      <Async state={r}>
        {(rs) =>
          !rs ? null : (
            <div className="panel">
              <h2>Dynamic re-slotting: nightly swaps net of move cost</h2>
              <p style={{ color: "var(--muted)" }}>
                Each week the planner forecasts demand ({rs.forecast_used}), proposes swaps of mis-slotted SKUs, and applies only those whose weekly distance saving
                exceeds a relocation cost of {rs.move_cost_m} m-equivalents, within a weekly budget. Every swap is rule-checked.
              </p>
              <div className="grid cards">
                <Card label="Static layout" value={`${fmt(rs.static_total / 1000, 0)} km`} sub="frozen after the training period" />
                <Card tone="good" label="Re-slotted, incl. move cost" value={`${fmt(rs.reslot_total_with_moves / 1000, 0)} km`} sub={`${fmt(100 * (1 - rs.reslot_total_with_moves / rs.static_total))}% less · ${rs.total_moves} swaps`} />
                <Card tone={rs.violations === 0 ? "good" : "bad"} label="Violations after re-slotting" value={rs.violations} />
              </div>
              <Plot
                height={300}
                data={[
                  { type: "scatter", mode: "lines+markers", name: "static", x: rs.weeks.map((w) => w.week), y: rs.weeks.map((w) => w.static_m / 1000), line: { color: "#f87171" } },
                  { type: "scatter", mode: "lines+markers", name: "re-slotted", x: rs.weeks.map((w) => w.week), y: rs.weeks.map((w) => w.reslot_m / 1000), line: { color: "#38bdf8" } },
                ]}
                layout={{ xaxis: { title: "week of the held-out period" }, yaxis: { title: "km walked" } }}
              />
            </div>
          )
        }
      </Async>
    </>
  );
}
