import { CalendarClock, Footprints, Repeat, ShieldCheck, TrendingUp } from "lucide-react";
import { Async, Card, EmptyState, Legend, Note, Panel, Plot, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

export default function Stress({ run }) {
  const st = useApi(`/api/runs/${run.id}/surge`);
  return (
    <Async state={st} skeleton="page" label="the demand-surge test">
      {(s) =>
        !s ? (
          <EmptyState icon={CalendarClock} title="Not enough history for the stress test">
            This scenario's history is too short for the stress test (it needs at least 8 training weeks and several weeks after them). Choose the fulfilment-centre scenario.
          </EmptyState>
        ) : (
          <div className="stack">
            <Panel
              title="Demand surge: does the layout recover?"
              subtitle={`In the last 4 weeks, ${s.n_surge_skus} mid and slow-moving SKUs suddenly sell about ${s.factor}× as much (think a festive sale), together with the items ordered with them. The static layout is frozen after training. The re-slotting planner forecasts each week, swaps mis-slotted SKUs when the saving beats a relocation cost of ${s.move_cost_m} m-equivalents, and keeps every rule satisfied.`}
              icon={TrendingUp}
            >
              <div className="kpi-grid">
                <Card icon={Footprints} label="Frozen layout" value={`${fmt(s.static_total / 1000, 0)} km`} sub="whole held-out period" />
                <Card
                  icon={Repeat}
                  tone={s.reslot_total_with_moves < s.static_total ? "good" : "bad"}
                  label="Re-slotted, incl. move cost"
                  value={`${fmt(s.reslot_total_with_moves / 1000, 0)} km`}
                  sub={`${fmt(100 * (1 - s.reslot_total_with_moves / s.static_total))}% less · ${s.total_moves} swaps`}
                />
                <Card icon={ShieldCheck} tone={s.violations === 0 ? "good" : "bad"} label="Rule violations after re-slotting" value={s.violations} sub={s.violations === 0 ? "Every rule still satisfied" : undefined} />
              </div>
              {s.total_moves === 0 && (
                <div style={{ marginTop: 14 }}>
                  <Note>
                    No swap met the planner's conditions in this scenario (weekly saving above the relocation cost, every rule still satisfied), so the re-slotted layout is identical to the frozen one.
                  </Note>
                </div>
              )}
            </Panel>

            <Panel title="Walking distance, week by week" subtitle="The shaded band is the simulated surge period." icon={TrendingUp}>
              <Legend
                items={[
                  [COLORS.bad, "Frozen layout"],
                  [COLORS.accent, "Re-slotted layout"],
                  ["rgba(251,191,36,0.45)", "Simulated surge weeks"],
                ]}
              />
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
                  shapes: [{ type: "rect", xref: "x", x0: s.surge_start_week - 0.5, x1: Math.max(...s.weeks.map((w) => w.week)) + 0.5, yref: "paper", y0: 0, y1: 1, fillcolor: "rgba(251,191,36,0.10)", line: { width: 0 }, layer: "below" }],
                  annotations: [{ x: s.surge_start_week, y: 1, yref: "paper", text: "surge", showarrow: false, font: { color: COLORS.warn }, xanchor: "left", yanchor: "top" }],
                }}
              />
            </Panel>
            <Note kind="warn">
              The surge is simulated by repeating real orders; it is a stress test, not a prediction. The planner only sees demand after it happens (it forecasts from past weeks), so it lags the first surge week and
              then catches up.
            </Note>
          </div>
        )
      }
    </Async>
  );
}
