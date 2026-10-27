import { useMemo, useState } from "react";
import { Async, LABEL, LADDER, Note, Plot, useApi } from "../ui.jsx";
import Explain from "./Explain.jsx";

function Heat({ run, policy, level }) {
  const st = useApi(`/api/runs/${run.id}/layout?policy=${policy}`);
  return (
    <Async state={st}>
      {(rows) => {
        const { aisles, bays } = run.summary.grid;
        const z = Array.from({ length: bays }, () => Array(aisles * 2).fill(0));
        const txt = Array.from({ length: bays }, () => Array(aisles * 2).fill(""));
        rows.forEach((r) => {
          if (level !== "all" && r.level !== Number(level)) return;
          z[r.bay][r.aisle * 2 + r.side] += r.velocity;
        });
        const zl = z.map((row) => row.map((v) => Math.log1p(v)));
        z.forEach((row, i) => row.forEach((v, j) => (txt[i][j] = `${Math.round(v)} pick lines`)));
        return (
          <Plot
            height={440}
            data={[
              {
                type: "heatmap",
                z: zl,
                text: txt,
                hovertemplate: "aisle col %{x}, bay %{y}<br>%{text}<extra></extra>",
                colorscale: "Viridis",
                colorbar: { title: { text: "log(1+picks)" }, thickness: 12 },
              },
            ]}
            layout={{
              title: { text: LABEL[policy], font: { size: 14 } },
              xaxis: { title: "aisle column (2 sides per aisle)" },
              yaxis: { title: "bay (0 = nearest the depot)" },
              margin: { l: 56, r: 8, t: 36, b: 48 },
            }}
          />
        );
      }}
    </Async>
  );
}

function Elevation({ run, policy }) {
  const st = useApi(`/api/runs/${run.id}/layout?policy=${policy}`);
  const [aisle, setAisle] = useState(0);
  const [side, setSide] = useState(0);
  return (
    <Async state={st}>
      {(rows) => {
        const { aisles, bays } = run.summary.grid;
        const sel = rows.filter((r) => r.aisle === aisle && r.side === side);
        const z = Array.from({ length: 5 }, () => Array(bays).fill(0));
        const txt = Array.from({ length: 5 }, () => Array(bays).fill("empty"));
        sel.forEach((r) => {
          z[r.level - 1][r.bay] += r.velocity;
          txt[r.level - 1][r.bay] = (txt[r.level - 1][r.bay] === "empty" ? "" : txt[r.level - 1][r.bay] + "<br>") +
            `${r.sku} · ${r.category} · class ${r.abc}${r.hazard !== "none" ? " · " + r.hazard : ""}`;
        });
        return (
          <>
            <div className="controls">
              <label>
                Aisle
                <select value={aisle} onChange={(e) => setAisle(Number(e.target.value))}>
                  {Array.from({ length: aisles }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                      {i === aisles - 1 ? " (hazard cage)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Side
                <select value={side} onChange={(e) => setSide(Number(e.target.value))}>
                  <option value={0}>left</option>
                  <option value={1}>right</option>
                </select>
              </label>
              <span>Rack elevation: bays across, shelf levels up. Levels 3 and 4 are the golden zone.</span>
            </div>
            <Plot
              height={300}
              data={[
                {
                  type: "heatmap",
                  z: z.map((r) => r.map((v) => Math.log1p(v))),
                  text: txt,
                  hovertemplate: "bay %{x}, level %{y}<br>%{text}<extra></extra>",
                  colorscale: "Viridis",
                  showscale: false,
                  ygap: 2,
                  xgap: 2,
                },
              ]}
              layout={{
                xaxis: { title: "bay" },
                yaxis: { title: "shelf level", tickvals: [0, 1, 2, 3, 4], ticktext: ["1", "2", "3", "4", "5"] },
                shapes: [{ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1.5, y1: 3.5, line: { color: "#34d399", width: 2, dash: "dot" } }],
                margin: { l: 56, r: 8, t: 8, b: 48 },
              }}
            />
          </>
        );
      }}
    </Async>
  );
}

export default function Layout({ run }) {
  const [a, setA] = useState("B0_random");
  const [b, setB] = useState(run.summary.headline);
  const [level, setLevel] = useState("all");
  const opts = useMemo(() => LADDER.map((p) => <option key={p} value={p}>{LABEL[p]}</option>), []);
  return (
    <>
      <div className="controls">
        <label>
          Left
          <select value={a} onChange={(e) => setA(e.target.value)}>{opts}</select>
        </label>
        <label>
          Right
          <select value={b} onChange={(e) => setB(e.target.value)}>{opts}</select>
        </label>
        <label>
          Shelf level
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">all levels</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                level {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="controls">
        <a className="btn" href={`/api/runs/${run.id}/moves?from=${a}&to=${b}`} download>
          Download move list ({LABEL[a]} → {LABEL[b]})
        </a>
        <a className="btn" href={`/api/runs/${run.id}/assignment?policy=${b}`} download>
          Download assignment ({LABEL[b]})
        </a>
        <span>CSV, fastest-moving SKUs first. Rules are re-checked before a run can be stored.</span>
      </div>
      <div className="grid two">
        <div className="panel"><Heat run={run} policy={a} level={level} /></div>
        <div className="panel"><Heat run={run} policy={b} level={level} /></div>
      </div>
      <Note>Brighter means more demand stored in that rack face (log scale). A good layout glows near the depot, bottom-left, and in the golden-zone levels.</Note>
      <div className="panel">
        <h2>Rack elevation: {LABEL[b]}</h2>
        <Elevation run={run} policy={b} />
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Why is this SKU here? ({LABEL.Full})</h2>
        <Explain run={run} policy="Full" />
      </div>
    </>
  );
}
