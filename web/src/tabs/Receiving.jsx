import { useState } from "react";
import { CheckCircle2, Footprints, Info, Layers, PackagePlus, Search, Sparkles } from "lucide-react";
import { Badge, Card, Legend, Note, NumberField, Panel, Select, TableScroll, fmt } from "../ui.jsx";
import { COLORS } from "../chartTheme.js";
import { ActionError, NoWarehouse, WarehouseBar, call, newKey, nf, useAction, useLive, useWarehouseId, withWh } from "../live/common.jsx";

const CATEGORIES = ["stationery", "home_decor", "kitchen", "toys", "glassware", "candles", "cleaning", "tools_bulk", "textiles"];
const EMPTY_SKU = { name: "", category: "", width: "", height: "", depth: "", weight: "", hazard: "none", handling: "standard", cases: 1, units_per_case: 1 };
const TERMS = [
  ["distance", "Distance to depot", COLORS.blue],
  ["shelf", "Shelf height", COLORS.warn],
  ["fit", "Wasted space", COLORS.violet],
  ["affinity", "Distance to bought-together items", COLORS.good],
];

const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
const masterBody = (m) => ({
  name: m.name || null,
  category: m.category || null,
  width: numOrNull(m.width),
  height: numOrNull(m.height),
  depth: numOrNull(m.depth),
  weight: numOrNull(m.weight),
  hazard: m.hazard,
  handling: m.handling,
  cases: Number(m.cases) || 1,
  units_per_case: Number(m.units_per_case) || 1,
});

function CostBar({ o, max }) {
  return (
    <div className="costbar" role="img" aria-label={`Cost ${fmt(o.total, 0)}: ${TERMS.map(([k, n]) => `${n} ${fmt(o[k], 0)}`).join(", ")}`}>
      {TERMS.map(([k, name, color]) => (
        <i key={k} title={`${name}: ${fmt(o[k], 0)}`} style={{ width: `${(100 * Math.max(0, o[k])) / max}%`, background: color }} />
      ))}
    </div>
  );
}

function Why({ o }) {
  const parts = [`level ${o.level}${o.golden ? " (golden zone: easy reach)" : ""}`, `${fmt(o.depot_m)} m from the depot`, `uses about ${o.fill_pct}% of the bin volume`];
  if (o.partners?.length) parts.push(`${fmt(o.partners[0].walk_m)} m from ${o.partners[0].sku}, often ordered with it`);
  return <span>{parts.join(" · ")}</span>;
}

export default function Receiving() {
  const wh = useWarehouseId();
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState(1);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [master, setMaster] = useState(EMPTY_SKU);
  const [choice, setChoice] = useState(null);
  const [key, setKey] = useState(newKey());
  const plan = useAction();
  const confirm = useAction();
  const ping = useLive("/api/live/warehouses");
  const p = plan.result;
  const needsMaster = p?.mode === "unknown_sku" || p?.is_new_sku;

  const find = async (e) => {
    e?.preventDefault();
    confirm.clear();
    setChoice(null);
    const out = await plan.run(() =>
      call(withWh("/api/live/receive/plan", wh), { method: "POST", body: { sku: sku.trim(), qty, new_sku: p?.mode === "unknown_sku" || p?.is_new_sku ? masterBody(master) : null } }),
    );
    if (out?.options?.length) setChoice(out.options[0].loc);
  };
  const book = async () => {
    const body = { sku: sku.trim(), qty, loc: p.mode === "new_face" ? choice : null, lot: lot || null, expiry: expiry || null, idempotency_key: key, new_sku: p.is_new_sku ? masterBody(master) : null };
    const out = await confirm.run(() => call(withWh("/api/live/receive/confirm", wh), { method: "POST", body }));
    if (out) {
      setKey(newKey());
      plan.clear();
    }
  };
  const reset = () => {
    plan.clear();
    confirm.clear();
    setSku("");
    setQty(1);
    setLot("");
    setExpiry("");
    setMaster(EMPTY_SKU);
    setChoice(null);
  };
  const set = (k) => (v) => setMaster((m) => ({ ...m, [k]: v }));

  if (ping.loaded && ping.data.length === 0) return <NoWarehouse />;
  const done = confirm.result;
  const max = p?.options ? Math.max(1, ...p.options.map((o) => o.total)) : 1;
  return (
    <div className="stack">
      <WarehouseBar />
      {done && (
        <Note kind="good">
          <b>Received.</b> {done.to_face > 0 && `${nf(done.to_face)} unit(s) of ${done.sku} went into the pick face ${done.face}`}
          {done.to_face > 0 && done.to_reserve > 0 ? " and " : ""}
          {done.to_reserve > 0 && `${nf(done.to_reserve)} unit(s) to reserve`}.{done.new_pick_face ? ` ${done.face} is now this product's pick face.` : ""} Reference {done.ref}.{" "}
          <button className="link-btn" onClick={reset}>
            Receive another delivery
          </button>
        </Note>
      )}
      <Panel title="Receive a delivery" subtitle="Enter the product and how many units arrived. The system either tops up its pick face, or, for a product with no bin yet, recommends the three best bins." icon={PackagePlus}>
        <form onSubmit={find} className="stack" aria-label="Receive a delivery">
          <div className="form-row">
            <div className="field">
              <label htmlFor="rcv-sku">Product (SKU)</label>
              <input id="rcv-sku" className="input" value={sku} onChange={(e) => { setSku(e.target.value); plan.clear(); }} placeholder="Existing SKU, or a new one" autoComplete="off" spellCheck={false} required />
            </div>
            <NumberField label="Units received" value={qty} onChange={(v) => { setQty(v); plan.clear(); }} min={1} step={1} />
            <div className="field">
              <label htmlFor="rcv-lot">Lot (optional)</label>
              <input id="rcv-lot" className="input" value={lot} onChange={(e) => setLot(e.target.value)} maxLength={40} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="rcv-exp">Expiry (optional)</label>
              <input id="rcv-exp" className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          </div>

          {needsMaster && (
            <fieldset className="fieldset">
              <legend>
                <Sparkles size={15} aria-hidden="true" /> New product details
              </legend>
              <p className="muted" style={{ marginTop: 0 }}>
                {sku.trim() || "This SKU"} is not in the product list yet. Size is of one case in cm and weight is kg per case. Leave a size or weight blank to have it estimated from the category: it will be flagged as estimated.
              </p>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="m-name">Name</label>
                  <input id="m-name" className="input" value={master.name} onChange={(e) => set("name")(e.target.value)} maxLength={160} />
                </div>
                <div className="field">
                  <label htmlFor="m-cat">Category</label>
                  <input id="m-cat" className="input" list="m-cats" value={master.category} onChange={(e) => set("category")(e.target.value)} placeholder="e.g. kitchen" autoComplete="off" />
                  <datalist id="m-cats">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                {[["width", "Width (cm)"], ["height", "Height (cm)"], ["depth", "Depth (cm)"], ["weight", "Weight (kg per case)"]].map(([k, label]) => (
                  <div className="field" key={k}>
                    <label htmlFor={`m-${k}`}>{label}</label>
                    <input id={`m-${k}`} className="input" type="number" min="0" step="any" inputMode="decimal" value={master[k]} onChange={(e) => set(k)(e.target.value)} />
                  </div>
                ))}
                <Select label="Hazard class" value={master.hazard} onChange={set("hazard")} options={[{ value: "none", label: "None" }, { value: "flammable", label: "Flammable" }, { value: "oxidizer", label: "Oxidizer" }]} hint="Hazardous products only go in the hazard cage." />
                <Select label="Handling" value={master.handling} onChange={set("handling")} options={[{ value: "standard", label: "Standard" }, { value: "fragile", label: "Fragile (levels 2-4)" }, { value: "heavy", label: "Heavy (low levels)" }]} />
                <NumberField label="Cases in the pick face" value={master.cases} onChange={set("cases")} min={1} step={1} />
                <NumberField label="Units per case" value={master.units_per_case} onChange={set("units_per_case")} min={1} step={1} />
              </div>
            </fieldset>
          )}

          <div className="btn-row">
            <button className="btn primary" type="submit" disabled={plan.busy || !sku.trim() || !(qty >= 1)}>
              <Search size={16} aria-hidden="true" /> {plan.busy ? "Checking…" : needsMaster ? "Find the best bins" : "Find the best place"}
            </button>
          </div>
          <ActionError error={plan.error} />
        </form>
      </Panel>

      {p?.mode === "unknown_sku" && (
        <Note>
          {p.message} Fill in the details above, then press <b>Find the best bins</b>.
        </Note>
      )}

      {p?.mode === "top_up" && (
        <Panel title="Top up the pick face" icon={Layers}>
          <div className="stack">
            <div className="kpi-grid">
              <Card icon={Layers} label="Pick face" value={<span style={{ fontSize: 20 }}>{p.face}</span>} sub={`${nf(p.face_qty)} of ${nf(p.capacity)} units now`} />
              <Card icon={CheckCircle2} tone="good" label="Into the pick face" value={nf(p.to_face)} sub="units go to the bin the picker walks to" />
              <Card icon={Info} label="Into reserve" value={nf(p.to_reserve)} sub={p.to_reserve ? "pick face would be full: the rest goes to reserve" : "nothing is left over"} />
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={book} disabled={confirm.busy}>
                <CheckCircle2 size={16} aria-hidden="true" /> {confirm.busy ? "Booking…" : `Confirm receipt of ${nf(qty)} units`}
              </button>
            </div>
            <ActionError error={confirm.error} />
          </div>
        </Panel>
      )}

      {p?.mode === "new_face" && (
        <Panel
          title={p.options.length ? "Best bins for this product" : "No bin can take this product"}
          subtitle={p.options.length ? "Every option satisfies every rule (size, weight, hazard zone, shelf level, beam and rack load, neighbours). Lower cost is better." : undefined}
          icon={Footprints}
        >
          <div className="stack">
            {p.new_item && (
              <Note>
                <b>New item.</b> This product has no sales history, so its demand is assumed to be about {fmt(p.assumed_velocity, 0)} pick lines (the median of similar products). It will be re-slotted by the nightly job once real sales exist.
              </Note>
            )}
            {p.estimated_dims && (
              <Note kind="warn">
                The size or weight was <b>estimated</b> from the category. Measure the product and correct it when you can.
              </Note>
            )}
            {p.options.length === 0 ? (
              <Note kind="warn">
                <b>Why:</b> {p.reasons.join(" ")}
              </Note>
            ) : (
              <>
                <Legend items={TERMS.map(([, n, c]) => [c, n])} />
                <div className="opt-list" role="radiogroup" aria-label="Recommended bins">
                  {p.options.map((o, i) => (
                    <label key={o.loc} className={`opt ${choice === o.loc ? "on" : ""}`}>
                      <input type="radio" name="bin" value={o.loc} checked={choice === o.loc} onChange={() => setChoice(o.loc)} />
                      <div className="opt-body">
                        <div className="btn-row" style={{ justifyContent: "space-between" }}>
                          <span>
                            <b>{o.loc}</b> {i === 0 && <Badge tone="good">best</Badge>}
                          </span>
                          <span className="muted">cost {fmt(o.total, 0)}</span>
                        </div>
                        <CostBar o={o} max={max} />
                        <div className="muted" style={{ fontSize: 13 }}>
                          <Why o={o} />
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <TableScroll label="Cost split of the recommended bins">
                  <table className="data compact">
                    <caption className="sr-only">Cost of each recommended bin split into distance, shelf height, wasted space and bought-together distance.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Bin</th>
                        <th scope="col">Level</th>
                        <th scope="col">Depot (m)</th>
                        {TERMS.map(([k, n]) => (
                          <th key={k} scope="col">{n}</th>
                        ))}
                        <th scope="col">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.options.map((o) => (
                        <tr key={o.loc} className={choice === o.loc ? "hl" : ""}>
                          <td>{o.loc}</td>
                          <td>{o.level}</td>
                          <td>{fmt(o.depot_m)}</td>
                          {TERMS.map(([k]) => (
                            <td key={k}>{fmt(o[k], 0)}</td>
                          ))}
                          <td>{fmt(o.total, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <div className="btn-row">
                  <button className="btn primary" onClick={book} disabled={confirm.busy || !choice}>
                    <CheckCircle2 size={16} aria-hidden="true" /> {confirm.busy ? "Booking…" : `Assign ${choice || "a bin"} and receive ${nf(qty)} units`}
                  </button>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {nf(p.to_face)} unit(s) go into the new pick face, {nf(p.to_reserve)} to reserve. The server re-checks the rules before it saves.
                  </span>
                </div>
              </>
            )}
            <ActionError error={confirm.error} />
          </div>
        </Panel>
      )}
    </div>
  );
}
