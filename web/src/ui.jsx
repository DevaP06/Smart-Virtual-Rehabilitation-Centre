import { useEffect, useState } from "react";
import Plotly from "plotly.js-cartesian-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

const PlotlyPlot = createPlotlyComponent(Plotly);

export const LABEL = {
  naive: "Naive (ignores rules)",
  B0_random: "B0 Random, rule-compliant",
  B1_chaotic: "B1 Chaotic stow",
  B2_abc: "B2 ABC zoning only",
  B3_golden: "B3 + golden zone",
  B4_affinity: "B4 + affinity",
  Full: "Full (+ best-fit)",
  "Full+CPSAT": "Full + CP-SAT",
  "Full+CPSAT+LS": "Full + CP-SAT + local search",
};
export const LADDER = Object.keys(LABEL);
export const RULE_LABEL = {
  unplaced_skus: "SKUs not placed",
  double_booked_bins: "Bins holding two SKUs",
  dimension_overflow: "Dimension does not fit",
  volume_overflow: "Volume exceeds bin",
  bin_overweight: "Bin overweight",
  beam_overload: "Shelf beam overloaded",
  frame_overload: "Rack frame overloaded",
  hazard_zone_breach: "Hazard zone breach",
  fragile_bad_level: "Fragile on wrong level",
  heavy_too_high: "Heavy item too high",
  incompatible_adjacent: "Incompatible neighbours",
  total: "Total violations",
};

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function Plot({ data, layout = {}, height = 360, ...rest }) {
  const base = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: css("--text") || "#e2e8f0", family: "Inter, system-ui, sans-serif", size: 12 },
    margin: { l: 56, r: 16, t: 32, b: 48 },
    height,
    hoverlabel: { bgcolor: "#0f172a", font: { color: "#f8fafc" } },
    legend: { orientation: "h", y: -0.2 },
    xaxis: { gridcolor: "#334155", zerolinecolor: "#334155" },
    yaxis: { gridcolor: "#334155", zerolinecolor: "#334155" },
  };
  const merged = {
    ...base,
    ...layout,
    xaxis: { ...base.xaxis, ...(layout.xaxis || {}) },
    yaxis: { ...base.yaxis, ...(layout.yaxis || {}) },
  };
  return (
    <PlotlyPlot
      data={data}
      layout={merged}
      config={{ displaylogo: false, responsive: true }}
      useResizeHandler
      style={{ width: "100%" }}
      {...rest}
    />
  );
}

export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ data: null, error: null, loading: true });
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText} for ${path}`))))
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

export function Async({ state, children }) {
  if (state.loading) return <div className="state">Loading…</div>;
  if (state.error) return <div className="state error">Could not load data: {state.error.message}</div>;
  if (!state.data) return null;
  return children(state.data);
}

export const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));

export function Card({ label, value, sub, tone }) {
  return (
    <div className={`card ${tone || ""}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

export function Note({ children, kind = "info" }) {
  return <div className={`note ${kind}`}>{children}</div>;
}

/** "−12.3%" for a reduction, "+1.2%" when the layout is worse than the baseline. */
export const less = (r) => `${r >= 0 ? "−" : "+"}${fmt(Math.abs(r))}%`;
