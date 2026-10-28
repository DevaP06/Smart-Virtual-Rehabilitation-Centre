import { useState } from "react";
import { Calculator, Clock, Coins, Footprints, Hourglass, SlidersHorizontal, TrendingUp } from "lucide-react";
import { Async, Card, LABEL, LADDER, Note, NumberField, Panel, Plot, Select, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

const val = (k, p, m) => k[p]?.kpis?.[m]?.value;

export default function Impact({ run }) {
  const kp = useApi(`/api/runs/${run.id}/kpis`);
  const days = run.summary.test_days || 30;
  const [base, setBase] = useState("B0_random");
  const [prop, setProp] = useState(run.summary.headline);
  const [ordersDay, setOrdersDay] = useState(Math.round(run.summary.n_test / days));
  const [opDays, setOpDays] = useState(300);
  const [wage, setWage] = useState(12);
  const [refillMin, setRefillMin] = useState(2);

  return (
    <Async state={kp} skeleton="page" label="the impact figures">
      {(k) => {
        const dT = val(k, base, "avg_route_time_s") - val(k, prop, "avg_route_time_s"); // seconds per order
        const dDist = val(k, base, "avg_distance_per_order_m") - val(k, prop, "avg_distance_per_order_m");
        const dRefill = val(k, prop, "replenishments_per_day") - val(k, base, "replenishments_per_day"); // extra refills
        // The stored refill KPI is per day of the evaluation sample; scale to the entered order volume.
        const refillScale = ordersDay / (run.summary.n_test / days);
        const pickHours = (dT * ordersDay * opDays) / 3600;
        const refillHours = (dRefill * refillScale * refillMin * opDays) / 60;
        const netHours = pickHours - refillHours;
        const km = (dDist * ordersDay * opDays) / 1000;
        const positive = netHours >= 0;
        const layoutOptions = LADDER.map((p) => ({ value: p, label: LABEL[p] }));

        return (
          <div className="stack">
            <Panel
              title="Compare layouts and set your assumptions"
              subtitle="Converts the simulated gains into labour hours and money. Change the numbers to match your operation: every figure below is an estimate that follows from them."
              icon={SlidersHorizontal}
            >
              <div className="form-row">
                <Select label="Proposed layout" value={prop} onChange={setProp} options={layoutOptions.filter((o) => o.value !== "naive")} hint="The layout you would move to." />
                <Select label="Compared against" value={base} onChange={setBase} options={layoutOptions} hint="Your current layout (default: random)." />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <NumberField label="Orders per day" value={ordersDay} onChange={setOrdersDay} step={50} unit="orders" hint="Default: held-out orders ÷ days." />
                <NumberField label="Operating days per year" value={opDays} onChange={setOpDays} step={10} unit="days" />
                <NumberField label="Picker cost per hour" value={wage} onChange={setWage} step={1} unit="currency units" hint="Any currency; the result uses the same unit." />
                <NumberField label="Minutes per refill" value={refillMin} onChange={setRefillMin} step={0.5} unit="min" hint="Time to restock one bin." />
              </div>
            </Panel>

            <div className="kpi-grid">
              <Card
                icon={Hourglass}
                tone={positive ? "good" : "bad"}
                label="Net picker-hours saved / year"
                value={fmt(netHours, 0)}
                sub={`${fmt(pickHours, 0)} walking and picking, minus ${fmt(refillHours, 0)} extra refilling${positive ? "" : " · net cost"}`}
              />
              <Card
                icon={Coins}
                tone={positive ? "good" : "bad"}
                label="Net saving / year"
                value={fmt(netHours * wage, 0)}
                sub={`at ${wage} per hour, ${ordersDay} orders/day${positive ? "" : " · net cost"}`}
              />
              <Card icon={Footprints} label="Walking saved / year" value={`${fmt(km, 0)} km`} sub={`${fmt(dDist)} m less per order`} />
              <Card icon={Clock} label="Time saved per order" value={`${fmt(dT, 0)} s`} sub={`${fmt(val(k, base, "avg_route_time_s"), 0)} s → ${fmt(val(k, prop, "avg_route_time_s"), 0)} s`} />
            </div>

            {!positive && (
              <Note kind="warn">
                On these assumptions the proposed layout costs more picker time than it saves: the extra refilling outweighs the walking saved. Try a different pair of layouts or review the refill time.
              </Note>
            )}

            <div className="grid-main">
              <Panel
                title="Where the hours come from"
                subtitle="The same numbers as the cards above, broken down: hours saved on walking and picking, hours added by extra refilling, and the net."
                icon={TrendingUp}
              >
                <Plot
                  height={280}
                  compactHeight={260}
                  summary={`Bar chart in picker-hours per year. Walking and picking saved ${fmt(pickHours, 0)}; extra refilling ${fmt(-refillHours, 0)}; net ${fmt(netHours, 0)}.`}
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      y: ["Walking and picking saved", "Extra refilling", "Net"],
                      x: [pickHours, -refillHours, netHours],
                      marker: { color: [pickHours, -refillHours, netHours].map((v) => (v >= 0 ? COLORS.good : COLORS.bad)) },
                      text: [pickHours, -refillHours, netHours].map((v) => `${fmt(v, 0)} h`),
                      textposition: "auto",
                      insidetextanchor: "middle",
                      cliponaxis: false,
                      hovertemplate: "%{y}: %{x:,.0f} picker-hours per year<extra></extra>",
                    },
                  ]}
                  layout={{ xaxis: { title: "picker-hours per year (positive = time saved)", zeroline: true }, yaxis: { autorange: "reversed" }, showlegend: false, margin: { r: 56 } }}
                />
              </Panel>

              <Panel title="How this is calculated" icon={Calculator}>
                <ul className="help-list">
                  <li>
                    <b>Walking and picking:</b> seconds saved per order × orders per day × operating days ÷ 3,600.
                  </li>
                  <li>
                    <b>Extra refilling:</b> change in refills per day (scaled to your order volume) × minutes per refill × operating days ÷ 60.
                  </li>
                  <li>
                    <b>Net:</b> walking and picking saved minus extra refilling. Money is the net hours × cost per hour.
                  </li>
                </ul>
              </Panel>
            </div>

            <Note kind="warn">
              <b>Read this as an estimate, not a forecast.</b> The route-time gain comes from a simulator with an <i>assumed</i> time model (walking speed, seconds per pick, height penalty) replayed on held-out
              orders; the sensitivity check on the Results page shows the ranking is stable, not that the absolute hours are right. Tighter bins mean more refills, which is subtracted above. Re-slotting move
              costs, congestion, batching and one-off relocation effort are not included.
            </Note>
          </div>
        );
      }}
    </Async>
  );
}
