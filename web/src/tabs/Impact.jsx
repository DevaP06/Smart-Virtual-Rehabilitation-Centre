import { useState } from "react";
import { Async, Card, LABEL, LADDER, Note, fmt, useApi } from "../ui.jsx";

const val = (k, p, m) => k[p]?.kpis?.[m]?.value;

function Num({ label, value, set, step = 1, suffix }) {
  return (
    <label>
      {label}
      <input type="number" value={value} step={step} min="0" onChange={(e) => set(Number(e.target.value))} />
      {suffix}
    </label>
  );
}

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
    <Async state={kp}>
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
        return (
          <>
            <div className="panel">
              <h2>What it is worth: editable assumptions</h2>
              <p style={{ color: "var(--muted)" }}>
                Converts the simulated gains into labour hours and money. Change the numbers to your operation; every figure below is an estimate that
                follows from them.
              </p>
              <div className="controls">
                <label>
                  Compare
                  <select value={prop} onChange={(e) => setProp(e.target.value)}>
                    {LADDER.filter((p) => !["naive"].includes(p)).map((p) => (
                      <option key={p} value={p}>{LABEL[p]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  against
                  <select value={base} onChange={(e) => setBase(e.target.value)}>
                    {LADDER.map((p) => (
                      <option key={p} value={p}>{LABEL[p]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="controls">
                <Num label="Orders per day" value={ordersDay} set={setOrdersDay} step={50} />
                <Num label="Operating days / year" value={opDays} set={setOpDays} step={10} />
                <Num label="Picker cost per hour" value={wage} set={setWage} step={1} suffix=" (your currency)" />
                <Num label="Minutes per refill" value={refillMin} set={setRefillMin} step={0.5} />
              </div>
            </div>

            <div className="grid cards" style={{ marginTop: 16 }}>
              <Card tone={netHours >= 0 ? "good" : "bad"} label="Net picker-hours saved / year" value={fmt(netHours, 0)} sub={`${fmt(pickHours, 0)} walking and picking, minus ${fmt(refillHours, 0)} extra refilling`} />
              <Card tone={netHours >= 0 ? "good" : "bad"} label="Net saving / year" value={fmt(netHours * wage, 0)} sub={`at ${wage} per hour, ${ordersDay} orders/day`} />
              <Card label="Walking saved / year" value={`${fmt(km, 0)} km`} sub={`${fmt(dDist)} m less per order`} />
              <Card label="Time saved per order" value={`${fmt(dT, 0)} s`} sub={`${fmt(val(k, base, "avg_route_time_s"), 0)} s → ${fmt(val(k, prop, "avg_route_time_s"), 0)} s`} />
            </div>

            <Note kind="warn">
              <b>Read this as an estimate, not a forecast.</b> The route-time gain comes from a simulator with an <i>assumed</i> time model (walking speed, seconds per
              pick, height penalty) replayed on held-out orders; the sensitivity check on the Results tab shows the ranking is stable, not that the absolute hours are right.
              Tighter bins mean more refills, which is subtracted above. Re-slotting move costs, congestion, batching and one-off relocation effort are not included.
            </Note>
          </>
        );
      }}
    </Async>
  );
}
