// Pick Path Simulator. One order from the held-out period is walked on three layouts (the stored /paths data: one [x, y] polyline per layout and
// routing policy). Two modes show the SAME walks and share ONE playback clock (`sim`): 2D Simulation (three separate plots on shared axes) and
// 3D Simulation (the walks in the 3D warehouse). The route calculations themselves happen offline; nothing here recomputes a route.
import { Component, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, CheckCircle2, Pause, Play, RotateCcw, Route } from "lucide-react";
import { Async, LABEL, Note, Panel, Plot, Plotly, Segmented, Select, Skeleton, fmt, useApi } from "../ui.jsx";
import { useTheme } from "../theme.js";
import { COLORS, POLICY_COLORS } from "../chartTheme.js";

const PickPath3D = lazy(() => import("../components/PickPath3D.jsx"));

class Safe extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? <Note kind="warn">The 3D simulation could not start ({String(this.state.error.message || this.state.error)}). The 2D Simulation shows the same walks.</Note> : this.props.children;
  }
}

const MODES = [
  { value: "2d", label: "2D Simulation" },
  { value: "3d", label: "3D Simulation" },
];
const ROUTING = [
  { value: "return", label: "Return route (front cross-aisle only)" },
  { value: "s_shape", label: "S-shape (rear cross-aisle)" },
];
const ROUTING_HINT = {
  return: "The picker walks into each aisle as far as the deepest item needs, then back out.",
  s_shape: "The picker walks each needed aisle end to end, alternating direction, using a rear walkway.",
};
const SPEED_MS = { 0.5: 90, 1: 45, 2: 22 }; // milliseconds per animation frame

/** Position after walking `d` metres along an axis-aligned polyline, plus its total length. */
function walker(points) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    seg.push({ x0, y0, x1, y1, len, start: total });
    total += len;
  }
  const at = (d) => {
    const s = seg.find((q) => d <= q.start + q.len) || seg[seg.length - 1];
    const f = s.len ? Math.min(1, Math.max(0, (d - s.start) / s.len)) : 1;
    return [s.x0 + (s.x1 - s.x0) * f, s.y0 + (s.y1 - s.y0) * f];
  };
  return { total, at };
}

/** The part of the polyline already walked after `d` metres (ends exactly at the picker's position). */
function visited(points, d) {
  const out = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (acc + len <= d) {
      out.push(points[i]);
      acc += len;
    } else {
      const f = len ? (d - acc) / len : 1;
      out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
      break;
    }
  }
  return out;
}

/**
 * One layout's walk in its own plot. The faint line is the whole route (numbers mark the far ends in the order they are reached), the solid line is
 * what has been walked, the dot is where the picker is. Playback paints through `sim.subs` with Plotly.restyle, so React never re-renders the chart.
 */
const WalkPlot = memo(function WalkPlot({ p, w, step, ax, color, orderId, routing, sim, theme }) {
  const gd = useRef(null);
  const lastF = useRef(-1);
  const snap = useCallback(
    (k) => {
      const d = Math.min(k * step, w.total);
      const v = visited(p.points, d);
      const [cx, cy] = w.at(d);
      return { vx: v.map((q) => q[0]), vy: v.map((q) => q[1]), cx, cy, label: d >= w.total ? `done: ${fmt(w.total, 0)} m` : `${fmt(d, 0)} m` };
    },
    [p, w, step],
  );
  const data = useMemo(() => {
    const s = snap(Math.floor(sim.k));
    lastF.current = Math.floor(sim.k);
    const n = p.points.length;
    let k = 0;
    const nums = p.points.map((q, i) => (i === 0 || i === n - 1 || q[1] <= 0 ? "" : String(++k)));
    return [
      {
        type: "scatter", mode: "lines+markers+text", hoverinfo: "skip", showlegend: false, x: p.points.map((q) => q[0]), y: p.points.map((q) => q[1]),
        line: { color: COLORS.axis, width: 2, dash: "dot" }, marker: { color: COLORS.muted, size: p.points.map((q, i) => (i === 0 || i === n - 1 ? 0 : q[1] > 0 ? 6 : 0)) },
        text: nums, textposition: "top right", textfont: { color: COLORS.muted, size: 10 },
      },
      { type: "scatter", mode: "lines", hoverinfo: "skip", showlegend: false, x: s.vx, y: s.vy, text: [""], line: { color, width: 4 } },
      { type: "scatter", mode: "markers+text", hoverinfo: "skip", showlegend: false, x: [s.cx], y: [s.cy], text: [s.label], textposition: "top right", marker: { size: 12, color, line: { color: COLORS.surface, width: 1.5 } }, textfont: { color, size: 12 } },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting state is read once per route / theme; playback paints through restyle
  }, [p, w, step, color, theme]);
  const layout = useMemo(
    () => ({
      xaxis: { title: "Across the aisles (m)", range: [ax.x0, ax.x1], zeroline: false },
      yaxis: { title: "Up the aisle (m)", range: [ax.y0, ax.y1], zeroline: false },
      showlegend: false,
      annotations: [{ x: 0, y: 0, xref: "x", yref: "y", text: "★ Depot (start and end)", showarrow: false, xanchor: "left", yanchor: "top", xshift: 8, yshift: -8, font: { size: 11, color: COLORS.text } }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ax, theme],
  );
  const paint = useCallback(
    (k) => {
      const f = Math.floor(k);
      if (!gd.current || f === lastF.current) return;
      lastF.current = f;
      const s = snap(f);
      Plotly.restyle(gd.current, { x: [s.vx, [s.cx]], y: [s.vy, [s.cy]], text: [[""], [s.label]] }, [1, 2]);
    },
    [snap],
  );
  useEffect(() => {
    sim.subs.add(paint);
    return () => sim.subs.delete(paint);
  }, [sim, paint]);
  const onInit = useCallback(
    (el) => {
      gd.current = el;
      lastF.current = -1;
      paint(sim.k); // a chart created mid-playback (after switching modes) catches up
    },
    [paint, sim],
  );
  return (
    <Plot
      height={400}
      compactHeight={330}
      data={data}
      layout={layout}
      onInit={onInit}
      reveal="none"
      summary={`Route of one picker for order ${orderId} on the ${LABEL[p.policy]} layout, ${ROUTING.find((r) => r.value === routing).label}. It starts and ends at the depot and walks ${fmt(w.total, 0)} metres.`}
    />
  );
});

export default function PickPath({ run }) {
  const theme = useTheme();
  const st = useApi(`/api/runs/${run.id}/paths`);
  const [oid, setOid] = useState(null);
  const [routing, setRouting] = useState("return");
  const [mode, setMode] = useState("2d");
  const [speed, setSpeed] = useState("1");
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const sim = useRef({ k: 0, subs: new Set() }).current; // shared playback clock: both modes read it
  const emit = useCallback(() => sim.subs.forEach((f) => f(sim.k)), [sim]);

  const fig = useMemo(() => {
    if (!st.data) return null;
    const orders = [...new Set(st.data.map((p) => p.order_id))];
    const cur = oid || orders[0];
    const sel = st.data.filter((p) => p.order_id === cur && p.routing === routing);
    const walkers = sel.map((p) => walker(p.points));
    const maxTotal = Math.max(...walkers.map((x) => x.total), 1);
    const step = Math.max(1, maxTotal / 160); // metres per animation frame
    const xs = sel.flatMap((p) => p.points.map((q) => q[0]));
    const ys = sel.flatMap((p) => p.points.map((q) => q[1]));
    const ax = sel.length ? { x0: -Math.max(1, Math.max(...xs) * 0.06), x1: Math.max(...xs) * 1.06 + 1, y0: -Math.max(2, Math.max(...ys) * 0.08), y1: Math.max(...ys) * 1.1 + 1 } : null;
    return { orders, cur, sel, walkers, step, nFrames: Math.ceil(maxTotal / step), lines: sel[0]?.lines, ax };
  }, [st.data, oid, routing]);

  // A new order, routing policy or data set starts the playback over, so no stale route stays on screen.
  useEffect(() => {
    sim.k = 0;
    setPlaying(false);
    setFrame(0);
    sim.subs.forEach((f) => f(0));
  }, [oid, routing, st.data, sim]);

  // The one playback loop. Both modes are painted from sim.k; it is cancelled when paused, when the inputs change and on unmount.
  useEffect(() => {
    if (!playing || !fig) return undefined;
    if (sim.k >= fig.nFrames) {
      sim.k = 0;
      emit();
    }
    let raf = 0;
    let last = performance.now();
    let lastSet = 0;
    const tick = (now) => {
      sim.k = Math.min(fig.nFrames, sim.k + (now - last) / SPEED_MS[speed]);
      last = now;
      emit();
      const done = sim.k >= fig.nFrames;
      if (done || now - lastSet > 100) {
        lastSet = now;
        setFrame(Math.floor(sim.k));
      }
      if (done) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, fig, sim, emit]);

  const play = () => setPlaying(true);
  const pause = () => setPlaying(false);
  const reset = () => {
    sim.k = 0;
    emit();
    setFrame(0);
    setPlaying(false);
  };

  return (
    <Async state={st} skeleton="page" label="the pick paths">
      {(paths) => {
        if (!fig.sel.length) return <Note kind="warn">No walk is stored for this order and routing policy.</Note>;
        const base = fig.sel.find((p) => p.policy === "B0_random");
        const pct = fig.nFrames ? Math.min(100, Math.round((frame / fig.nFrames) * 100)) : 0;
        const status = playing ? "Playing" : pct >= 100 ? "Finished" : pct === 0 ? "Ready" : "Paused";
        const walked = (i) => Math.min(frame * fig.step, fig.walkers[i].total);
        return (
          <div className="stack">
            <Panel title="Pick path simulation" subtitle="Choose an order from the held-out period, then watch three pickers walk it, one on each layout: as three plots in 2D, or inside the 3D warehouse. Both use the same walks and the same playback." icon={Route}>
              <div className="toolbar">
                <Select
                  label="Customer order"
                  value={fig.cur}
                  onChange={setOid}
                  options={fig.orders.map((o) => ({ value: o, label: `${o} (${paths.find((p) => p.order_id === o).lines} lines)` }))}
                  hint="A sample of orders the layouts never saw."
                />
                <Select label="Walking route" value={routing} onChange={setRouting} options={ROUTING} hint={ROUTING_HINT[routing]} />
                <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
                  <span className="field-label">Mode</span>
                  <Segmented label="Simulation mode" value={mode} onChange={setMode} options={MODES} />
                </div>
                <div className="field" style={{ maxWidth: "100%", flex: "0 1 auto" }}>
                  <span className="field-label">Speed</span>
                  <Segmented label="Playback speed" value={speed} onChange={setSpeed} options={[{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }]} />
                </div>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={play} disabled={playing} aria-label="Play simulation">
                  <Play size={16} aria-hidden="true" /> {pct >= 100 ? "Play again" : "Play"}
                </button>
                <button className="btn" onClick={pause} disabled={!playing} aria-label="Pause simulation">
                  <Pause size={16} aria-hidden="true" /> Pause
                </button>
                <button className="btn" onClick={reset} aria-label="Reset the simulation to the start">
                  <RotateCcw size={16} aria-hidden="true" /> Reset
                </button>
                <div style={{ flex: "1 1 200px", minWidth: 160 }}>
                  <div className="progress" role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted mono-id" style={{ fontSize: 12, marginTop: 4 }}>
                    {status} · {pct}% of the longest route
                  </div>
                </div>
              </div>
            </Panel>

            <div className="legend-cards">
              {fig.sel.map((p) => (
                <div className="legend-card" key={p.policy} style={{ "--c": POLICY_COLORS[p.policy] }}>
                  <div className="lc-name">{LABEL[p.policy]}</div>
                  <div className="lc-value">{fmt(p.dist, 0)} m</div>
                  <div className="lc-sub">
                    {p.policy === "B0_random" || !base
                      ? "Total walked for this order"
                      : `${fmt(Math.abs(base.dist - p.dist), 0)} m ${p.dist <= base.dist ? "shorter" : "longer"} than random (${fmt(Math.abs((1 - p.dist / base.dist) * 100), 0)}%)`}
                  </div>
                </div>
              ))}
            </div>

            {mode === "2d" && (
              <div className="paths-grid">
                {fig.sel.map((p, i) => (
                  <Panel
                    key={p.policy}
                    title={LABEL[p.policy]}
                    icon={Route}
                    subtitle={frame === 0 ? `Route: ${fmt(fig.walkers[i].total, 0)} m` : walked(i) >= fig.walkers[i].total ? `Done: ${fmt(fig.walkers[i].total, 0)} m` : `Walked ${fmt(walked(i), 0)} of ${fmt(fig.walkers[i].total, 0)} m`}
                    actions={
                      <span className="path-dist num" style={{ color: POLICY_COLORS[p.policy] }}>
                        {fmt(p.dist, 0)} m
                      </span>
                    }
                  >
                    <WalkPlot key={`${fig.cur}-${routing}-${p.policy}`} p={p} w={fig.walkers[i]} step={fig.step} ax={fig.ax} color={POLICY_COLORS[p.policy]} orderId={fig.cur} routing={routing} sim={sim} theme={theme} />
                  </Panel>
                ))}
              </div>
            )}
            {mode === "3d" && (
              <Panel title="The three walks in the warehouse" subtitle={`Order ${fig.cur} · ${fig.lines} product lines · ${ROUTING.find((r) => r.value === routing).label}`} icon={Box}>
                <Safe>
                  <Suspense fallback={<Skeleton variant="chart" label="the 3D simulation" />}>
                    <PickPath3D config={run.config} walks={fig.sel.map((p, i) => ({ policy: p.policy, points: p.points, dist: p.dist, total: fig.walkers[i].total }))} step={fig.step} sim={sim} />
                  </Suspense>
                </Safe>
              </Panel>
            )}
            <Note>
              <CheckCircle2 size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {mode === "2d"
                ? "The same held-out order on three layouts, on the same axes so lengths compare directly. The faint line is the whole route, the solid line what has been walked, the dot the picker; numbers mark the far ends in the order they are reached. A picker that finishes first stops at the depot and shows its total."
                : "The same walks and the same playback, inside the 3D warehouse: faint ribbons are the whole routes, solid ribbons what has been walked, spheres the pickers, and the markers at the far ends light up as each picker reaches them. The layouts never saw this order when they were built."}
            </Note>
          </div>
        );
      }}
    </Async>
  );
}
