// One place for how every Plotly chart looks. Charts pass their own data and axes; this only styles them.

export const COLORS = {
  text: "#eaf0fa",
  text2: "#b8c4da",
  muted: "#8d9cb8",
  grid: "#1d2c48",
  axis: "#31466b",
  surface: "#111a2e",
  panel: "#0a1324",
  accent: "#22d3ee",
  blue: "#38bdf8",
  good: "#34d399",
  bad: "#fb7185",
  warn: "#fbbf24",
  violet: "#a78bfa",
  slate: "#64748b",
};

// Same three layouts get the same colour everywhere (pick path, legends, cards).
export const POLICY_COLORS = { B0_random: COLORS.bad, B2_abc: COLORS.warn, Full: COLORS.accent };

export const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export const PLOT_CONFIG = {
  displaylogo: false,
  responsive: true,
  displayModeBar: "hover",
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
  toImageButtonOptions: { format: "png", scale: 2 },
};

const axisBase = (compact) => ({
  gridcolor: COLORS.grid,
  zerolinecolor: COLORS.axis,
  linecolor: COLORS.axis,
  tickfont: { color: COLORS.muted, size: compact ? 10.5 : 12 },
  title: { font: { color: COLORS.text2, size: compact ? 11.5 : 12.5 }, standoff: 10 },
  automargin: true,
  ticks: "outside",
  tickcolor: COLORS.axis,
});

const asTitle = (t) => (typeof t === "string" ? { text: t } : t);

function axis(base, over) {
  if (!over) return base;
  const { title, ...rest } = over;
  return { ...base, ...rest, title: { ...base.title, ...(title ? asTitle(title) : {}) } };
}

/** Merge a chart's own layout over the shared theme. `compact` is true on narrow containers. */
export function themeLayout(layout = {}, { height, compact = false } = {}) {
  const { xaxis, yaxis, legend, margin, title, hoverlabel, font, ...rest } = layout;
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: FONT, color: COLORS.text, size: compact ? 11 : 12.5, ...font },
    height,
    autosize: true,
    margin: { l: 16, r: 16, t: 16, b: 16, pad: 0, ...margin },
    hoverlabel: { bgcolor: COLORS.panel, bordercolor: COLORS.axis, font: { color: COLORS.text, family: FONT, size: 12.5 }, ...hoverlabel },
    legend: { orientation: "h", y: -0.22, yanchor: "top", x: 0, font: { color: COLORS.text2, size: compact ? 11 : 12 }, bgcolor: "rgba(0,0,0,0)", ...legend },
    xaxis: axis(axisBase(compact), xaxis),
    yaxis: axis(axisBase(compact), yaxis),
    ...(title ? { title: { font: { color: COLORS.text, size: 14 }, x: 0.01, xanchor: "left", ...asTitle(title) } } : {}),
    ...rest,
  };
}
