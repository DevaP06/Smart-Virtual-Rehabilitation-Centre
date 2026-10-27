import { useMemo, useState } from "react";
import { Async, Card, Note, Plot, fmt, useApi } from "../ui.jsx";

const METRICS = {
  avg_distance_per_order_m: { label: "Walking per order (m)", better: "low" },
  avg_route_time_s: { label: "Route time (s)", better: "low" },
  fill_rate_pct: { label: "Fill rate (%)", better: "high" },
  class_a_golden_share_pct: { label: "A-picks at golden height (%)", better: "high" },
  pair_distance_m: { label: "Co-ordered pair distance (m)", better: "low" },
  replenishments_per_day: { label: "Refills per day", better: "low" },
};
const LAMS = [0, 0.5, 1.5, 3];
const MUS = [0, 0.5, 1.5];
const ERGS = [0, 0.5, 1];
const DEFAULT = { lam: 1.5, mu: 0.5, erg: 1 };

function pareto(points, xk, yk) {
  const dx = METRICS[xk].better === "low" ? 1 : -1;
  const dy = METRICS[yk].better === "low" ? 1 : -1;
  return points.filter((p) => !points.some((q) => q !== p && dx * q[xk] <= dx * p[xk] && dy * q[yk] <= dy * p[yk] && (q[xk] !== p[xk] || q[yk] !== p[yk])));
}

function Pick({ label, value, options, set }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => set(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export default function Tradeoff({ run }) {
  const st = useApi(`/api/runs/${run.id}/tradeoff`);
  const [sel, setSel] = useState(DEFAULT);
  const [xk, setX] = useState("avg_distance_per_order_m");
  const [yk, setY] = useState("fill_rate_pct");
  const grid = st.data || [];
  const cur = grid.find((g) => g.lam === sel.lam && g.mu === sel.mu && g.erg === sel.erg);
  const ref = grid.find((g) => g.lam === DEFAULT.lam && g.mu === DEFAULT.mu && g.erg === DEFAULT.erg);
  const front = useMemo(() => (grid.length ? pareto(grid, xk, yk) : []), [grid, xk, yk]);
  const onFront = cur && front.includes(cur);

  return (
    <Async state={st}>
      {() => (
        <>
          <div className="panel">
            <h2>Trade-off explorer: pick the weights, see the consequences</h2>
            <p style={{ color: "var(--muted)" }}>
              Every combination of the three objective weights was run offline on the same orders ({grid.length} layouts, all rule-compliant), so the answers here are exact and
              instant. There is no single best layout: the weights decide what you are optimizing for.
            </p>
            <div className="controls">
              <Pick label="Affinity (bought-together)" value={sel.lam} options={LAMS} set={(v) => setSel({ ...sel, lam: v })} />
              <Pick label="Best-fit (fill rate)" value={sel.mu} options={MUS} set={(v) => setSel({ ...sel, mu: v })} />
              <Pick label="Golden-zone strength" value={sel.erg} options={ERGS} set={(v) => setSel({ ...sel, erg: v })} />
              <button className="btn" onClick={() => setSel(DEFAULT)}>Reset to the default</button>
            </div>
            {cur && (
              <div className="grid cards">
                {["avg_distance_per_order_m", "avg_route_time_s", "fill_rate_pct", "class_a_golden_share_pct", "replenishments_per_day"].map((m) => {
                  const d = cur[m] - ref[m];
                  const good = METRICS[m].better === "low" ? d <= 0 : d >= 0;
                  return (
                    <Card key={m} tone={Math.abs(d) < 1e-9 ? "" : good ? "good" : "bad"} label={METRICS[m].label} value={fmt(cur[m], m === "avg_route_time_s" || m === "replenishments_per_day" ? 0 : 1)}
                      sub={Math.abs(d) < 1e-9 ? "same as the default" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d), 1)} vs the default`} />
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="controls">
              <label>
                X axis
                <select value={xk} onChange={(e) => setX(e.target.value)}>
                  {Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label>
                Y axis
                <select value={yk} onChange={(e) => setY(e.target.value)}>
                  {Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <span>{cur ? (onFront ? "The selected layout is on the Pareto front for these two axes." : "The selected layout is dominated: another setting is at least as good on both axes.") : ""}</span>
            </div>
            <Plot
              height={420}
              data={[
                { type: "scatter", mode: "markers", name: "all settings", x: grid.map((g) => g[xk]), y: grid.map((g) => g[yk]),
                  text: grid.map((g) => `affinity ${g.lam}, best-fit ${g.mu}, golden ${g.erg}`), hovertemplate: "%{text}<br>%{x:.1f}, %{y:.1f}<extra></extra>",
                  marker: { size: 9, color: "#64748b" } },
                { type: "scatter", mode: "markers", name: "Pareto front", x: front.map((g) => g[xk]), y: front.map((g) => g[yk]),
                  marker: { size: 12, color: "#34d399", line: { color: "#0b1220", width: 1 } } },
                cur && { type: "scatter", mode: "markers", name: "selected", x: [cur[xk]], y: [cur[yk]], marker: { size: 18, color: "#38bdf8", symbol: "star" } },
              ].filter(Boolean)}
              layout={{ xaxis: { title: METRICS[xk].label }, yaxis: { title: METRICS[yk].label } }}
            />
            <Note>
              Green points are not beaten on both chosen axes by any other setting. Moving along the front is the real decision: for example, more golden-zone strength puts
              fast items at comfortable heights but costs some distance, and tighter bins raise fill rate but raise refills. Rule violations in every layout shown: 0.
            </Note>
          </div>
        </>
      )}
    </Async>
  );
}
