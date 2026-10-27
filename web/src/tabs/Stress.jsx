import { Async, Card, Note, Plot, fmt, useApi } from "../ui.jsx";

export default function Stress({ run }) {
  const st = useApi(`/api/runs/${run.id}/surge`);
  return (
    <Async state={st}>
      {(s) =>
        !s ? (
          <Note kind="warn">
            This scenario's history is too short for the stress test (it needs at least 8 training weeks and several weeks after them). Choose the fulfilment-centre
            scenario.
          </Note>
        ) : (
          <>
            <div className="panel">
              <h2>Demand surge: does the layout recover?</h2>
              <p style={{ color: "var(--muted)" }}>
                In the last 4 weeks, {s.n_surge_skus} mid and slow-moving SKUs suddenly sell about {s.factor}× as much (think a festive sale), together with the items ordered
                with them. The static layout is frozen after training. The re-slotting planner forecasts each week, swaps mis-slotted SKUs when the saving beats a relocation
                cost of {s.move_cost_m} m-equivalents, and keeps every rule satisfied.
              </p>
              <div className="grid cards">
                <Card label="Frozen layout" value={`${fmt(s.static_total / 1000, 0)} km`} sub="whole held-out period" />
                <Card tone={s.reslot_total_with_moves < s.static_total ? "good" : "bad"} label="Re-slotted, incl. move cost" value={`${fmt(s.reslot_total_with_moves / 1000, 0)} km`}
                  sub={`${fmt(100 * (1 - s.reslot_total_with_moves / s.static_total))}% less · ${s.total_moves} swaps`} />
                <Card tone={s.violations === 0 ? "good" : "bad"} label="Rule violations after re-slotting" value={s.violations} />
              </div>
              <Plot
                height={340}
                data={[
                  { type: "scatter", mode: "lines+markers", name: "frozen layout", x: s.weeks.map((w) => w.week), y: s.weeks.map((w) => w.static_m / 1000), line: { color: "#f87171" } },
                  { type: "scatter", mode: "lines+markers", name: "re-slotted", x: s.weeks.map((w) => w.week), y: s.weeks.map((w) => w.reslot_m / 1000), line: { color: "#38bdf8" } },
                ]}
                layout={{
                  xaxis: { title: "week" },
                  yaxis: { title: "km walked that week" },
                  shapes: [{ type: "rect", xref: "x", x0: s.surge_start_week - 0.5, x1: Math.max(...s.weeks.map((w) => w.week)) + 0.5, yref: "paper", y0: 0, y1: 1, fillcolor: "rgba(251,191,36,0.10)", line: { width: 0 } }],
                  annotations: [{ x: s.surge_start_week, y: 1, yref: "paper", text: "surge", showarrow: false, font: { color: "#fbbf24" }, xanchor: "left" }],
                }}
              />
            </div>
            <Note kind="warn">
              The surge is simulated by repeating real orders; it is a stress test, not a prediction. The planner only sees demand after it happens (it forecasts from past
              weeks), so it lags the first surge week and then catches up.
            </Note>
          </>
        )
      }
    </Async>
  );
}
