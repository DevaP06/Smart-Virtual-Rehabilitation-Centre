import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, History, PackageCheck, Search, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { Badge, Note, NumberField, Panel, Segmented, Select, TableScroll } from "../ui.jsx";
import { ActionError, LiveAsync, NoWarehouse, STATUS_LABEL, STATUS_TONE, WarehouseBar, ago, call, newKey, nf, useAction, useLive, useNow, useWarehouseId, withWh } from "../live/common.jsx";

const PAGE = 25;

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function SortTh({ id, label, sort, desc, onSort, hint }) {
  const active = sort === id;
  return (
    <th scope="col" aria-sort={active ? (desc ? "descending" : "ascending") : "none"} title={hint}>
      <button className="th-btn" onClick={() => onSort(id)}>
        {label}
        {active && (desc ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" />)}
      </button>
    </th>
  );
}

function RecordSale({ wh, sku, setSku, suggestions, onDone }) {
  const [qty, setQty] = useState(1);
  const act = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const out = await act.run(() => call(withWh("/api/live/orders", wh), { method: "POST", body: { lines: [{ sku: sku.trim(), qty }], idempotency_key: newKey() } }));
    if (out) onDone();
  };
  const line = act.result?.lines?.[0];
  return (
    <form onSubmit={submit} className="stack" aria-label="Record a sale">
      <div className="form-row">
        <div className="field">
          <label htmlFor="sale-sku">Product (SKU)</label>
          <input id="sale-sku" className="input" list="sku-suggest" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. 85123A" autoComplete="off" spellCheck={false} required />
        </div>
        <NumberField label="Units sold" value={qty} onChange={setQty} min={1} step={1} />
      </div>
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={act.busy || !sku.trim() || !(qty >= 1)}>
          <ShoppingCart size={16} aria-hidden="true" /> {act.busy ? "Recording…" : "Record sale"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>Units come from the pick face first, then from reserve. It is refused if there is not enough stock.</span>
      </div>
      {line && (
        <Note kind="good">
          Picked {line.picked} unit(s) of {line.sku}
          {line.from_reserve ? `, ${line.from_reserve} of them from reserve because the pick face was short` : ""}. Stock, work orders and alerts are updated.
        </Note>
      )}
      <ActionError error={act.error} />
      <datalist id="sku-suggest">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </form>
  );
}

function Correct({ wh, sku, setSku, onDone }) {
  const [where, setWhere] = useState("face");
  const [delta, setDelta] = useState(1);
  const [note, setNote] = useState("");
  const act = useAction();
  const typed = useDebounced(sku.trim());
  const rows = useLive(typed ? withWh(`/api/live/inventory?q=${encodeURIComponent(typed)}&limit=5`, wh) : null);
  const match = rows.data?.rows.find((r) => r.sku === sku.trim());
  const submit = async (e) => {
    e.preventDefault();
    const location = where === "face" ? match?.loc : "RESERVE";
    const out = await act.run(() => call(withWh("/api/live/adjust", wh), { method: "POST", body: { sku: sku.trim(), location, delta, note, idempotency_key: newKey() } }));
    if (out) onDone();
  };
  return (
    <form onSubmit={submit} className="stack" aria-label="Correct stock after a count">
      <div className="form-row">
        <div className="field">
          <label htmlFor="adj-sku">Product (SKU)</label>
          <input id="adj-sku" className="input" list="sku-suggest" value={sku} onChange={(e) => setSku(e.target.value)} autoComplete="off" spellCheck={false} required />
        </div>
        <Select
          label="Where"
          value={where}
          onChange={setWhere}
          options={[{ value: "face", label: match?.loc ? `Pick face (${match.loc})` : "Pick face" }, { value: "reserve", label: "Reserve" }]}
        />
        <div className="field">
          <label htmlFor="adj-delta">Change (units, + or −)</label>
          <input id="adj-delta" className="input" type="number" step={1} value={delta} onChange={(e) => setDelta(Number(e.target.value))} required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="adj-note">Reason (required)</label>
        <input id="adj-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cycle count found 3 damaged units" maxLength={240} required />
      </div>
      <div className="btn-row">
        <button className="btn" type="submit" disabled={act.busy || !match || !Number.isInteger(delta) || delta === 0 || !note.trim()}>
          <SlidersHorizontal size={16} aria-hidden="true" /> {act.busy ? "Saving…" : "Save correction"}
        </button>
        {sku.trim() && !match && !rows.loading && <span className="muted" style={{ fontSize: 13 }}>No product with that exact SKU.</span>}
      </div>
      {act.result && (
        <Note kind="good">
          Saved. {act.result.sku} now has {nf(act.result.qty)} unit(s) at {act.result.location}. The correction is in the movement log with your reason.
        </Note>
      )}
      <ActionError error={act.error} />
    </form>
  );
}

function MovementLog({ wh, version }) {
  const [type, setType] = useState("all");
  const mv = useLive(withWh(`/api/live/movements?type=${type}&limit=40&v=${version}`, wh));
  const now = useNow(15000);
  return (
    <Panel
      title="Movement log"
      subtitle="Every change to stock, newest first. Stock is never edited directly: it is the sum of these movements."
      icon={History}
      actions={
        <Segmented
          label="Movement type"
          value={type}
          onChange={setType}
          options={[{ value: "all", label: "All" }, { value: "pick", label: "Picks" }, { value: "receive", label: "Receipts" }, { value: "move", label: "Moves" }, { value: "adjust", label: "Corrections" }]}
        />
      }
    >
      <LiveAsync state={mv} skeleton="table" label="the movement log">
        {(rows) =>
          rows.length === 0 ? (
            <Note>No movements of this type yet.</Note>
          ) : (
            <TableScroll label="Stock movements" className="tall">
              <table className="data compact">
                <caption className="sr-only">Recent stock movements.</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Type</th>
                    <th scope="col">Product</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Units</th>
                    <th scope="col">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td title={m.ts}>{ago(m.ts, now)}</td>
                      <td>
                        <Badge tone={m.type === "pick" ? "warn" : m.type === "receive" ? "good" : m.type === "adjust" ? "bad" : "accent"}>{m.type}</Badge>
                      </td>
                      <td>{m.sku}</td>
                      <td className="dim">{m.from_loc || "–"}</td>
                      <td className="dim">{m.to_loc || "–"}</td>
                      <td>{nf(m.qty)}</td>
                      <td className="dim" title={m.note || ""}>{m.ref || "–"}{m.lot ? ` · lot ${m.lot}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )
        }
      </LiveAsync>
    </Panel>
  );
}

export default function Inventory() {
  const wh = useWarehouseId();
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("sku");
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState("sale");
  const [sku, setSku] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => setPage(0), [q, status, sort, desc, wh]);
  const path = withWh(`/api/live/inventory?q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&desc=${desc}&limit=${PAGE}&offset=${page * PAGE}&v=${version}`, wh);
  const inv = useLive(path, { poll: 20000 });
  const onSort = (id) => {
    if (sort === id) setDesc((d) => !d);
    else {
      setSort(id);
      setDesc(false);
    }
  };
  const suggestions = useMemo(() => (inv.data?.rows || []).map((r) => r.sku), [inv.data]);
  const done = () => setVersion((v) => v + 1);

  if (inv.error?.status === 404 && !inv.loaded) return <NoWarehouse message={inv.error.message} />;
  const csv = withWh(`/api/live/inventory?format=csv&q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&desc=${desc}`, wh);
  return (
    <div className="stack">
      <WarehouseBar />
      <Panel
        title="Record stock changes"
        subtitle="Sales reduce stock the moment they are recorded. Receiving new deliveries is on the Receiving page."
        icon={PackageCheck}
        actions={<Segmented label="Action" value={tab} onChange={setTab} options={[{ value: "sale", label: "Record a sale" }, { value: "adjust", label: "Correct stock" }]} />}
      >
        {tab === "sale" ? <RecordSale wh={wh} sku={sku} setSku={setSku} suggestions={suggestions} onDone={done} /> : <Correct wh={wh} sku={sku} setSku={setSku} onDone={done} />}
      </Panel>

      <Panel
        title="Stock by product"
        subtitle="Units in the pick face and in reserve for every product, with days of cover at the recent selling rate. Click a SKU to use it in the form above."
        icon={Search}
        actions={
          <a className="btn small" href={csv} download>
            <Download size={15} aria-hidden="true" /> Download CSV
          </a>
        }
      >
        <div className="toolbar">
          <div className="field">
            <label htmlFor="inv-q">Search</label>
            <input id="inv-q" className="input" type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="SKU, name, category or bin" autoComplete="off" spellCheck={false} />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All products" },
              ...["stockout", "reorder", "replenish", "ok", "unplaced"].map((k) => ({ value: k, label: `${STATUS_LABEL[k]}${inv.data?.counts?.[k] != null ? ` (${nf(inv.data.counts[k])})` : ""}` })),
            ]}
            hint="Out of stock: nothing left. Reorder: at or below the reorder point. Refill face: pick face low, reserve can refill it."
          />
        </div>
        <LiveAsync state={inv} skeleton="table" label="the inventory">
          {(d) => (
            <div className="stack">
              {d.rows.length === 0 ? (
                <Note>No products match.</Note>
              ) : (
                <TableScroll label="Inventory table">
                  <table className="data compact">
                    <caption className="sr-only">Stock per product: pick face units, reserve units, days of cover and status.</caption>
                    <thead>
                      <tr>
                        <SortTh id="sku" label="SKU" sort={sort} desc={desc} onSort={onSort} />
                        <SortTh id="category" label="Category" sort={sort} desc={desc} onSort={onSort} />
                        <SortTh id="loc" label="Bin" sort={sort} desc={desc} onSort={onSort} />
                        <SortTh id="face_qty" label="Pick face" sort={sort} desc={desc} onSort={onSort} hint="Units in the pick face / the face's capacity" />
                        <SortTh id="reserve_qty" label="Reserve" sort={sort} desc={desc} onSort={onSort} />
                        <SortTh id="total" label="Total" sort={sort} desc={desc} onSort={onSort} />
                        <th scope="col" title="Supplier reorder when total stock is at or below this">Reorder at</th>
                        <SortTh id="days_cover" label="Cover (days)" sort={sort} desc={desc} onSort={onSort} hint="Total stock divided by the recent selling rate" />
                        <SortTh id="status" label="Status" sort={sort} desc={desc} onSort={onSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.sku} className={r.sku === sku ? "hl" : ""}>
                          <td>
                            <button className="link-btn" onClick={() => setSku(r.sku)} aria-label={`Use ${r.sku} in the form`}>
                              {r.sku}
                            </button>
                            {r.estimated && <Badge tone="warn"> est. size</Badge>}
                          </td>
                          <td className="dim">{r.category}</td>
                          <td className="dim">{r.loc || "–"}</td>
                          <td>
                            <span className="inline-bar" aria-hidden="true">
                              <i style={{ width: `${Math.min(100, (100 * r.face_qty) / Math.max(1, r.capacity))}%` }} data-status={r.status} />
                            </span>{" "}
                            {nf(r.face_qty)} / {nf(r.capacity)}
                          </td>
                          <td>{nf(r.reserve_qty)}</td>
                          <td>{nf(r.total)}</td>
                          <td className="dim">{nf(r.reorder_point)}</td>
                          <td>{r.days_cover == null ? "–" : nf(r.days_cover)}</td>
                          <td>
                            <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
              <div className="btn-row" style={{ justifyContent: "space-between" }}>
                <span className="muted" role="status">
                  {d.total === 0 ? "0 products" : `Showing ${page * PAGE + 1}–${Math.min(d.total, page * PAGE + d.rows.length)} of ${nf(d.total)} products`}
                </span>
                <div className="btn-row">
                  <button className="btn small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                    Previous
                  </button>
                  <button className="btn small" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE >= d.total}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </LiveAsync>
      </Panel>

      <MovementLog wh={wh} version={version} />
    </div>
  );
}
