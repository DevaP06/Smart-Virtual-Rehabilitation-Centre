import { useMemo, useState } from "react";
import { Async, LABEL, Note, Plot, fmt, useApi } from "../ui.jsx";

const OFFSET = { B0_random: -0.12, B2_abc: 0, Full: 0.12 };
const COLORS = { B0_random: "#f87171", B2_abc: "#fbbf24", Full: "#38bdf8" };

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

export default function PickPath({ run }) {
  const st = useApi(`/api/runs/${run.id}/paths`);
  const [oid, setOid] = useState(null);
  const [routing, setRouting] = useState("return");

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
    const staticTraces = sel.map((p, i) => ({
      type: "scatter", mode: "lines", name: `${LABEL[p.policy]}: ${fmt(p.dist, 0)} m`,
      x: p.points.map((q) => q[0] + OFFSET[p.policy]), y: p.points.map((q) => q[1]),
      line: { color: COLORS[p.policy], width: 2 }, opacity: 0.45,
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
      return { type: "scatter", mode: "markers+text", showlegend: false, x: [x + OFFSET[p.policy]], y: [y], text: ["0 m"], textposition: "top right",
        marker: { size: 13, color: COLORS[p.policy], line: { color: "#f8fafc", width: 1 } }, textfont: { color: COLORS[p.policy] } };
    });
    const depot = { type: "scatter", mode: "markers", name: "Depot", x: [0], y: [0], marker: { size: 16, symbol: "star", color: "#f8fafc" } };
    return {
      orders, cur, lines: sel[0]?.lines,
      data: [...staticTraces, ...moving, depot],
      frames: Array.from({ length: n + 1 }, (_, k) => frameAt(k)),
    };
  }, [st.data, oid, routing]);

  return (
    <Async state={st}>
      {() => (
        <>
          <div className="controls">
            <label>
              Order
              <select value={fig.cur} onChange={(e) => setOid(e.target.value)}>
                {fig.orders.map((o) => (
                  <option key={o} value={o}>{o} ({st.data.find((p) => p.order_id === o).lines} lines)</option>
                ))}
              </select>
            </label>
            <label>
              Routing
              <select value={routing} onChange={(e) => setRouting(e.target.value)}>
                <option value="return">Return (front cross-aisle only)</option>
                <option value="s_shape">S-shape (rear cross-aisle)</option>
              </select>
            </label>
            <span>Press Play to watch the three pickers walk the same order.</span>
          </div>
          <div className="panel">
            <Plot
              key={`${fig.cur}-${routing}`}
              height={540}
              data={fig.data}
              frames={fig.frames}
              layout={{
                xaxis: { title: "x across aisles (m)" },
                yaxis: { title: "y up the aisle (m)" },
                updatemenus: [{
                  type: "buttons", direction: "left", x: 0, y: 1.12, xanchor: "left", pad: { t: 0, r: 8 },
                  buttons: [
                    { label: "▶ Play", method: "animate", args: [null, { frame: { duration: 45, redraw: false }, transition: { duration: 0 }, fromcurrent: true }] },
                    { label: "❚❚ Pause", method: "animate", args: [[null], { mode: "immediate", frame: { duration: 0, redraw: false }, transition: { duration: 0 } }] },
                    { label: "↺ Reset", method: "animate", args: [["0"], { mode: "immediate", frame: { duration: 0, redraw: false }, transition: { duration: 0 } }] },
                  ],
                  bgcolor: "#16223b", font: { color: "#e2e8f0" }, bordercolor: "#243453",
                }],
              }}
            />
          </div>
          <Note>
            The same order from the held-out period, walked on three layouts. Each route starts and ends at the depot (white star). A picker that finishes first stops at
            the depot and shows its total. The layouts never saw this order when they were built.
          </Note>
        </>
      )}
    </Async>
  );
}
