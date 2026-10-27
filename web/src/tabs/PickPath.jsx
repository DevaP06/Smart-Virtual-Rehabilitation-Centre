import { useState } from "react";
import { Async, LABEL, Note, Plot, fmt, useApi } from "../ui.jsx";

const OFFSET = { B0_random: -0.12, B2_abc: 0, Full: 0.12 };
const COLORS = { B0_random: "#f87171", B2_abc: "#fbbf24", Full: "#38bdf8" };

export default function PickPath({ run }) {
  const st = useApi(`/api/runs/${run.id}/paths`);
  const [oid, setOid] = useState(null);
  const [routing, setRouting] = useState("return");
  return (
    <Async state={st}>
      {(paths) => {
        const orders = [...new Set(paths.map((p) => p.order_id))];
        const cur = oid || orders[0];
        const sel = paths.filter((p) => p.order_id === cur && p.routing === routing);
        return (
          <>
            <div className="controls">
              <label>
                Order
                <select value={cur} onChange={(e) => setOid(e.target.value)}>
                  {orders.map((o) => (
                    <option key={o} value={o}>
                      {o} ({paths.find((p) => p.order_id === o).lines} lines)
                    </option>
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
            </div>
            <div className="panel">
              <Plot
                height={520}
                data={[
                  ...sel.map((p) => ({
                    type: "scatter",
                    mode: "lines+markers",
                    name: `${LABEL[p.policy]}: ${fmt(p.dist, 0)} m`,
                    x: p.points.map((q) => q[0] + OFFSET[p.policy]),  // small display offset so overlapping routes stay visible
                    y: p.points.map((q) => q[1]),
                    line: { color: COLORS[p.policy], width: 3 },
                    marker: { size: 5 },
                  })),
                  { type: "scatter", mode: "markers", name: "Depot", x: [0], y: [0], marker: { size: 16, symbol: "star", color: "#f8fafc" } },
                ]}
                layout={{ xaxis: { title: "x across aisles (m)" }, yaxis: { title: "y up the aisle (m)" } }}
              />
            </div>
            <Note>
              The same order walked on three layouts. Each route starts and ends at the depot (white star). Shorter lines mean less walking. The order is from the
              held-out period, so the layouts never saw it.
            </Note>
          </>
        );
      }}
    </Async>
  );
}
