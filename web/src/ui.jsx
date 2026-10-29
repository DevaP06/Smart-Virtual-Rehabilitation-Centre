import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Plotly from "plotly.js-cartesian-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { AlertTriangle, CheckCircle2, Inbox, Info, RefreshCw } from "lucide-react";
import { PLOT_CONFIG, themeLayout } from "./chartTheme.js";
import { useTheme } from "./theme.js";

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
/* Entrance animation: a chart plays once, the first time it is scrolled into view, from its starting state to its exact data.
 *   bars   -> grow from the zero baseline (native Plotly transition); error bars appear once they have grown
 *   lines  -> the line is drawn progressively (frames that only slice the real arrays; no invented points)
 *   other  -> heatmaps, markers, mixed charts: a short fade (no per-cell animation)
 * Later data changes (a slider, a new scenario) update the chart normally and do not replay it. */
const asArr = (v) => (Array.isArray(v) ? v : []);
function revealKind(data) {
  if (!data.length) return "fade";
  const types = data.map((d) => d.type || "scatter");
  if (types.every((t) => t === "bar")) return "bars";
  if (types.every((t) => t === "scatter") && data.every((d) => typeof d.mode === "string" && d.mode.includes("lines"))) return "lines";
  return "fade";
}
const barKey = (d) => (d.orientation === "h" ? "x" : "y");
/** Values the final chart will span on its value axis (stacked bars: the per-category totals). Always includes the zero baseline. */
function barExtent(data, layout) {
  const stacked = layout?.barmode === "stack" || layout?.barmode === "relative";
  const key = (d) => barKey(d);
  if (!stacked) return [0, ...data.flatMap((d) => asArr(d[key(d)]).filter((v) => typeof v === "number"))];
  const n = Math.max(...data.map((d) => asArr(d[key(d)]).length), 0);
  const out = [0];
  for (let i = 0; i < n; i++) {
    let pos = 0;
    let neg = 0;
    data.forEach((d) => {
      const v = asArr(d[key(d)])[i];
      if (typeof v === "number") v >= 0 ? (pos += v) : (neg += v);
    });
    out.push(pos, neg);
  }
  return out;
}
/** The start state of a reveal. An invisible trace carries the FINAL extents so the axes are already right while the data is still zero / short
 *  (without it the axis autoranges to the starting data and stays wrong after the animation). It is dropped when the reveal ends. */
function startState(data, kind, layout) {
  if (kind === "bars") {
    const ext = barExtent(data, layout);
    const horiz = data[0]?.orientation === "h";
    const cat = asArr(data[0]?.[horiz ? "y" : "x"])[0];
    const ghost = { type: "scatter", mode: "markers", hoverinfo: "skip", showlegend: false, marker: { size: 0, opacity: 0 }, ...(horiz ? { x: ext, y: ext.map(() => cat) } : { x: ext.map(() => cat), y: ext }) };
    return [
      ...data.map((d) => ({ ...d, [barKey(d)]: asArr(d[barKey(d)]).map(() => 0), error_x: d.error_x && { ...d.error_x, visible: false }, error_y: d.error_y && { ...d.error_y, visible: false } })),
      ...(ext.length > 1 && cat !== undefined ? [ghost] : []),
    ];
  }
  if (kind === "lines") {
    const ghost = { type: "scatter", mode: "markers", hoverinfo: "skip", showlegend: false, marker: { size: 0, opacity: 0 }, x: data.flatMap((d) => asArr(d.x)), y: data.flatMap((d) => asArr(d.y)) };
    return [...data.map((d) => ({ ...d, x: asArr(d.x).slice(0, 1), y: asArr(d.y).slice(0, 1), text: Array.isArray(d.text) ? d.text.slice(0, 1) : d.text })), ghost];
  }
  return data;
}
const REVEAL_MS = 750;
const LINE_FRAMES = 18;

/**
 * Every chart goes through here. It applies the shared theme, picks a shorter height on narrow containers,
 * and re-fits the chart when its container changes size (for example when the sidebar opens or closes).
 * `summary` is a plain-language description for assistive technology. `reveal="none"` turns the entrance animation off
 * (charts that run their own animation, such as the pick-path playback, use it).
 */
export function Plot({ data, layout = {}, height = 360, compactHeight, summary, onInit, config, reveal = "auto", ...rest }) {
  const theme = useTheme();
  const box = useRef(null);
  const gd = useRef(null);
  const [w, setW] = useState(0);
  const off = reveal === "none" || !!rest.frames || typeof IntersectionObserver === "undefined" || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [phase, setPhase] = useState(off ? "done" : "wait"); // wait (off screen) -> run (animating) -> done
  const kind = revealKind(data);
  const frozen = useRef(null);
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
  // Wait until a meaningful part of the chart is on screen, then start (once).
  useEffect(() => {
    if (phase !== "wait") return undefined;
    const el = box.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          frozen.current = { data, kind };
          setPhase("run");
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps -- re-observing is cheap and keeps `data` fresh while waiting
  useEffect(() => {
    if (phase !== "run") return undefined;
    const { data: d, kind: k } = frozen.current;
    const el = gd.current;
    let dead = false;
    const finish = () => !dead && setPhase("done");
    const guard = setTimeout(finish, REVEAL_MS + 1500); // never leave a chart half drawn
    if (!el || k === "fade") {
      const t = setTimeout(finish, 620);
      return () => {
        dead = true;
        clearTimeout(t);
        clearTimeout(guard);
      };
    }
    if (k === "bars") {
      Promise.resolve(
        Plotly.animate(el, { data: d.map((t) => ({ [barKey(t)]: asArr(t[barKey(t)]) })), traces: d.map((_, i) => i) }, { transition: { duration: REVEAL_MS, easing: "cubic-out" }, frame: { duration: REVEAL_MS, redraw: true } }),
      ).then(finish, finish);
    } else {
      const names = [];
      const frames = [];
      for (let n = 1; n <= LINE_FRAMES; n++) {
        const name = `reveal${n}`;
        names.push(name);
        frames.push({
          name,
          traces: d.map((_, i) => i),
          data: d.map((t) => {
            const m = Math.max(1, Math.ceil((asArr(t.x).length * n) / LINE_FRAMES));
            return { x: asArr(t.x).slice(0, m), y: asArr(t.y).slice(0, m) };
          }),
        });
      }
      Promise.resolve(Plotly.addFrames(el, frames))
        .then(() => Plotly.animate(el, names, { frame: { duration: REVEAL_MS / LINE_FRAMES, redraw: false }, transition: { duration: 0 }, mode: "immediate" }))
        .then(finish, finish);
    }
    return () => {
      dead = true;
      clearTimeout(guard);
    };
  }, [phase]);
  const compact = w > 0 && w < 520;
  const h = compact && compactHeight ? compactHeight : height;
  // Stable objects: the chart library re-initialises whenever it is handed a new layout/config object.
  const themed = useMemo(() => themeLayout(layout, { height: h, compact }), [layout, h, compact, theme]);
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
  // wait: start state; run: the state the animation started from (frozen, so re-renders cannot reset it); done: the real data.
  const shown = phase === "done" ? data : phase === "run" ? startState(frozen.current.data, frozen.current.kind, layout) : startState(data, kind, layout);
  return (
    <div ref={box} className="chart" data-reveal={kind === "fade" ? phase : "anim"} role={summary ? "group" : undefined} aria-label={summary}>
      <PlotlyPlot data={shown} layout={themed} config={cfg} useResizeHandler style={style} onInitialized={handleInit} onUpdate={handleUpdate} {...rest} />
    </div>
  );
}
