import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ClipboardList, Eye, History, Play, Repeat, X } from "lucide-react";
import { Badge, Chip, InfoTip, Note, Panel, Segmented, TableScroll, fmt } from "../ui.jsx";
import { ActionError, LiveAsync, NoWarehouse, WarehouseBar, ago, call, nf, useAction, useLive, useNow, useWarehouseId, withWh } from "../live/common.jsx";

const KIND = {
  replenish: { label: "Refill", tone: "accent" },
  swap: { label: "Swap", tone: "warn" },
  relocate: { label: "Move", tone: "warn" },
};

function Title({ t }) {
  const [a, b] = t.items;
  if (t.kind === "replenish") {
    return (
      <span>
        Refill <b>{a.sku}</b>: take {nf(a.qty)} unit(s) from reserve to the pick face <code>{a.to_loc}</code>
      </span>
    );
  }
  if (t.kind === "swap") {
    return (
      <span>
        Swap <b>{a.sku}</b> and <b>{b.sku}</b> between their bins
      </span>
    );
  }
  return (
    <span>
      Move <b>{a.sku}</b> to the free bin <code>{a.to_loc}</code>
    </span>
  );
}

function TaskCard({ t, busy, onAct, closed, fresh }) {
  const now = useNow(30000);
  return (
    <li className={`task${fresh ? " fresh" : ""}`}>
      <div className="task-head">
        <Badge tone={KIND[t.kind].tone}>{KIND[t.kind].label}</Badge>
        <div className="task-title">
          <Title t={t} />
        </div>
        {!closed ? (
          <div className="btn-row">
            <button className="btn small primary" onClick={() => onAct(t.id, "complete")} disabled={busy}>
              <Check size={15} aria-hidden="true" /> Mark done
            </button>
            <button className="btn small" onClick={() => onAct(t.id, "reject")} disabled={busy}>
              <X size={15} aria-hidden="true" /> Reject
            </button>
          </div>
        ) : (
          <Badge tone={t.status === "done" ? "good" : t.status === "stale" ? "warn" : ""}>{t.status}</Badge>
        )}
      </div>
      {t.kind !== "replenish" && (
        <ul className="task-items">
          {t.items.map((i) => (
            <li key={i.sku}>
              <b>{i.sku}</b> <code>{i.from_loc}</code> <ArrowRight size={13} aria-hidden="true" /> <code>{i.to_loc}</code>
              <span className="muted"> · {nf(i.qty)} unit(s) in the pick face</span>
            </li>
          ))}
        </ul>
      )}
      <div className="muted task-meta">
        {t.reason}
        {t.saving > 0 && ` · saves about ${fmt(t.saving, 0)} metre-equivalents of walking per week once done`}
        {` · ${closed ? `closed ${ago(t.done_at || t.created_at, now)}` : `raised ${ago(t.created_at, now)}`}`}
      </div>
    </li>
  );
}

/** Why the planner proposes a move, built only from the fields of the response (the same wording the work order would carry). */
const why = (m) =>
  m.kind === "swap"
    ? `${m.a} is predicted to sell about ${m.pred_a.toFixed(0)} lines/week and sits farther out than ${m.b} (${m.pred_b.toFixed(0)}/week)`
    : `${m.a} is predicted to sell about ${m.pred_a.toFixed(0)} lines/week; a free bin is closer to the depot`;

/** Top-down plan of the warehouse (one dot per bin) with each proposed move drawn as a path from where the product is to where it would go. */
function MovePlan({ moves, bins, sel, onSelect }) {
  const g = useMemo(() => {
    if (!bins?.length) return null;
    const xs = bins.map((b) => b.x);
    const ys = bins.map((b) => b.y);
    const x0 = Math.min(...xs) - 2;
    const x1 = Math.max(...xs) + 2;
    const y1 = Math.max(...ys) + 3;
    const at = new Map(bins.map((b) => [b.loc, b]));
    const dots = bins.map((b) => `M${(b.x - 0.22).toFixed(2)} ${(y1 - b.y - 0.22).toFixed(2)}h.44v.44h-.44z`).join("");
    return { x0, w: x1 - x0, h: y1 + 4, y1, at, dots };
  }, [bins]);
  if (!g) return null;
  const P = (loc) => {
    const b = g.at.get(loc);
    return b ? [b.x, g.y1 - b.y] : null;
  };
  return (
    <svg className="mv-plan" viewBox={`${g.x0} -1 ${g.w} ${g.h}`} role="img" aria-label={`Top-down plan of the warehouse showing ${moves.length} proposed move${moves.length === 1 ? "" : "s"}. Orange rings mark where a product is now, green markers where it would go.`}>
      <defs>
        <marker id="mv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="mv-arrowhead" />
        </marker>
      </defs>
      <path d={g.dots} className="mv-bins" />
      <text x={0} y={g.y1 + 1.3} className="mv-note">depot</text>
      {moves.map((m, i) => {
        const legs = m.kind === "swap" ? [[m.a_from, m.a_to, m.a], [m.b_from, m.b_to, m.b]] : [[m.a_from, m.a_to, m.a]];
        const on = sel === i;
        return (
          <g key={i} className={`mv${on ? " on" : ""}${sel != null && !on ? " dim" : ""}`} style={{ animationDelay: `${0.25 + i * 0.4}s` }} onClick={() => onSelect(on ? null : i)}>
            {legs.map(([from, to], k) => {
              const f = P(from);
              const t = P(to);
              if (!f || !t) return null;
              const lift = k === 0 ? -2.2 : 2.2; // the two halves of a swap bow in opposite directions so both stay visible
              const c = [(f[0] + t[0]) / 2 + lift, (f[1] + t[1]) / 2];
              return (
                <g key={k}>
                  <path d={`M${f[0]} ${f[1]}Q${c[0]} ${c[1]} ${t[0]} ${t[1]}`} className="mv-line" pathLength="1" markerEnd="url(#mv-arrow)" style={{ animationDelay: `${0.45 + i * 0.4}s` }} />
                  <circle cx={f[0]} cy={f[1]} r="0.95" className="mv-from" />
                  <circle cx={t[0]} cy={t[1]} r="0.7" className="mv-to" />
                </g>
              );
            })}
            {P(m.a_from) && <text x={P(m.a_from)[0] + 1.2} y={P(m.a_from)[1] - 1} className="mv-num">{i + 1}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Proposals({ moves, bins, onClose }) {
  const [sel, setSel] = useState(null);
  if (!moves.length) {
    return (
      <div className="stack">
        <Note kind="good">The layout already matches recent demand: no move is worth its cost right now. Nothing would be proposed.</Note>
        <div className="btn-row">
          <button className="btn small" onClick={onClose}>
            Close preview
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack mv-preview">
      <div className="btn-row">
        <Badge tone="warn">Proposal: nothing has moved</Badge>
        <span className="muted" style={{ fontSize: 13 }}>
          Orange ring = where the product is now · green = where it would go · numbers match the table
        </span>
        <button className="btn small" style={{ marginLeft: "auto" }} onClick={onClose}>
          <X size={15} aria-hidden="true" /> Close preview
        </button>
      </div>
      <MovePlan moves={moves} bins={bins} sel={sel} onSelect={setSel} />
      <TableScroll label="Proposed moves">
        <table className="data compact">
          <caption className="sr-only">Moves the planner would propose, with the reason and the weekly saving of each. Select a row to highlight it on the plan.</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Move</th>
              <th scope="col">Products</th>
              <th scope="col">From → to</th>
              <th scope="col" title="Predicted pick lines next week">Predicted lines / week</th>
              <th scope="col" title="Weekly saving after subtracting the cost of the move">Net saving / week</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m, i) => (
              <tr key={i} className={sel === i ? "row-on" : ""} onClick={() => setSel(sel === i ? null : i)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(sel === i ? null : i))} aria-selected={sel === i}>
                <td>{i + 1}</td>
                <td>
                  <Badge tone="warn">{m.kind === "swap" ? "Swap" : "Move"}</Badge>
                </td>
                <td>
                  {m.kind === "swap" ? `${m.a} ↔ ${m.b}` : m.a}
                  <div className="muted" style={{ fontSize: 12 }}>{why(m)}</div>
                </td>
                <td className="dim">
                  {m.a_from} → {m.a_to}
                  {m.kind === "swap" && (
                    <div>
                      {m.b_from} → {m.b_to}
                    </div>
                  )}
                </td>
                <td>{m.kind === "swap" ? `${m.pred_a.toFixed(0)} and ${m.pred_b.toFixed(0)}` : m.pred_a.toFixed(0)}</td>
                <td>{fmt(m.net_saving, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

export default function WorkOrders() {
  const wh = useWarehouseId();
  const [filter, setFilter] = useState("all");
  const [showClosed, setShowClosed] = useState(false);
  const open = useLive(withWh("/api/live/tasks?status=open", wh), { poll: 15000 });
  const closed = useLive(showClosed ? withWh("/api/live/tasks?status=all&limit=60", wh) : null);
  const jobs = useLive(withWh("/api/live/jobs", wh));
  const run = useAction();
  const now = useNow(30000);
  const previewing = !!run.result?.summary?.dry_run;
  const bins = useLive(previewing ? withWh("/api/live/bins", wh) : null);
  const [fresh, setFresh] = useState(null); // ids of the work orders the run that just finished created
  const before = useRef(new Set());
  useEffect(() => {
    if (!fresh) return undefined;
    const t = setTimeout(() => setFresh(null), 7000);
    return () => clearTimeout(t);
  }, [fresh]);
  const refreshAll = () => {
    open.refresh();
    jobs.refresh();
    if (showClosed) closed.refresh();
  };
  const reslot = async (dry) => {
    before.current = new Set((open.data || []).map((t) => t.id));
    setFresh(null);
    const out = await run.run(() => call(withWh("/api/live/jobs/reslot", wh), { method: "POST", body: { dry_run: dry } }));
    if (out && !dry) {
      refreshAll();
      if (out.summary.proposed) setFresh(true); // only after the server confirmed: the new moves then show as created
    }
  };
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const onAct = async (id, what) => {
    setBusyId(id);
    setMsg(null);
    try {
      await call(withWh(`/api/live/tasks/${id}/${what}`, wh), { method: "POST" });
      setMsg({ kind: "good", text: what === "complete" ? "Marked done: stock and the layout are updated." : "Work order rejected." });
    } catch (e) {
      setMsg({ kind: "warn", text: e.message });
    }
    setBusyId(null);
    refreshAll();               // also after a refusal: an out-of-date work order is closed by the server and should leave the list
  };

  if (open.error?.status === 404 && !open.loaded) return <NoWarehouse message={open.error.message} />;
  const last = jobs.data?.find((j) => j.status === "ok");
  return (
    <div className="stack">
      <WarehouseBar />
      <Panel
        title="Re-slotting"
        subtitle="Demand changes. This looks at recent weeks of orders and proposes swaps and moves whose weekly saving is bigger than the cost of the move. Nothing in the layout changes until the floor does the move and you mark it done."
        icon={Repeat}
        actions={
          <div className="btn-row">
            <button className="btn small" onClick={() => reslot(true)} disabled={run.busy}>
              <Eye size={15} aria-hidden="true" /> Preview moves
            </button>
            <button className="btn small primary" onClick={() => reslot(false)} disabled={run.busy}>
              <Play size={15} aria-hidden="true" /> {run.busy ? "Working…" : "Run re-slotting now"}
            </button>
          </div>
        }
      >
        <div className="stack">
          <div className="chips" style={{ marginBottom: 0 }}>
            {last ? (
              <>
                <Chip>
                  Last run <b>{ago(last.finished_at, now)}</b>
                </Chip>
                <Chip>
                  <b>{last.summary.proposed}</b> moves proposed ({last.summary.swaps} swaps, {last.summary.relocations} to free bins)
                </Chip>
                <Chip>
                  <b>{Math.round(100 * last.summary.far_share)}%</b> of fast sellers in far bins
                </Chip>
                <Chip>
                  forecast from <b>{last.summary.forecast_weeks}</b> week(s) of orders
                </Chip>
              </>
            ) : (
              <Chip>Re-slotting has not run yet</Chip>
            )}
          </div>
          {run.result && (
            <div className="stack">
              <Note kind={run.result.summary.proposed ? "info" : "good"}>
                {run.result.summary.dry_run ? "Preview only: a proposal, nothing was saved and nothing has moved. " : run.result.summary.proposed ? "Done: the proposals were saved as work orders below (highlighted). The floor still has to do the moves. " : "Done: nothing was worth moving, so no work orders were created. "}
                {run.result.summary.proposed} move(s) worth doing, about {fmt(run.result.summary.weekly_saving, 0)} metre-equivalents of walking saved per week in total.
                {run.result.summary.drift_alert ? ` ${run.result.summary.drift_alert}` : ""}
              </Note>
              {run.result.summary.dry_run && <Proposals moves={run.result.moves} bins={bins.data} onClose={run.clear} />}
            </div>
          )}
          <ActionError error={run.error} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Metre-equivalents combine walking distance and a shelf-height penalty, the same measure the optimizer minimises
            <InfoTip text="A swap costs 150 metre-equivalents (two products handled); moving one product to a free bin costs 75. A move is proposed only if its weekly saving is higher." />. Running it again replaces proposals that are still open.
          </p>
        </div>
      </Panel>

      <Panel
        title="Open work orders"
        subtitle="Refills happen automatically when a pick face runs low and reserve can fill it. Moves come from re-slotting."
        icon={ClipboardList}
        actions={<Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "replenish", label: "Refills" }, { value: "move", label: "Moves" }]} />}
      >
        {msg && (
          <div role="status" style={{ marginBottom: 12 }}>
            <Note kind={msg.kind}>{msg.text}</Note>
          </div>
        )}
        <LiveAsync state={open} skeleton="table" label="the work orders">
          {(list) => {
            const shown = list.filter((t) => filter === "all" || (filter === "replenish" ? t.type === "replenish" : t.type === "move"));
            return shown.length === 0 ? (
              <Note kind="good">Nothing to do right now.</Note>
            ) : (
              <ul className="task-list" aria-label="Open work orders">
                {shown.slice(0, 60).map((t) => (
                  <TaskCard key={t.id} t={t} busy={busyId === t.id} onAct={onAct} fresh={!!fresh && t.type === "move" && !before.current.has(t.id)} />
                ))}
                {shown.length > 60 && <li className="muted">Showing the first 60 of {shown.length}.</li>}
              </ul>
            );
          }}
        </LiveAsync>
      </Panel>

      <Panel
        title="Recently closed"
        icon={History}
        subtitle="Done, rejected, replaced or out-of-date work orders."
        actions={
          <button className="btn small" onClick={() => setShowClosed((s) => !s)} aria-expanded={showClosed}>
            {showClosed ? "Hide" : "Show"}
          </button>
        }
      >
        {showClosed && (
          <LiveAsync state={closed} skeleton="table" label="closed work orders">
            {(list) => {
              const rows = list.filter((t) => t.status !== "open");
              return rows.length === 0 ? (
                <Note>Nothing closed yet.</Note>
              ) : (
                <ul className="task-list" aria-label="Closed work orders">
                  {rows.slice(0, 30).map((t) => (
                    <TaskCard key={t.id} t={t} closed />
                  ))}
                </ul>
              );
            }}
          </LiveAsync>
        )}
      </Panel>
    </div>
  );
}
