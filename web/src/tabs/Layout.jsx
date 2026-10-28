import { Component, Suspense, lazy, useMemo, useState } from "react";
import { Cuboid, Download, Grid3x3, Layers, Search, Warehouse } from "lucide-react";
import { Async, EmptyState, LABEL, LADDER, Note, Panel, Plot, Segmented, Select, Skeleton, combine, useApi } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";
import Explain from "./Explain.jsx";

const Warehouse3D = lazy(() => import("../components/Warehouse3D.jsx"));

class Safe extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState icon={Cuboid} title="The 3D view could not start">
        Your browser could not render the 3D scene. The heatmaps and the rack elevation show the same layout in 2D.
      </EmptyState>
    );
  }
}

/** Pick lines stored in each rack face (aisle column x bay), optionally for one shelf level. */
function faceGrid(rows, level, aisles, bays) {
  const z = Array.from({ length: bays }, () => Array(aisles * 2).fill(0));
  rows.forEach((r) => {
    if (level !== "all" && r.level !== Number(level)) return;
    z[r.bay][r.aisle * 2 + r.side] += r.velocity;
  });
  return z;
}

function Heat({ title, z, zmax }) {
  const zl = z.map((row) => row.map((v) => Math.log1p(v)));
  const txt = z.map((row) => row.map((v) => `${Math.round(v)} pick lines`));
  return (
    <Plot
      height={440}
      compactHeight={360}
      summary={`Top-down heatmap of demand stored in each rack face for the ${title} layout. Brighter means more pick lines.`}
      data={[
        {
          type: "heatmap",
          z: zl,
          text: txt,
          zmin: 0,
          zmax,
          hovertemplate: "aisle col %{x}, bay %{y}<br>%{text}<extra></extra>",
          colorscale: "Viridis",
          colorbar: { title: { text: "log(1+picks)" }, thickness: 12 },
        },
      ]}
      layout={{ xaxis: { title: "aisle column (2 sides per aisle)" }, yaxis: { title: "bay (0 = nearest the depot)" } }}
    />
  );
}

function Elevation({ rows, grid, aisle, setAisle, side, setSide }) {
  const { aisles, bays } = grid;
  const sel = rows.filter((r) => r.aisle === aisle && r.side === side);
  const z = Array.from({ length: 5 }, () => Array(bays).fill(0));
  const txt = Array.from({ length: 5 }, () => Array(bays).fill("empty"));
  sel.forEach((r) => {
    z[r.level - 1][r.bay] += r.velocity;
    txt[r.level - 1][r.bay] =
      (txt[r.level - 1][r.bay] === "empty" ? "" : txt[r.level - 1][r.bay] + "<br>") + `${r.sku} · ${r.category} · class ${r.abc}${r.hazard !== "none" ? " · " + r.hazard : ""}`;
  });
  return (
    <div className="stack">
      <div className="toolbar">
        <Select
          label="Aisle"
          value={aisle}
          onChange={(v) => setAisle(Number(v))}
          options={Array.from({ length: aisles }, (_, i) => ({ value: i, label: `${i}${i === aisles - 1 ? " (hazard cage)" : ""}` }))}
        />
        <div className="field">
          <span className="field-label" id="side-label">
            Side
          </span>
          <Segmented label="Side of the aisle" value={side} onChange={(v) => setSide(Number(v))} options={[{ value: 0, label: "Left" }, { value: 1, label: "Right" }]} />
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        A side view of one rack: bays across, shelf levels up. The dotted green band is the golden zone (levels 3 and 4, chest-to-waist height), where fast movers are easiest to pick. Hover a cell for its products.
      </p>
      <Plot
        height={320}
        compactHeight={280}
        summary={`Rack elevation for aisle ${aisle}, ${side === 0 ? "left" : "right"} side: demand stored on each shelf level in each bay.`}
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
          shapes: [{ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1.5, y1: 3.5, fillcolor: "rgba(52,211,153,0.07)", line: { color: COLORS.good, width: 2, dash: "dot" } }],
          annotations: [{ xref: "paper", x: 1, yref: "y", y: 3.5, text: "golden zone", showarrow: false, xanchor: "right", yanchor: "bottom", font: { color: COLORS.good, size: 11 } }],
        }}
      />
    </div>
  );
}

export default function Layout({ run }) {
  const [a, setA] = useState("B0_random");
  const [b, setB] = useState(run.summary.headline);
  const [level, setLevel] = useState("all");
  const [aisle, setAisle] = useState(0);
  const [side, setSide] = useState(0);
  const [open3d, setOpen3d] = useState(false);
  const [which3d, setWhich3d] = useState("b");
  const [focusAisle, setFocusAisle] = useState(false);

  // One request per distinct layout (max three), reusing results instead of fetching the same layout twice.
  const path = (p) => `/api/runs/${run.id}/layout?policy=${p}`;
  const sA = useApi(path(a));
  const sB = useApi(b === a ? null : path(b));
  const sF = useApi(a !== "Full" && b !== "Full" ? path("Full") : null);
  const stateB = b === a ? sA : sB;
  const stateFull = a === "Full" ? sA : b === "Full" ? stateB : sF;
  const pair = combine(sA, stateB);

  const options = useMemo(() => LADDER.map((p) => ({ value: p, label: LABEL[p] })), []);
  const levelOptions = [{ value: "all", label: "All" }, ...[1, 2, 3, 4, 5].map((l) => ({ value: l, label: String(l) }))];
  const grid = run.summary.grid;

  return (
    <div className="stack">
      <Panel
        title="Compare layouts"
        subtitle="Pick the layout you compare against and the layout you propose. Both heatmaps use the same colour scale, so the same colour means the same amount of demand."
        icon={Warehouse}
      >
        <div className="toolbar">
          <Select label="Baseline layout" value={a} onChange={setA} options={options} hint="Where products sit today (default: random)." />
          <Select label="Proposed layout" value={b} onChange={setB} options={options} hint="Where the optimizer would put them." />
          <div className="field" style={{ maxWidth: "none" }}>
            <span className="field-label">Shelf level</span>
            <Segmented label="Shelf level" value={level} onChange={setLevel} options={levelOptions} />
          </div>
        </div>
        <div className="btn-row">
          <a className="btn" href={`/api/runs/${run.id}/moves?from=${a}&to=${b}`} download>
            <Download size={16} aria-hidden="true" /> Download move list (CSV)
          </a>
          <a className="btn" href={`/api/runs/${run.id}/assignment?policy=${b}`} download>
            <Download size={16} aria-hidden="true" /> Download assignment (CSV)
          </a>
          <span className="muted" style={{ fontSize: 13 }}>
            Move list: {LABEL[a]} → {LABEL[b]}, fastest-moving SKUs first. Rules are re-checked before a run can be stored.
          </span>
        </div>
      </Panel>

      <Async state={pair} skeleton="chart" label="the layouts">
        {([rowsA, rowsB]) => {
          const zA = faceGrid(rowsA, level, grid.aisles, grid.bays);
          const zB = faceGrid(rowsB, level, grid.aisles, grid.bays);
          const zmax = Math.log1p(Math.max(1, ...zA.flat(), ...zB.flat()));
          const rows3d = which3d === "a" ? rowsA : rowsB;
          return (
            <>
              <div className="grid-2">
                <Panel title={`Baseline: ${LABEL[a]}`} icon={Grid3x3}>
                  <Heat title={LABEL[a]} z={zA} zmax={zmax} />
                </Panel>
                <Panel title={`Proposed: ${LABEL[b]}`} icon={Grid3x3}>
                  <Heat title={LABEL[b]} z={zB} zmax={zmax} />
                </Panel>
              </div>
              <Note>Brighter means more demand stored in that rack face (log scale, shared by both heatmaps). A good layout glows near the depot, bottom-left, and in the golden-zone levels.</Note>

              <Panel title={`Rack elevation: ${LABEL[b]}`} icon={Layers}>
                <Elevation rows={rowsB} grid={grid} aisle={aisle} setAisle={setAisle} side={side} setSide={setSide} />
              </Panel>

              <Panel
                title="3D warehouse"
                subtitle="The same stored layout as an interactive 3D model: every box is a real bin, brighter boxes hold faster-moving products. It loads only when you open it."
                icon={Cuboid}
                actions={
                  open3d ? (
                    <button className="btn small" onClick={() => setOpen3d(false)}>
                      Close 3D view
                    </button>
                  ) : (
                    <button className="btn primary small" onClick={() => setOpen3d(true)}>
                      <Cuboid size={16} aria-hidden="true" /> Open 3D view
                    </button>
                  )
                }
              >
                {open3d ? (
                  <div className="stack">
                    <div className="btn-row">
                      <Segmented label="Layout shown in 3D" value={which3d} onChange={setWhich3d} options={[{ value: "a", label: "Baseline" }, { value: "b", label: "Proposed" }]} />
                      <Segmented
                        label="Highlight an aisle"
                        value={focusAisle ? "on" : "off"}
                        onChange={(v) => setFocusAisle(v === "on")}
                        options={[{ value: "off", label: "All aisles" }, { value: "on", label: `Highlight aisle ${aisle}` }]}
                      />
                      <span className="muted" style={{ fontSize: 13 }}>
                        Shelf level filter above applies here too. Choose the aisle in the rack elevation.
                      </span>
                    </div>
                    <Safe>
                      <Suspense fallback={<Skeleton variant="chart" label="the 3D view" />}>
                        <Warehouse3D rows={rows3d} grid={grid} config={run.config} nBins={run.summary.n_bins} level={level} highlightAisle={focusAisle ? aisle : null} />
                      </Suspense>
                    </Safe>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    Optional. Open it to rotate and zoom the warehouse, or hover any bin to see its product.
                  </p>
                )}
              </Panel>
            </>
          );
        }}
      </Async>

      <Panel title="Why is this SKU here?" subtitle={`Inspect one product in the ${LABEL.Full} layout: where it sits, what it cost, and the next-best bins.`} icon={Search}>
        <Async state={stateFull} skeleton="chart" label="the SKU list">
          {(rowsFull) => <Explain run={run} rows={rowsFull} />}
        </Async>
      </Panel>
    </div>
  );
}
