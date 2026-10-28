import { useMemo, useState } from "react";
import { Boxes, Footprints, Gauge, RotateCcw, SlidersHorizontal, Target, Timer, Workflow } from "lucide-react";
import { Async, Badge, Legend, Note, Panel, Plot, Select, fmt, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";

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
const CARD_ICON = { avg_distance_per_order_m: Footprints, avg_route_time_s: Timer, fill_rate_pct: Boxes, class_a_golden_share_pct: Target, replenishments_per_day: Workflow };

function pareto(points, xk, yk) {
  const dx = METRICS[xk].better === "low" ? 1 : -1;
  const dy = METRICS[yk].better === "low" ? 1 : -1;
  return points.filter((p) => !points.some((q) => q !== p && dx * q[xk] <= dx * p[xk] && dy * q[yk] <= dy * p[yk] && (q[xk] !== p[xk] || q[yk] !== p[yk])));
}

const weightOptions = (arr) => arr.map((o) => ({ value: o, label: o === 0 ? "0 (off)" : String(o) }));

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
  const metricOptions = Object.entries(METRICS).map(([k, v]) => ({ value: k, label: v.label }));
  const isDefault = sel.lam === DEFAULT.lam && sel.mu === DEFAULT.mu && sel.erg === DEFAULT.erg;

  return (
    <Async state={st} skeleton="page" label="the trade-off settings">
      {() => (
        <div className="stack">
          <Note>
            Every combination of the three weights was run offline on the same orders ({grid.length} layouts, all rule-compliant), so the answers here are exact and instant. There is no single best layout: the weights decide
            what you are optimizing for.
          </Note>
          <div className="split">
            <div className="stack">
              <Panel title="Choose the weights" icon={SlidersHorizontal}>
                <div className="stack">
                  <Select
                    label="Affinity (bought-together)"
                    value={sel.lam}
                    onChange={(v) => setSel({ ...sel, lam: Number(v) })}
                    options={weightOptions(LAMS)}
                    hint="Pulls products that are often ordered together next to each other."
                  />
                  <Select
                    label="Best-fit (fill rate)"
                    value={sel.mu}
                    onChange={(v) => setSel({ ...sel, mu: Number(v) })}
                    options={weightOptions(MUS)}
                    hint="Prefers snug bins: higher fill rate, but more refills."
                  />
                  <Select
                    label="Golden-zone strength"
                    value={sel.erg}
                    onChange={(v) => setSel({ ...sel, erg: Number(v) })}
                    options={weightOptions(ERGS)}
                    hint="Keeps fast movers at chest-to-waist shelf heights (levels 3 and 4)."
                  />
                  <button className="btn" onClick={() => setSel(DEFAULT)} disabled={isDefault}>
                    <RotateCcw size={16} aria-hidden="true" /> Reset to the default
                  </button>
                </div>
              </Panel>
              {cur && (
                <Panel title="Result for this setting" subtitle="Compared with the default setting." icon={Gauge}>
                  <ul className="metric-list">
                    {["avg_distance_per_order_m", "avg_route_time_s", "fill_rate_pct", "class_a_golden_share_pct", "replenishments_per_day"].map((m) => {
                      const d = cur[m] - ref[m];
                      const same = Math.abs(d) < 1e-9;
                      const good = METRICS[m].better === "low" ? d <= 0 : d >= 0;
                      const Icon = CARD_ICON[m];
                      return (
                        <li key={m}>
                          <span className="ml-label">
                            <Icon size={16} aria-hidden="true" />
                            {METRICS[m].label}
                          </span>
                          <span className="ml-value">{fmt(cur[m], m === "avg_route_time_s" || m === "replenishments_per_day" ? 0 : 1)}</span>
                          <span className={`ml-delta ${same ? "" : good ? "good" : "bad"}`}>
                            {same ? "same as the default" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d), 1)} vs the default (${good ? "better" : "worse"})`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              )}
            </div>

            <Panel
              title="Every setting on one chart"
              subtitle="Pick any two measures. Green points are settings that no other setting beats on both measures: moving along them is the real decision."
              icon={Target}
              actions={cur && <Badge tone={onFront ? "good" : "warn"}>{onFront ? "Selected setting is on the Pareto front" : "Selected setting is dominated"}</Badge>}
            >
              <div className="toolbar">
                <Select label="Horizontal axis" value={xk} onChange={setX} options={metricOptions} />
                <Select label="Vertical axis" value={yk} onChange={setY} options={metricOptions} />
              </div>
              <Legend
                items={[
                  [COLORS.slate, "All settings"],
                  [COLORS.good, "Pareto front"],
                  [COLORS.accent, "Selected setting"],
                ]}
              />
              <Plot
                height={460}
                compactHeight={360}
                summary={`Scatter chart of ${grid.length} weight settings: ${METRICS[xk].label} against ${METRICS[yk].label}. ${front.length} settings are on the Pareto front.${cur ? ` The selected setting is ${onFront ? "on" : "off"} the front.` : ""}`}
                data={[
                  {
                    type: "scatter", mode: "markers", name: "all settings", x: grid.map((g) => g[xk]), y: grid.map((g) => g[yk]),
                    text: grid.map((g) => `affinity ${g.lam}, best-fit ${g.mu}, golden ${g.erg}`), hovertemplate: "%{text}<br>%{x:.1f}, %{y:.1f}<extra></extra>",
                    marker: { size: 10, color: COLORS.slate },
                  },
                  {
                    type: "scatter", mode: "markers", name: "Pareto front", x: front.map((g) => g[xk]), y: front.map((g) => g[yk]),
                    text: front.map((g) => `affinity ${g.lam}, best-fit ${g.mu}, golden ${g.erg}`), hovertemplate: "Pareto front<br>%{text}<br>%{x:.1f}, %{y:.1f}<extra></extra>",
                    marker: { size: 13, color: COLORS.good, line: { color: "#0b1220", width: 1 } },
                  },
                  cur && {
                    type: "scatter", mode: "markers", name: "selected", x: [cur[xk]], y: [cur[yk]],
                    hovertemplate: "Selected setting<br>%{x:.1f}, %{y:.1f}<extra></extra>", marker: { size: 20, color: COLORS.accent, symbol: "star", line: { color: "#fff", width: 1 } },
                  },
                ].filter(Boolean)}
                layout={{
                  xaxis: { title: `${METRICS[xk].label} (${METRICS[xk].better === "low" ? "lower is better" : "higher is better"})` },
                  yaxis: { title: `${METRICS[yk].label} (${METRICS[yk].better === "low" ? "lower is better" : "higher is better"})` },
                  showlegend: false,
                }}
              />
              <Note>
                For example, more golden-zone strength puts fast items at comfortable heights but costs some distance, and tighter bins raise fill rate but raise refills. Rule violations in every layout shown: 0.
              </Note>
            </Panel>
          </div>
        </div>
      )}
    </Async>
  );
}
