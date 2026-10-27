import { useMemo, useState } from "react";
import { Async, Note, Plot, fmt, useApi } from "../ui.jsx";

const TERMS = [
  ["distance", "Distance to depot", "#38bdf8"],
  ["shelf", "Shelf height", "#fbbf24"],
  ["fit", "Wasted space", "#a78bfa"],
  ["affinity", "Distance to bought-together items", "#34d399"],
];

function Body({ e, meta }) {
  const rows = [{ name: "chosen bin", ...e.chosen }, ...e.alternatives.map((a, i) => ({ name: `alternative ${i + 1}`, ...a }))];
  const best = e.alternatives[0];
  return (
    <>
      <p>
        <b>{e.sku}</b> ({meta.category}, class {meta.abc}, {fmt(e.velocity, 0)} pick lines in training) sits in <code>{e.chosen.loc}</code>: level {e.chosen.level}, {fmt(e.chosen.depot_m)} m from the
        depot. {e.n_feasible_bins} bins could physically hold it.
        {best && ` The cheapest alternative, ${best.loc}, would cost ${fmt((best.total / e.chosen.total - 1) * 100, 0)}% ${best.total >= e.chosen.total ? "more" : "less"} under the same cost function.`}
      </p>
      <Plot
        height={300}
        data={TERMS.map(([k, name, color]) => ({ type: "bar", name, x: rows.map((r) => r.name), y: rows.map((r) => r[k]), marker: { color } }))}
        layout={{ barmode: "stack", yaxis: { title: "cost (lower is better)" }, margin: { l: 70, r: 8, t: 8, b: 60 } }}
      />
      {e.partners.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Often ordered with</th><th>Orders together</th><th>Walk between bins (m)</th></tr></thead>
            <tbody>
              {e.partners.map((p) => (
                <tr key={p.sku}><td>{p.sku}</td><td>{p.orders}</td><td>{fmt(p.walk_m)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Note>
        Costs use the same function as the placement and the final positions of its partners. Alternatives are other bins that pass the static rules (size, weight, hazard zone,
        shelf level); bin-load limits are not re-checked for them. The greedy placer fills the best bins first, so a cheaper alternative can exist when the SKU was placed.
      </Note>
    </>
  );
}

export default function Explain({ run, policy }) {
  const lay = useApi(`/api/runs/${run.id}/layout?policy=${policy}`);
  const [sku, setSku] = useState("");
  const top = useMemo(() => (lay.data ? [...lay.data].sort((a, b) => b.velocity - a.velocity) : []), [lay.data]);
  const cur = sku || top[0]?.sku || "";
  const meta = top.find((r) => r.sku === cur);
  const ex = useApi(cur ? `/api/runs/${run.id}/explain/${encodeURIComponent(cur)}` : null);
  return (
    <>
      <div className="controls">
        <label>
          SKU
          <input list="skus" value={cur} onChange={(e) => setSku(e.target.value)} placeholder="type or pick a SKU" />
          <datalist id="skus">
            {top.slice(0, 200).map((r) => <option key={r.sku} value={r.sku}>{`${r.category} · class ${r.abc}`}</option>)}
          </datalist>
        </label>
        <span>The 200 fastest-moving SKUs are listed; any SKU id works.</span>
      </div>
      {meta && (
        <Async state={ex}>{(e) => <Body e={e} meta={meta} />}</Async>
      )}
    </>
  );
}
