import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Plotly from "plotly.js-cartesian-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { AlertTriangle, CheckCircle2, Inbox, Info, RefreshCw } from "lucide-react";
import { PLOT_CONFIG, themeLayout } from "./chartTheme.js";

const PlotlyPlot = createPlotlyComponent(Plotly);
export { Plotly };

/* ------------------------------------------------------------------ names (unchanged) */
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

export const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
/** "−12.3%" for a reduction, "+1.2%" when the layout is worse than the baseline. */
export const less = (r) => `${r >= 0 ? "−" : "+"}${fmt(Math.abs(r))}%`;

/* ------------------------------------------------------------------ data fetching */
// Same requests as before. `retry` re-runs the same fetch; `loaded` tells "finished (even if the payload is null)" from "nothing requested".
export function useApi(path) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ data: null, error: null, loading: !!path, loaded: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ data: null, error: null, loading: true, loaded: false });
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText} for ${path}`))))
      .then((data) => live && setState({ data, error: null, loading: false, loaded: true }))
      .catch((error) => live && setState({ data: null, error, loading: false, loaded: false }));
    return () => {
      live = false;
    };
  }, [path, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

/** Treat several useApi results as one: loading until all are loaded, first error wins, retry re-runs every request. */
export function combine(...states) {
  const live = states.filter(Boolean);
  return {
    loading: live.some((x) => x.loading),
    error: live.find((x) => x.error)?.error || null,
    loaded: live.every((x) => x.loaded),
    data: live.map((x) => x.data),
    retry: () => live.forEach((x) => x.retry?.()),
  };
}

/* ------------------------------------------------------------------ states */
function Sk({ h = 14, w = "100%", style }) {
  return <div className="skeleton sk-line" style={{ height: h, width: w, ...style }} />;
}

export function Skeleton({ variant = "panel", label = "content" }) {
  const kpis = (
    <div className="kpi-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div className="skeleton" key={i} style={{ height: 118, borderRadius: 14 }} />
      ))}
    </div>
  );
  const chart = (
    <div className="panel" aria-hidden="true">
      <Sk h={16} w="40%" />
      <Sk h={12} w="70%" style={{ marginTop: 10 }} />
      <div className="skeleton" style={{ height: 300, marginTop: 18 }} />
    </div>
  );
  const table = (
    <div className="panel" aria-hidden="true">
      <Sk h={16} w="35%" />
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Sk key={i} h={22} />
        ))}
      </div>
    </div>
  );
  return (
    <div role="status" aria-busy="true" className="stack fade-in">
      <span className="sr-only">Loading {label}…</span>
      {variant === "page" && (
        <>
          {kpis}
          {chart}
          {table}
        </>
      )}
      {variant === "kpis" && kpis}
      {variant === "chart" && chart}
      {variant === "table" && table}
      {variant === "panel" && chart}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="state-panel fade-in" role="status">
      <Icon size={30} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorPanel({ error, onRetry, label = "this section" }) {
  return (
    <div className="state-panel error fade-in" role="alert">
      <AlertTriangle size={30} aria-hidden="true" />
      <h3>Couldn't load {label}</h3>
      <p>The stored results could not be retrieved. This is usually a network or database timeout; trying again normally works.</p>
      {onRetry && (
        <button className="btn primary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
      )}
      <details className="tech">
        <summary>Technical details</summary>
        <pre>{String(error?.message || error)}</pre>
      </details>
    </div>
  );
}

/** Loading / error / loaded wrapper. Same call shape as before: <Async state={useApi(...)}>{(data) => ...}</Async>. */
export function Async({ state, children, skeleton = "panel", label }) {
  if (state.loading) return <Skeleton variant={skeleton} label={label} />;
  if (state.error) return <ErrorPanel error={state.error} onRetry={state.retry} label={label} />;
  if (!state.loaded) return null;
  return children(state.data);
}

/* ------------------------------------------------------------------ small building blocks */
export function Card({ label, value, sub, tone, icon: Icon, children }) {
  return (
    <div className={`kpi ${tone || ""}`}>
      <div className="kpi-top">
        {Icon && (
          <span className="kpi-icon">
            <Icon size={18} aria-hidden="true" />
          </span>
        )}
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

const NOTE_ICON = { info: Info, warn: AlertTriangle, good: CheckCircle2 };
export function Note({ children, kind = "info" }) {
  const Icon = NOTE_ICON[kind] || Info;
  return (
    <div className={`note ${kind}`}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Panel({ title, subtitle, icon: Icon, actions, children, className = "", id }) {
  const uid = useId();
  const tid = `${id || uid}-t`;
  return (
    <section className={`panel ${className}`} aria-labelledby={title ? tid : undefined} id={id}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && (
              <h2 className="panel-title section-title" id={tid}>
                {Icon && <Icon size={18} aria-hidden="true" />}
                {title}
              </h2>
            )}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Chip({ icon: Icon, children }) {
  return (
    <span className="chip">
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Badge({ tone = "", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Select({ label, value, onChange, options, hint, id }) {
  const uid = useId();
  const sid = id || uid;
  return (
    <div className="field">
      <label htmlFor={sid}>{label}</label>
      <select id={sid} className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${sid}-h` : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="field-hint" id={`${sid}-h`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function NumberField({ label, value, onChange, step = 1, min = 0, unit, hint, id }) {
  const uid = useId();
  const nid = id || uid;
  return (
    <div className="field">
      <label htmlFor={nid}>{label}</label>
      <div className="input-unit">
        <input id={nid} className="input" type="number" inputMode="decimal" value={value} step={step} min={min} onChange={(e) => onChange(Number(e.target.value))} aria-describedby={hint ? `${nid}-h` : undefined} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && (
        <span className="field-hint" id={`${nid}-h`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={String(value) === String(o.value)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TableScroll({ label, children, className = "" }) {
  return (
    <div className={`table-scroll ${className}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Small "i" next to a technical term. Opens on hover or keyboard focus; rendered in a portal so tables never clip it. */
export function InfoTip({ text }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(Math.max(8, r.left + r.width / 2 - 140), window.innerWidth - 296), top: r.bottom + 8 });
  };
  return (
    <>
      <span ref={ref} className="infotip" tabIndex={0} role="img" aria-label={text} onMouseEnter={show} onFocus={show} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)}>
        <Info size={14} aria-hidden="true" />
      </span>
      {pos && createPortal(<div className="tip-pop" role="tooltip" style={pos}>{text}</div>, document.body)}
    </>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map(([color, text]) => (
        <span key={text}>
          <i style={{ background: color }} aria-hidden="true" />
          {text}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ charts */
/**
 * Every chart goes through here. It applies the shared theme, picks a shorter height on narrow containers,
 * and re-fits the chart when its container changes size (for example when the sidebar opens or closes).
 * `summary` is a plain-language description for assistive technology.
 */
export function Plot({ data, layout = {}, height = 360, compactHeight, summary, onInit, config, ...rest }) {
  const box = useRef(null);
  const gd = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      setW(Math.round(entries[0].contentRect.width));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => gd.current && Plotly.Plots.resize(gd.current));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  const compact = w > 0 && w < 520;
  const h = compact && compactHeight ? compactHeight : height;
  // Stable objects: the chart library re-initialises whenever it is handed a new layout/config object.
  const themed = useMemo(() => themeLayout(layout, { height: h, compact }), [layout, h, compact]);
  const cfg = useMemo(() => ({ ...PLOT_CONFIG, ...config }), [config]);
  const style = useMemo(() => ({ width: "100%", height: h }), [h]);
  const handleInit = useCallback(
    (_, el) => {
      gd.current = el;
      onInit?.(el);
    },
    [onInit],
  );
  const handleUpdate = useCallback((_, el) => {
    gd.current = el;
  }, []);
  return (
    <div ref={box} className="chart" role={summary ? "group" : undefined} aria-label={summary}>
      <PlotlyPlot data={data} layout={themed} config={cfg} useResizeHandler style={style} onInitialized={handleInit} onUpdate={handleUpdate} {...rest} />
    </div>
  );
}
