import { useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, ListChecks, Upload, Wand2, X } from "lucide-react";
import { Badge, Chip, Note, Panel, TableScroll } from "../ui.jsx";
import { ActionError, call, newKey, nf, setWarehouse, useAction } from "../live/common.jsx";

const MAX_BYTES = 4_000_000;
const SLOTS = [
  { id: "bins", label: "Bins (warehouse structure)", required: true, help: "One row per bin or pick face: where it is, its size and weight rating." },
  { id: "products", label: "Products", required: true, help: "One row per SKU: size, weight, category, hazard class and handling." },
  { id: "orders", label: "Order history (optional)", help: "Past order lines. Used to place fast sellers close to the depot. Without it, products are placed by size and rules, and demand is learned from new orders." },
  { id: "stock", label: "Starting stock (optional)", help: "Units on hand. A bin id in Location_ID says where a product sits today; RESERVE or blank means reserve storage." },
];
const TEMPLATE_FILES = { bins: "bins", products: "products", orders: "orders", stock: "stock" };
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function FileSlot({ slot, file, onFile, onClear }) {
  const id = `file-${slot.id}`;
  return (
    <div className="file-slot">
      <div>
        <label className="field-label" htmlFor={id}>
          {slot.label}
          {slot.required && <span aria-hidden="true"> *</span>}
        </label>
        <p className="muted" style={{ margin: "2px 0 8px", fontSize: 13 }}>{slot.help}</p>
      </div>
      {file ? (
        <div className="btn-row">
          <Chip icon={FileSpreadsheet}>
            <b>{file.name}</b> · {kb(file.size)}
          </Chip>
          <button className="btn small" onClick={onClear} aria-label={`Remove ${slot.label}`}>
            <X size={14} aria-hidden="true" /> Remove
          </button>
        </div>
      ) : (
        <input id={id} className="input file-input" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      )}
    </div>
  );
}

function Report({ r }) {
  const s = r.summary;
  return (
    <div className="stack">
      {s && (
        <div className="chips" style={{ marginBottom: 0 }}>
          <Chip><b>{nf(s.bins)}</b> bins ({nf(s.hazard_bins)} in the hazard cage)</Chip>
          <Chip><b>{nf(s.skus)}</b> products ({nf(s.hazard_skus)} hazardous)</Chip>
          <Chip><b>{nf(s.order_lines)}</b> order lines</Chip>
          <Chip><b>{nf(s.already_placed)}</b> already in a bin · <b>{nf(s.placed_by_engine)}</b> placed for you</Chip>
          {s.estimated > 0 && <Chip><b>{nf(s.estimated)}</b> sizes estimated</Chip>}
          <Chip><b>{s.rule_violations}</b> rule violations</Chip>
        </div>
      )}
      {r.errors.length > 0 && (
        <div>
          <h3 className="eyebrow" style={{ marginBottom: 8 }}>
            Errors: fix these first ({r.errors.length})
          </h3>
          <TableScroll label="Errors found in the files">
            <table className="data compact errors">
              <caption className="sr-only">Problems that block the import, with the CSV line numbers they were found on.</caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Problem</th>
                  <th scope="col">Lines</th>
                </tr>
              </thead>
              <tbody>
                {r.errors.map((e, i) => (
                  <tr key={i}>
                    <td>{e.table}</td>
                    <td className="wrap">{e.message}</td>
                    <td className="dim">{e.rows ? e.rows.join(", ") : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
      {r.warnings.length > 0 && (
        <div>
          <h3 className="eyebrow" style={{ marginBottom: 8 }}>
            Warnings: worth a look ({r.warnings.length})
          </h3>
          <ul className="help-list">
            {r.warnings.map((w, i) => (
              <li key={i}>
                <Badge tone="warn">{w.table}</Badge>
                <span>
                  {w.message}
                  {w.rows ? ` (lines ${w.rows.join(", ")})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.ok && r.errors.length === 0 && <Note kind="good">Every check passed. Nothing is stored until you press Import.</Note>}
    </div>
  );
}

export default function Setup() {
  const [files, setFiles] = useState({});
  const [name, setName] = useState("My warehouse");
  const [key] = useState(newKey());
  const check = useAction();
  const imp = useAction();
  const sample = useAction();
  const total = useMemo(() => Object.values(files).reduce((n, f) => n + f.size, 0), [files]);
  const ready = files.bins && files.products;

  const setFile = async (id, f) => {
    check.clear();
    imp.clear();
    setFiles((p) => ({ ...p, [id]: { name: f.name, size: f.size, text: null } }));
    const text = await f.text();
    setFiles((p) => ({ ...p, [id]: { name: f.name, size: f.size, text } }));
  };
  const clearFile = (id) => {
    check.clear();
    imp.clear();
    setFiles((p) => {
      const { [id]: _drop, ...rest } = p;
      return rest;
    });
  };
  const loadSamples = () =>
    sample.run(async () => {
      check.clear();
      imp.clear();
      const next = {};
      for (const id of Object.keys(TEMPLATE_FILES)) {
        const r = await fetch(`/api/live/templates/${TEMPLATE_FILES[id]}.csv`);
        if (!r.ok) throw new Error(`Could not load the sample ${id} file.`);
        const text = await r.text();
        next[id] = { name: `${id}_sample.csv`, size: text.length, text };
      }
      setFiles(next);
      setName("Sample warehouse");
      return true;
    });
  const body = () => ({ bins_csv: files.bins?.text, skus_csv: files.products?.text, orders_csv: files.orders?.text ?? null, stock_csv: files.stock?.text ?? null });
  const runCheck = () => {
    imp.clear();
    return check.run(() => call("/api/live/setup/validate", { method: "POST", body: body() }));
  };
  const runImport = async () => {
    const out = await imp.run(() => call("/api/live/setup/import", { method: "POST", body: { ...body(), name, idempotency_key: key } }));
    if (out) setWarehouse(out.warehouse);
  };
  const loading = Object.values(files).some((f) => f.text == null);
  const tooBig = total > MAX_BYTES;
  const rep = check.result;

  return (
    <div className="stack">
      <Note>
        Bring your own warehouse: upload your bins and products (and, if you have them, order history and starting stock). Every row is checked first and <b>nothing is imported until all checks pass</b>. A missing product size
        can be estimated from its category and is clearly flagged as estimated.
      </Note>

      <Panel title="1. Get the templates" icon={Download} subtitle="Same column names the engine uses. Units: centimetres, kilograms, litres, metres.">
        <div className="stack">
          <div className="btn-row">
            {SLOTS.map((s) => (
              <a key={s.id} className="btn small" href={`/api/live/templates/${TEMPLATE_FILES[s.id]}.csv`} download>
                <Download size={15} aria-hidden="true" /> {s.id === "bins" ? "Bins" : s.id === "products" ? "Products" : s.id === "orders" ? "Orders" : "Stock"} sample
              </a>
            ))}
            <button className="btn small primary" onClick={loadSamples} disabled={sample.busy}>
              <Wand2 size={15} aria-hidden="true" /> {sample.busy ? "Loading…" : "Try it with the sample files"}
            </button>
          </div>
          <ActionError error={sample.error} />
          <details className="tech">
            <summary>What the columns mean</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <p>
                <b>Bins:</b> <code>Location_ID, Zone (STD or HAZ), Aisle_Number, Rack_ID, Bay, Shelf_Level (1-5), X, Y, Z, Max_Weight_Capacity (kg), Volumetric_Capacity (L), Distance_to_Dispatch_Depot (m), Bin_Width, Bin_Height, Bin_Depth (cm)</code>. Optional:
                <code> Side, Bin, AisleX, Beam_Cap, Frame_Cap</code>.
              </p>
              <p>
                <b>Products:</b> <code>SKU_ID, Width, Height, Depth (cm, one case), Weight (kg per case), Category, Hazard_Class (none, flammable, oxidizer), Handling_Type (standard, fragile, heavy)</code>. Optional: <code>Name, Cases</code> (cases in the pick face),{" "}
                <code>Units_per_Case</code>.
              </p>
              <p>
                <b>Orders:</b> <code>Order_ID, SKU_ID, Quantity, Timestamp</code>. <b>Stock:</b> <code>SKU_ID, Location_ID, Quantity</code>.
              </p>
              <p className="muted">Full description: docs/DATA_FORMAT.md and docs/LIVE_OPERATIONS.md in the repository.</p>
            </div>
          </details>
        </div>
      </Panel>

      <Panel title="2. Choose your files" icon={Upload} subtitle="The files are read in your browser and sent only when you check or import them.">
        <div className="stack">
          <div className="file-grid">
            {SLOTS.map((s) => (
              <FileSlot key={s.id} slot={s} file={files[s.id]} onFile={(f) => setFile(s.id, f)} onClear={() => clearFile(s.id)} />
            ))}
          </div>
          {tooBig && (
            <Note kind="warn">
              These files total {kb(total)}, more than the {kb(MAX_BYTES)} the browser upload accepts. Leave out the order history, or import with <code>python scripts/import_live.py</code> instead (same checks).
            </Note>
          )}
          <div className="btn-row">
            <button className="btn primary" onClick={runCheck} disabled={!ready || loading || tooBig || check.busy}>
              <ListChecks size={16} aria-hidden="true" /> {check.busy ? "Checking…" : "Check my files"}
            </button>
            {!ready && <span className="muted" style={{ fontSize: 13 }}>Choose at least the bins and products files.</span>}
          </div>
          <ActionError error={check.error} />
        </div>
      </Panel>

      {rep && (
        <Panel title="3. Check result" icon={ListChecks} actions={<Badge tone={rep.ok ? "good" : "bad"}>{rep.ok ? "Ready to import" : "Not ready"}</Badge>}>
          <Report r={rep} />
        </Panel>
      )}

      {rep?.ok && (
        <Panel title="4. Import" icon={CheckCircle2} subtitle="Creates the warehouse, places every product in a legal bin, and makes it the one the dashboard shows.">
          {imp.result ? (
            <div className="stack">
              <Note kind="good">
                <b>{imp.result.name}</b> is set up: {nf(imp.result.summary.skus)} products in {nf(imp.result.summary.bins)} bins, every rule satisfied.
              </Note>
              <div className="btn-row">
                <button className="btn primary" onClick={() => (window.location.hash = "live")}>
                  Open the live warehouse
                </button>
                <button className="btn" onClick={() => (window.location.hash = "inventory")}>
                  Go to Inventory
                </button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="wh-name">Warehouse name</label>
                  <input id="wh-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </div>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={runImport} disabled={imp.busy || !name.trim()}>
                  <CheckCircle2 size={16} aria-hidden="true" /> {imp.busy ? "Importing…" : "Import this warehouse"}
                </button>
              </div>
              <ActionError error={imp.error} />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
