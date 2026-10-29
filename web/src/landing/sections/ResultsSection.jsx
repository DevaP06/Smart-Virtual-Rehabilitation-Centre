// Headline results on the landing page. Every number comes from useResults (the stored-results API); nothing is hard-coded.
import { Boxes, CalendarDays, CheckCircle2, Database, Footprints, RefreshCw, ShieldCheck, Table2, Timer } from "lucide-react";
import { Section } from "../parts.jsx";
import { useEased, useInView } from "../hooks.js";
import { fmt, LABEL } from "../../ui.jsx";

function Metric({ icon: Icon, label, value, unit = "%", sign = "", dec = 1, p, children, note, tone }) {
  return (
    <div className={`l-metric ${tone || ""}`}>
      <div className="l-metric-top">
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="l-metric-value num" aria-label={`${sign}${fmt(value, dec)}${unit}`}>
        <span aria-hidden="true">
          {sign}
          {fmt(value * p, dec)}
          {unit}
        </span>
      </div>
      {children}
      <p className="l-metric-note" style={{ opacity: p > 0.6 ? 1 : 0 }}>
        {note}
      </p>
    </div>
  );
}

function Loaded({ d, seen }) {
  const p = useEased(seen, 750);
  const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const dist = Math.abs(d.distReduction);
  const time = Math.abs(d.timeReduction);
  return (
    <>
      <div className="l-metrics">
        <Metric icon={Footprints} label="Travel distance" value={dist} sign={d.distReduction >= 0 ? "−" : "+"} p={p} tone={d.distReduction > 0 ? "good" : "bad"} note={`vs a random rule-compliant layout, per order · 95% CI ${fmt(d.distCi[0])} to ${fmt(d.distCi[1])}`}>
          <div className="l-compare" aria-hidden="true">
            <i className="base" style={{ width: "100%" }} />
            <i className="opt" style={{ width: `${Math.max(0, 100 - d.distReduction) * p + 100 * (1 - p)}%` }} />
          </div>
        </Metric>
        <Metric icon={Timer} label="Route time" value={time} sign={d.timeReduction >= 0 ? "−" : "+"} p={p} tone={d.timeReduction > 0 ? "good" : "bad"} note={`${fmt(d.time[1], 0)} s vs ${fmt(d.time[0], 0)} s per order under the assumed time model`}>
          <div className="l-compare" aria-hidden="true">
            <i className="base" style={{ width: "100%" }} />
            <i className="opt" style={{ width: `${Math.max(0, 100 - d.timeReduction) * p + 100 * (1 - p)}%` }} />
          </div>
        </Metric>
        <Metric icon={Boxes} label="Fill rate" value={d.fill} p={p} tone={d.fill > d.fillRandom ? "good" : ""} note={`Stored volume ÷ volume of the bins in use. Random layout: ${fmt(d.fillRandom)}%.`}>
          <div className="l-fill" aria-hidden="true">
            <i style={{ width: `${Math.min(100, d.fill) * p}%` }} />
            <b style={{ left: `${Math.min(100, d.fillRandom)}%` }} title="random layout" />
          </div>
        </Metric>
        <Metric icon={ShieldCheck} label="Rule violations" value={d.violations} unit="" dec={0} p={1} tone={d.violations === 0 ? "good" : "bad"} note={d.violations === 0 ? `Every rule satisfied on the headline layout. Naive layout: ${d.violationsNaive ?? "n/a"}.` : `Rule breaches found by the independent validator. Naive layout: ${d.violationsNaive ?? "n/a"}.`}>
          <div className={`l-verdict ${d.violations === 0 ? "ok" : "no"}`}>
            {d.violations === 0 ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
            {d.violations === 0 ? "Compliant" : "Violations found"}
          </div>
        </Metric>
      </div>
      <ul className="l-evidence">
        <li>
          <Database size={15} aria-hidden="true" /> Scenario <b>{d.scenario}</b>
        </li>
        <li>
          <Table2 size={15} aria-hidden="true" /> <b>{d.nTest.toLocaleString()}</b> held-out orders tested
        </li>
        <li>
          <Boxes size={15} aria-hidden="true" /> Layout: <b>{LABEL[d.headline] || d.headline}</b>
        </li>
        <li>
          <CheckCircle2 size={15} aria-hidden="true" /> Stored simulation results, not a live run
        </li>
        {created && (
          <li>
            <CalendarDays size={15} aria-hidden="true" /> Computed {created}
          </li>
        )}
      </ul>
    </>
  );
}

export default function ResultsSection({ res, onEnter }) {
  const [ref, seen] = useInView(0.2);
  return (
    <Section id="results" n="05" eyebrow="Performance report" title="Better placement. Measurable impact." lead="Compare optimized warehouse layouts against a baseline using order-driven simulation and constraint validation." tone="paper">
      <div ref={ref}>
        {res.status === "loading" && (
          <div className="l-metrics" role="status" aria-busy="true">
            <span className="sr-only">Loading stored results…</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 168, borderRadius: 12 }} />
            ))}
          </div>
        )}
        {res.status === "error" && (
          <div className="l-unavailable" role="alert">
            <h3>The performance summary is unavailable right now.</h3>
            <p>The stored results could not be loaded, so no numbers are shown rather than guessing. The rest of the application is unaffected.</p>
            <button className="btn" onClick={res.retry}>
              <RefreshCw size={16} aria-hidden="true" /> Try again
            </button>
          </div>
        )}
        {res.status === "empty" && (
          <div className="l-unavailable" role="status">
            <h3>No stored results yet.</h3>
            <p>
              The database has no experiment runs. Create them with <code>python scripts/seed_db.py</code>, then reload this page.
            </p>
          </div>
        )}
        {res.status === "ready" && <Loaded d={res.data} seen={seen} />}
      </div>
      <div className="l-section-cta">
        <button className="btn" onClick={() => onEnter("overview")}>
          Open the full analysis
        </button>
        <button className="btn" onClick={() => onEnter("rules")}>
          See the constraint validation
        </button>
      </div>
    </Section>
  );
}
