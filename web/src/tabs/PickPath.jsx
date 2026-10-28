import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Pause, Play, RotateCcw, Route } from "lucide-react";
import { Async, LABEL, Note, Panel, Plot, Plotly, Segmented, Select, fmt, useApi } from "../ui.jsx";
import { COLORS, POLICY_COLORS } from "../chartTheme.js";

const OFFSET = { B0_random: -0.12, B2_abc: 0, Full: 0.12 };
const COLORS_BY_POLICY = POLICY_COLORS;
const ROUTING = [
  { value: "return", label: "Return route (front cross-aisle only)" },
  { value: "s_shape", label: "S-shape (rear cross-aisle)" },
];
const ROUTING_HINT = {
  return: "The picker walks into each aisle as far as the deepest item needs, then back out.",
  s_shape: "The picker walks each needed aisle end to end, alternating direction, using a rear walkway.",
};
const SPEED_MS = { 0.5: 90, 1: 45, 2: 22 };
const INSTANT = { mode: "immediate", frame: { duration: 0, redraw: false }, transition: { duration: 0 } };

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

const ROUTE_LAYOUT = {
  xaxis: { title: "Distance across the aisles (m)" },
  yaxis: { title: "Distance up the aisle (m)" },
  showlegend: false,
};

// Memoised so the frequent progress updates never re-render (and re-initialise) the animated chart.
const RouteChart = memo(function RouteChart({ data, frames, summary, onInit }) {
  return <Plot height={540} compactHeight={430} summary={summary} data={data} frames={frames} onInit={onInit} layout={ROUTE_LAYOUT} />;
});

export default function PickPath({ run }) {
  const st = useApi(`/api/runs/${run.id}/paths`);
  const [oid, setOid] = useState(null);
  const [routing, setRouting] = useState("return");
  const [speed, setSpeed] = useState("1");
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const gd = useRef(null);
  const frameRef = useRef(0);

  const fig = useMemo(() => {
    if (!st.data) return null;
    const orders = [...new Set(st.data.map((p) => p.order_id))];
    const cur = oid || orders[0];
    const sel = st.data.filter((p) => p.order_id === cur && p.routing === routing);
    const walkers = sel.map((p) => walker(p.points));
    const maxTotal = Math.max(...walkers.map((w) => w.total), 1);
    const step = Math.max(1, maxTotal / 160);
    const n = Math.ceil(maxTotal / step);
    const nStatic = sel.length;
    const staticTraces = sel.map((p) => ({
      type: "scatter", mode: "lines", name: `${LABEL[p.policy]}: ${fmt(p.dist, 0)} m`, showlegend: false,
      x: p.points.map((q) => q[0] + OFFSET[p.policy]), y: p.points.map((q) => q[1]),
      line: { color: COLORS_BY_POLICY[p.policy], width: 3 }, opacity: 0.62, hoverinfo: "skip",
    }));
    const frameAt = (k) => ({
      name: String(k),
      traces: sel.map((_, i) => nStatic + i),
      data: sel.map((p, i) => {
        const d = Math.min(k * step, walkers[i].total);
        const [x, y] = walkers[i].at(d);
        return { x: [x + OFFSET[p.policy]], y: [y], text: [d >= walkers[i].total ? `done: ${fmt(walkers[i].total, 0)} m` : `${fmt(d, 0)} m`] };
      }),
    });
    const moving = sel.map((p, i) => {
      const [x, y] = walkers[i].at(0);
      return {
        type: "scatter", mode: "markers+text", showlegend: false, x: [x + OFFSET[p.policy]], y: [y], text: ["0 m"], textposition: "top right", hoverinfo: "skip",
        marker: { size: 13, color: COLORS_BY_POLICY[p.policy], line: { color: "#f8fafc", width: 1 } }, textfont: { color: COLORS_BY_POLICY[p.policy], size: 12 },
      };
    });
    const depot = { type: "scatter", mode: "markers+text", name: "Depot", showlegend: false, x: [0], y: [0], text: ["Depot"], textposition: "bottom right", textfont: { color: "#f8fafc", size: 11 }, marker: { size: 16, symbol: "star", color: "#f8fafc" }, hoverinfo: "skip" };
    return { orders, cur, sel, lines: sel[0]?.lines, nFrames: n, data: [...staticTraces, ...moving, depot], frames: Array.from({ length: n + 1 }, (_, k) => frameAt(k)) };
  }, [st.data, oid, routing]);

  // A new order or routing policy rebuilds the chart; start the progress display over.
  useEffect(() => {
    frameRef.current = 0;
    setFrame(0);
    setPlaying(false);
  }, [oid, routing, st.data]);

  const onInit = useCallback((el) => {
    gd.current = el;
    el.on("plotly_animatingframe", (ev) => {
      const k = Number(ev?.name);
      if (!Number.isNaN(k)) {
        frameRef.current = k;
        setFrame(k);
        setPlaying(true);
      }
    });
    el.on("plotly_animated", () => setPlaying(false));
    el.on("plotly_animationinterrupted", () => setPlaying(false));
  }, []);
  // Plotly rejects an animate() promise when another call interrupts it (that is how Pause works); ignore that.
  const animate = (frames, opts) => gd.current && Promise.resolve(Plotly.animate(gd.current, frames, opts)).catch(() => {});
  const run_ = (ms) => animate(null, { frame: { duration: ms, redraw: false }, transition: { duration: 0 }, fromcurrent: true, mode: "immediate" });
  const play = () => {
    if (!gd.current) return;
    if (frameRef.current >= (fig?.nFrames ?? 0)) {
      animate(["0"], INSTANT);
      frameRef.current = 0;
      setFrame(0);
    }
    run_(SPEED_MS[speed]);
  };
  const pause = () => {
    animate([null], INSTANT);
    setPlaying(false);
  };
  const reset = () => {
    animate(["0"], INSTANT);
    frameRef.current = 0;
    setFrame(0);
    setPlaying(false);
  };
  const changeSpeed = (v) => {
    setSpeed(v);
    if (playing) run_(SPEED_MS[v]); // keep playing at the new speed
  };

  return (
    <Async state={st} skeleton="page" label="the pick paths">
      {(paths) => {
        const base = fig.sel.find((p) => p.policy === "B0_random");
        const pct = fig.nFrames ? Math.round((frame / fig.nFrames) * 100) : 0;
        return (
          <div className="stack">
            <Panel title="Simulation controls" subtitle="Choose an order from the held-out period, then press Play to watch three pickers walk it, one on each layout." icon={Route}>
              <div className="toolbar">
                <Select
                  label="Customer order"
                  value={fig.cur}
                  onChange={setOid}
                  options={fig.orders.map((o) => ({ value: o, label: `${o} (${paths.find((p) => p.order_id === o).lines} lines)` }))}
                  hint="A sample of orders the layouts never saw."
                />
                <Select label="Walking route" value={routing} onChange={setRouting} options={ROUTING} hint={ROUTING_HINT[routing]} />
                <div className="field" style={{ maxWidth: "none" }}>
                  <span className="field-label">Speed</span>
                  <Segmented label="Playback speed" value={speed} onChange={changeSpeed} options={[{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }]} />
                </div>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={play} disabled={playing} aria-label="Play animation">
                  <Play size={16} aria-hidden="true" /> Play
                </button>
                <button className="btn" onClick={pause} disabled={!playing} aria-label="Pause animation">
                  <Pause size={16} aria-hidden="true" /> Pause
                </button>
                <button className="btn" onClick={reset} aria-label="Reset animation to the start">
                  <RotateCcw size={16} aria-hidden="true" /> Reset
                </button>
                <div style={{ flex: "1 1 200px", minWidth: 160 }}>
                  <div className="progress" role="progressbar" aria-label="Animation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {playing ? "Playing" : pct >= 100 ? "Finished" : pct === 0 ? "Ready" : "Paused"} · {pct}% of the longest route
                  </div>
                </div>
              </div>
            </Panel>

            <div className="legend-cards">
              {fig.sel.map((p) => (
                <div className="legend-card" key={p.policy} style={{ "--c": COLORS_BY_POLICY[p.policy] }}>
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

            <Panel title="The three walks" subtitle={`Order ${fig.cur} · ${fig.lines} product lines · ${ROUTING.find((r) => r.value === routing).label}`} icon={Route}>
              <RouteChart
                key={`${fig.cur}-${routing}`}
                summary={`Map of three pickers' routes for order ${fig.cur}, one per layout, each starting and ending at the depot. ${fig.sel.map((p) => `${LABEL[p.policy]} walks ${fmt(p.dist, 0)} metres`).join("; ")}.`}
                data={fig.data}
                frames={fig.frames}
                onInit={onInit}
              />
              <div style={{ marginTop: 14 }}>
                <ul className="help-list">
                  <li>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>Each coloured line is the route one picker walks to collect every item in this order and return to the depot (white star).</span>
                  </li>
                  <li>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>Vertical stretches are aisles; the horizontal line along the bottom is the walkway between aisles. A shorter line means less walking.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>This order comes from the held-out period, so the layouts never saw it when they were built. One order is an example, not an average: see the Results page for the average.</span>
                  </li>
                </ul>
              </div>
            </Panel>
            <Note>
              The same order from the held-out period, walked on three layouts. Each route starts and ends at the depot (white star). A picker that finishes first stops at the depot and shows its total. The layouts
              never saw this order when they were built.
            </Note>
          </div>
        );
      }}
    </Async>
  );
}
