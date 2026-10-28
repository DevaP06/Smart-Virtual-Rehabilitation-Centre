import { Component, Suspense, lazy, useMemo, useState } from "react";
import { Bell, Boxes, ClipboardList, Cuboid, FlaskConical, Layers, PackageCheck, PackageMinus, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Card, Chip, EmptyState, Note, Panel, Plot, Segmented, Skeleton } from "../ui.jsx";
import { ActionError, LiveAsync, NoWarehouse, STATUS_LABEL, STATUS_TONE, WarehouseBar, ago, call, nf, useAction, useLive, useNow, useWarehouseId, withWh } from "../live/common.jsx";

const LiveWarehouse3D = lazy(() => import("../components/LiveWarehouse3D.jsx"));

class Safe extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState icon={Cuboid} title="The 3D view could not start">
        Your browser could not render the 3D scene. Switch to the 2D map: it shows the same live status.
      </EmptyState>
    );
  }
}

const MODES = [
  { value: "fill", label: "Stock level" },
  { value: "demand", label: "Demand" },
  { value: "low", label: "Low stock" },
  { value: "tasks", label: "Work orders" },
];
const MODE_HELP = {
  fill: "Each box is a pick face. Green is stocked, amber is low and due a refill, red is empty.",
  demand: "Brighter boxes are the products picked most in the recent weeks.",
  low: "Only pick faces that are low or empty stand out.",
  tasks: "Pick faces with an open refill (cyan) or move (violet) work order stand out.",
};

/** The same live status as a top-down map of rack faces, for devices without WebGL and for a quick overview. */
function FloorMap({ bins, rows, mode, level }) {
  const { z, text, scale, zmax } = useMemo(() => {
    const byLoc = new Map(rows.map((r) => [r.loc, r]));
    const aisles = Math.max(...bins.map((b) => b.aisle)) + 1;
    const bays = Math.max(...bins.map((b) => b.bay)) + 1;
    const sum = Array.from({ length: bays }, () => Array(aisles * 2).fill(0));
    const n = Array.from({ length: bays }, () => Array(aisles * 2).fill(0));
    const metric = (r) => (mode === "demand" ? Math.log1p(r.vel) : mode === "low" ? (r.status === "empty" ? 2 : r.status === "low" ? 1 : 0) : mode === "tasks" ? (r.tasks.length ? 1 : 0) : r.status === "empty" ? 0 : Math.min(1, r.qty / Math.max(1, r.cap)));
    bins.forEach((b) => {
      const r = byLoc.get(b.loc);
      if (!r || (level !== "all" && b.level !== Number(level))) return;
      sum[b.bay][b.aisle * 2 + b.side] += metric(r);
      n[b.bay][b.aisle * 2 + b.side] += 1;
    });
    const z = sum.map((row, i) => row.map((v, j) => (n[i][j] ? v / n[i][j] : null)));
    const text = n.map((row) => row.map((c) => (c ? `${c} bins in use` : "no products")));
    const scales = {
      fill: [[0, "#fb7185"], [0.35, "#fbbf24"], [1, "#34d399"]],
      demand: "Viridis",
      low: [[0, "#243553"], [0.5, "#fbbf24"], [1, "#fb7185"]],
      tasks: [[0, "#243553"], [1, "#22d3ee"]],
    };
    return { z, text, scale: scales[mode], zmax: mode === "demand" ? Math.log1p(Math.max(1, ...rows.map((r) => r.vel))) : mode === "low" ? 2 : 1 };
  }, [bins, rows, mode, level]);
  return (
    <Plot
      height={460}
      compactHeight={360}
      summary="Top-down map of every rack face coloured by its live stock status. Rows are bays, columns are aisle sides."
      data={[{ type: "heatmap", z, text, zmin: 0, zmax, colorscale: scale, showscale: false, xgap: 1, ygap: 1, hovertemplate: "aisle column %{x}, bay %{y}<br>%{text}<extra></extra>" }]}
      layout={{ xaxis: { title: "aisle column (2 sides per aisle)" }, yaxis: { title: "bay (0 = nearest the depot)" } }}
    />
  );
}

function BinDetail({ r, onClose }) {
  if (!r) {
    return <p className="muted" style={{ margin: 0 }}>Click a box in the 3D view to see what is in that pick face.</p>;
  }
  return (
    <div className="stack">
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 16 }}>{r.sku}</h3>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      </div>
      <dl className="dl">
        <dt>Bin</dt>
        <dd>
          <code>{r.loc}</code>
        </dd>
        <dt>Category</dt>
        <dd>{r.category}</dd>
        <dt>Pick face</dt>
        <dd>
          {nf(r.qty)} of {nf(r.cap)} units
        </dd>
        <dt>Reserve</dt>
        <dd>{nf(r.reserve)} units</dd>
        <dt>Recent demand</dt>
        <dd>{nf(r.vel)} pick lines (class {r.abc})</dd>
        <dt>Open work</dt>
        <dd>{r.tasks.length ? r.tasks.map((t) => (t === "move" ? "move to a better bin" : "refill from reserve")).join(", ") : "none"}</dd>
      </dl>
      <div className="fillbar" role="img" aria-label={`Pick face ${Math.round((100 * r.qty) / Math.max(1, r.cap))}% full`}>
        <div style={{ width: `${Math.min(100, (100 * r.qty) / Math.max(1, r.cap))}%` }} data-status={r.status} />
      </div>
      <button className="btn small" onClick={onClose}>
        Clear selection
      </button>
    </div>
  );
}

export default function LiveWarehouse() {
  const wh = useWarehouseId();
  const [auto, setAuto] = useState(true);
  const [mode, setMode] = useState("fill");
  const [level, setLevel] = useState("all");
  const [view, setView] = useState("3d");
  const [selected, setSelected] = useState(null);
  const status = useLive(withWh("/api/live/status", wh), { poll: auto ? 10000 : 0 });
  const geom = useLive(withWh("/api/live/bins", wh));
  const alerts = useLive(withWh("/api/live/alerts", wh), { poll: auto ? 10000 : 0 });
  const health = useLive(withWh("/api/live/health", wh), { poll: auto ? 30000 : 0 });
  const sim = useAction();
  const now = useNow(1000);
  const levelOptions = [{ value: "all", label: "All" }, ...[1, 2, 3, 4, 5].map((l) => ({ value: l, label: String(l) }))];

  const simulate = async () => {
    await sim.run(() => call(withWh("/api/live/simulate", wh), { method: "POST", body: { orders: 25 } }));
    status.refresh();
    alerts.refresh();
  };
  const dismiss = async (id) => {
    await call(withWh(`/api/live/alerts/${id}/resolve`, wh), { method: "POST" });
    alerts.refresh();
  };

  if (status.error?.status === 404 && !status.loaded) return <NoWarehouse message={status.error.message} />;
  return (
    <div className="stack">
      <WarehouseBar />
      <LiveAsync state={status} label="the live status">
        {(s) => {
          const k = s.kpis;
          const selRow = s.bins.find((b) => b.loc === selected) || null;
          return (
            <>
              <div className="chips" style={{ marginBottom: 0 }}>
                <Chip icon={Boxes}>
                  <b>{s.warehouse.name}</b>
                  {s.warehouse.source === "demo" ? " · demo data" : ""}
                </Chip>
                <Chip icon={RefreshCw}>
                  Updated <b>{ago(status.at, now)}</b>
                  {auto ? " · refreshes every 10 s" : " · auto refresh off"}
                </Chip>
                <Chip icon={PackageCheck}>
                  Last stock movement <b>{ago(k.last_movement, now)}</b>
                </Chip>
                <Chip icon={ClipboardList}>
                  <b>{k.orders_24h}</b> orders in the last 24 h
                </Chip>
              </div>

              <div className="kpi-grid">
                <Card icon={Boxes} label="Bins in use" value={`${k.occupancy_pct}%`} sub={`${nf(k.bins_occupied)} of ${nf(k.bins_total)} bins hold a product`} />
                <Card icon={PackageCheck} label="Units on hand" value={nf(k.units_in_faces + k.units_in_reserve)} sub={`${nf(k.units_in_faces)} in pick faces · ${nf(k.units_in_reserve)} in reserve`} />
                <Card icon={PackageMinus} tone={k.empty_faces ? "bad" : k.low_faces ? "warn" : "good"} label="Pick faces running low" value={nf(k.low_faces + k.empty_faces)} sub={`${nf(k.empty_faces)} empty · ${nf(k.open_replenish)} refill work orders open`} />
                <Card icon={ClipboardList} tone={k.open_moves ? "warn" : ""} label="Open work orders" value={nf(k.open_replenish + k.open_moves)} sub={`${nf(k.open_replenish)} refills · ${nf(k.open_moves)} re-slotting moves`} />
                <Card icon={Bell} tone={k.stockouts ? "bad" : k.open_alerts ? "warn" : "good"} label="Open alerts" value={nf(k.open_alerts)} sub={k.stockouts ? `${k.stockouts} product(s) out of stock` : "No stock-outs"} />
              </div>

              <Panel
                title="Live warehouse"
                subtitle={`${MODE_HELP[mode]} Colours come from the stock numbers recorded in the system, refreshed automatically.`}
                icon={Cuboid}
                actions={
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
                      {auto ? "Pause auto refresh" : "Resume auto refresh"}
                    </button>
                    <button className="btn small" onClick={status.refresh}>
                      <RefreshCw size={15} aria-hidden="true" /> Refresh now
                    </button>
                    <button className="btn small primary" onClick={simulate} disabled={sim.busy}>
                      <Play size={15} aria-hidden="true" /> {sim.busy ? "Simulating…" : "Simulate 25 orders (demo)"}
                    </button>
                  </div>
                }
              >
                <div className="toolbar">
                  <div className="field" style={{ maxWidth: "none" }}>
                    <span className="field-label">Colour by</span>
                    <Segmented label="Colour by" value={mode} onChange={setMode} options={MODES} />
                  </div>
                  <div className="field" style={{ maxWidth: "none" }}>
                    <span className="field-label">Shelf level</span>
                    <Segmented label="Shelf level" value={level} onChange={setLevel} options={levelOptions} />
                  </div>
                  <div className="field" style={{ maxWidth: "none" }}>
                    <span className="field-label">View</span>
                    <Segmented label="View" value={view} onChange={setView} options={[{ value: "3d", label: "3D" }, { value: "2d", label: "2D map" }]} />
                  </div>
                </div>
                {sim.result && (
                  <Note kind="good">
                    Demo traffic applied: {sim.result.orders} orders, {sim.result.lines} lines, {sim.result.units} units picked
                    {sim.result.short_lines ? `, ${sim.result.short_lines} line(s) short` : ""}. Stock, work orders and alerts have updated.
                  </Note>
                )}
                <ActionError error={sim.error} />
                <div className="split" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(250px, 320px)" }}>
                  <LiveAsync state={geom} skeleton="chart" label="the warehouse structure">
                    {(bins) =>
                      view === "2d" ? (
                        <FloorMap bins={bins} rows={s.bins} mode={mode} level={level} />
                      ) : (
                        <Safe>
                          <Suspense fallback={<Skeleton variant="chart" label="the 3D view" />}>
                            <LiveWarehouse3D bins={bins} rows={s.bins} mode={mode} level={level} selected={selected} onSelect={setSelected} />
                          </Suspense>
                        </Safe>
                      )
                    }
                  </LiveAsync>
                  <div>
                    <h3 className="eyebrow" style={{ marginBottom: 10 }}>
                      Selected pick face
                    </h3>
                    <BinDetail r={selRow} onClose={() => setSelected(null)} />
                  </div>
                </div>
              </Panel>

              <div className="grid-main">
                <Panel title="Alerts" subtitle="Stock-outs, items at their reorder point, layout drift and data-integrity problems. Most clear themselves when the cause is fixed." icon={Bell}>
                  <LiveAsync state={alerts} skeleton="table" label="the alerts">
                    {(list) =>
                      list.length === 0 ? (
                        <Note kind="good">No open alerts.</Note>
                      ) : (
                        <ul className="alert-list">
                          {list.slice(0, 12).map((a) => (
                            <li key={a.id}>
                              <Badge tone={a.severity === "high" ? "bad" : "warn"}>{a.kind}</Badge>
                              <span className="alert-msg">{a.message}</span>
                              <span className="muted alert-when">{ago(a.created_at, now)}</span>
                              <button className="btn small" onClick={() => dismiss(a.id)} aria-label={`Dismiss alert: ${a.message}`}>
                                Dismiss
                              </button>
                            </li>
                          ))}
                          {list.length > 12 && <li className="muted">…and {list.length - 12} more</li>}
                        </ul>
                      )
                    }
                  </LiveAsync>
                </Panel>
                <Panel title="System health" icon={ShieldCheck}>
                  <LiveAsync state={health} skeleton="kpis" label="system health">
                    {(h) => (
                      <div className="stack">
                        <div className="btn-row">
                          <Badge tone={h.integrity.ok ? "good" : "bad"}>{h.integrity.ok ? "Stock matches the movement log" : `${h.integrity.n_mismatches} mismatch(es)`}</Badge>
                        </div>
                        <p className="muted" style={{ margin: 0 }}>
                          {nf(h.integrity.rows_checked)} stock rows were recomputed from the movement history and compared. Every change to stock is a recorded movement.
                        </p>
                        {h.last_job ? (
                          <p style={{ margin: 0 }}>
                            <FlaskConical size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                            Last re-slotting run {ago(h.last_job.finished_at, now)}: {h.last_job.summary.proposed} move(s) proposed, {Math.round(100 * h.last_job.summary.far_share)}% of fast sellers in far bins.
                          </p>
                        ) : (
                          <p className="muted" style={{ margin: 0 }}>
                            Re-slotting has not run yet. Open Work Orders to run it.
                          </p>
                        )}
                        <Chip icon={Layers}>
                          <b>{nf(s.kpis.skus)}</b> products
                        </Chip>
                      </div>
                    )}
                  </LiveAsync>
                </Panel>
              </div>
            </>
          );
        }}
      </LiveAsync>
    </div>
  );
}
