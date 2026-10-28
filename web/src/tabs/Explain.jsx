import { useMemo, useState } from "react";
import { Box, Footprints, Hash, Layers, Search } from "lucide-react";
import { Async, Card, Legend, Note, Plot, TableScroll, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

const TERMS = [
  ["distance", "Distance to depot", COLORS.blue],
  ["shelf", "Shelf height", COLORS.warn],
  ["fit", "Wasted space", COLORS.violet],
  ["affinity", "Distance to bought-together items", COLORS.good],
];

function Body({ e, meta }) {
  const rows = [{ name: "chosen bin", ...e.chosen }, ...e.alternatives.map((a, i) => ({ name: `alternative ${i + 1}`, ...a }))];
  const best = e.alternatives[0];
  const golden = e.chosen.level === 3 || e.chosen.level === 4;
  return (
    <div className="stack">
      <div className="kpi-grid">
        <Card icon={Box} label="Storage bin" value={<span style={{ fontSize: 20 }}>{e.chosen.loc}</span>} sub={`${meta.category} · class ${meta.abc}`} />
        <Card icon={Layers} tone={golden ? "good" : ""} label="Shelf level" value={e.chosen.level} sub={golden ? "Golden zone (chest-to-waist)" : "Outside the golden zone"} />
        <Card icon={Footprints} label="Distance from depot" value={`${fmt(e.chosen.depot_m)} m`} sub={`${e.n_feasible_bins} bins could physically hold it`} />
        <Card icon={Hash} label="Demand in training" value={fmt(e.velocity, 0)} sub="pick lines" />
      </div>
      <p style={{ margin: 0 }}>
        <b>{e.sku}</b> ({meta.category}, class {meta.abc}, {fmt(e.velocity, 0)} pick lines in training) sits in <code>{e.chosen.loc}</code>: level {e.chosen.level}, {fmt(e.chosen.depot_m)} m from the depot. {e.n_feasible_bins} bins
        could physically hold it.
        {best && ` The cheapest alternative, ${best.loc}, would cost ${fmt(Math.abs(best.total / e.chosen.total - 1) * 100, 0)}% ${best.total >= e.chosen.total ? "more" : "less"} under the same cost function.`}
      </p>
      <div className="grid-2">
        <div>
          <h3 className="eyebrow" style={{ marginBottom: 8 }}>Cost of the chosen bin and the best alternatives</h3>
          <Legend items={TERMS.map(([, name, color]) => [color, name])} />
          <Plot
            height={320}
            compactHeight={280}
            summary={`Stacked bar chart of the cost of the chosen bin and ${e.alternatives.length} alternatives, split into distance, shelf height, wasted space and distance to bought-together items. Lower is better.`}
            data={TERMS.map(([k, name, color]) => ({ type: "bar", name, x: rows.map((r) => r.name), y: rows.map((r) => r[k]), marker: { color }, hovertemplate: `${name}: %{y:,.0f}<extra></extra>` }))}
            layout={{ barmode: "stack", yaxis: { title: "cost (lower is better)" }, showlegend: false }}
          />
        </div>
        <div className="stack">
          <TableScroll label="Chosen bin and alternatives">
            <table className="data compact">
              <caption className="sr-only">The chosen bin and the cheapest alternatives with their total cost.</caption>
              <thead>
                <tr>
                  <th scope="col">Bin</th>
                  <th scope="col">Level</th>
                  <th scope="col">Depot (m)</th>
                  <th scope="col">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={i === 0 ? "hl" : ""}>
                    <td>{i === 0 ? `${r.loc} (chosen)` : r.loc}</td>
                    <td>{r.level}</td>
                    <td>{fmt(r.depot_m)}</td>
                    <td>{fmt(r.total, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {e.partners.length > 0 && (
            <TableScroll label="Products often ordered with this one" className="tall">
              <table className="data compact">
                <caption className="sr-only">Products often ordered together with this one.</caption>
                <thead>
                  <tr>
                    <th scope="col">Often ordered with</th>
                    <th scope="col">Orders together</th>
                    <th scope="col">Walk between bins (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {e.partners.map((p) => (
                    <tr key={p.sku}>
                      <td>{p.sku}</td>
                      <td>{p.orders}</td>
                      <td>{fmt(p.walk_m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      </div>
      <Note>
        Costs use the same function as the placement and the final positions of its partners. Alternatives are other bins that pass the static rules (size, weight, hazard zone, shelf level); bin-load limits are not
        re-checked for them. The greedy placer fills the best bins first, so a cheaper alternative can exist when the SKU was placed.
      </Note>
    </div>
  );
}

/** SKU inspector. `rows` are the stored layout rows of the Full layout (the only layout with explanations). */
export default function Explain({ run, rows }) {
  const [sku, setSku] = useState("");
  const top = useMemo(() => [...rows].sort((a, b) => b.velocity - a.velocity), [rows]);
  const cur = sku || top[0]?.sku || "";
  const meta = top.find((r) => r.sku === cur);
  const ex = useApi(meta ? `/api/runs/${run.id}/explain/${encodeURIComponent(cur)}` : null);
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="field">
          <label htmlFor="sku-search">Search a SKU</label>
          <input id="sku-search" className="input" list="skus" value={cur} onChange={(e) => setSku(e.target.value)} placeholder="Type a product id" autoComplete="off" spellCheck={false} />
          <datalist id="skus">
            {top.slice(0, 200).map((r) => (
              <option key={r.sku} value={r.sku}>{`${r.category} · class ${r.abc}`}</option>
            ))}
          </datalist>
          <span className="field-hint">The 200 fastest-moving SKUs are suggested as you type; type a SKU id to search.</span>
        </div>
        <div className="btn-row" aria-label="Quick picks: fastest-moving SKUs">
          <span className="eyebrow">Fastest sellers</span>
          {top.slice(0, 5).map((r) => (
            <button key={r.sku} className="btn small" onClick={() => setSku(r.sku)}>
              {r.sku}
            </button>
          ))}
        </div>
      </div>
      {cur && !meta && (
        <Note kind="warn">
          No SKU "{cur}" in this scenario. Pick one from the list: the 200 fastest-moving SKUs are suggested as you type.
        </Note>
      )}
      {meta && (
        <Async state={ex} skeleton="chart" label="the SKU explanation">
          {(e) => <Body e={e} meta={meta} />}
        </Async>
      )}
    </div>
  );
}
