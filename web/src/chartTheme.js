// One place for how every Plotly chart looks. Charts pass their own data and axes; this only styles them.

// Two palettes, one per theme. COLORS is mutated in place by setChartPalette (called from theme.js) so every chart that reads
// COLORS.* at render time follows the active theme. Semantics: accent = optimized, slate = baseline, warn = attention/selected, bad = violation.
const PALETTES = {
  light: {
    text: "#172b25", text2: "#44564d", muted: "#5e6d65", grid: "#e1e4d8", axis: "#c2c9b9", surface: "#fbfaf5", panel: "#fbfaf5",
    accent: "#008b68", blue: "#3b7ea6", good: "#0b7a5c", bad: "#bc4a42", warn: "#c4802f", violet: "#7c6bb5", slate: "#7c8a83", onDark: "#f3f1e8", onLight: "#172b25",
  },
  dark: {
    text: "#eaf0e8", text2: "#b0c0b5", muted: "#8a9c91", grid: "#2a3d35", axis: "#3c5448", surface: "#182520", panel: "#111b17",
    accent: "#35b08c", blue: "#6fb2d6", good: "#4cc3a0", bad: "#ec7f76", warn: "#e1a15a", violet: "#a99bdb", slate: "#8d9fa8", onDark: "#eaf0e8", onLight: "#111b17",
  },
};

export const COLORS = { ...PALETTES.light };

// Same three layouts get the same colour everywhere (pick path, legends, cards). Baseline is blue-grey, best layout is the accent.
export const POLICY_COLORS = {};
export function setChartPalette(name) {
  Object.assign(COLORS, PALETTES[name] || PALETTES.light);
  Object.assign(POLICY_COLORS, { B0_random: COLORS.slate, B2_abc: COLORS.warn, Full: COLORS.accent });
}
setChartPalette("light");

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
