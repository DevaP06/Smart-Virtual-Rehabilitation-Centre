// What the product does, as six small demonstrations. Each card says what the real feature is, shows a restrained animation, and links to the
// dashboard page where the real thing lives. The animations are illustrative and say so; only the Simulation card uses real stored numbers.
import { BarChart3, Boxes, ClipboardList, Route, ShieldCheck, TrendingUp } from "lucide-react";
import { Illustrative, Section } from "../parts.jsx";
import { useInView } from "../hooks.js";
import { fmt } from "../../ui.jsx";

/* ---- small demos (SVG + CSS keyframes in landing.css; they run once when the card scrolls into view) ---- */
function DemandDemo() {
  const demand = [92, 70, 52, 34, 20, 12];
  return (
    <svg viewBox="0 0 180 80" className="fd" aria-hidden="true">
      {demand.map((d, i) => (
        <g key={i} transform={`translate(${8 + i * 28} 0)`}>
          <rect className={`fd-bar${i < 2 ? " hot" : ""}`} x="0" y={72 - d * 0.62} width="22" height={d * 0.62} style={{ animationDelay: `${i * 90}ms` }} />
          {i < 3 && (
            <text className="fd-rank" x="11" y={66 - d * 0.62} textAnchor="middle" style={{ animationDelay: `${500 + i * 120}ms` }}>
              #{i + 1}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
function LiveDemo() {
  return (
    <svg viewBox="0 0 180 80" className="fd" aria-hidden="true">
      {[0, 1, 2, 3].map((i) =>
        [0, 1].map((j) => <rect key={`${i}${j}`} className={`fd-cell${(i === 1 && j === 0) || (i === 2 && j === 1) || (i === 3 && j === 0) ? " pick" : ""}`} x={30 + i * 26} y={8 + j * 22} width="20" height="16" rx="2" style={{ animationDelay: `${450 + i * 140}ms` }} />),
      )}
      <rect className="fd-order" x="2" y="48" width="18" height="14" rx="2" />
      <path className="fd-path" pathLength="1" d="M20 55H42V40H68V56H94V40H120V55H160" />
      <text className="fd-label" x="160" y="52" textAnchor="end">
        dispatch
      </text>
      <text className="fd-done" x="170" y="14" textAnchor="end">
        ✓ applied
      </text>
    </svg>
  );
}
function ReslotDemo() {
  return (
    <svg viewBox="0 0 180 80" className="fd" aria-hidden="true">
      <rect className="fd-cell far" x="140" y="8" width="26" height="20" rx="2" />
      <rect className="fd-ghost" x="18" y="52" width="26" height="20" rx="2" />
      <path className="fd-path dashed" pathLength="1" d="M140 24C100 26 70 40 46 58" />
      <text className="fd-label" x="153" y="42" textAnchor="middle">
        now
      </text>
      <text className="fd-prop" x="31" y="46" textAnchor="middle">
        proposed
      </text>
    </svg>
  );
}
function PathDemo() {
  return (
    <svg viewBox="0 0 180 80" className="fd" aria-hidden="true">
      <path className="fd-path base" pathLength="1" d="M12 70H28V14H44V70H72V30H88V70H124V10H140V70H12" />
      <path className="fd-path opt" pathLength="1" style={{ animationDelay: "500ms" }} d="M12 76H28V34H44V76H12" transform="translate(0 -2)" />
      <text className="fd-label" x="168" y="22" textAnchor="end">
        longer
      </text>
      <text className="fd-label opt" x="62" y="60">
        shorter
      </text>
    </svg>
  );
}
function RulesDemo() {
  const rows = [
    ["fits", true],
    ["too big", false],
    ["hazard zone", false],
  ];
  return (
    <svg viewBox="0 0 180 80" className="fd" aria-hidden="true">
      {rows.map(([t, ok], i) => (
        <g key={t} transform={`translate(8 ${6 + i * 24})`}>
          <g className="fd-row" style={{ animationDelay: `${i * 350}ms` }}>
            <rect className={`fd-chk ${ok ? "ok" : "no"}`} x="0" y="0" width="164" height="20" rx="3" />
            <text className="fd-mark" x="9" y="14">
              {ok ? "✓" : "✕"}
            </text>
            <text className="fd-text" x="26" y="14">
              {t}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
function ImpactDemo({ r }) {
  // Real numbers only: when the stored results are not available the card says so instead of drawing bars.
  if (!r)
    return (
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        The stored results are not available right now, so no numbers are shown.
      </p>
    );
  const opt = Math.max(0, 100 - r.distReduction);
  return (
    <div className="fd-impact" aria-label={`Walking distance per order: baseline 100%, optimized ${fmt(opt, 0)}% of the baseline (stored results).`}>
      <div className="fd-ilabel">random layout: 100%</div>
      <i className="fd-ibar base" style={{ "--w": "100%" }} />
      <div className="fd-ilabel">optimized: {fmt(opt, 0)}% of that (−{fmt(r.distReduction)}%)</div>
      <i className="fd-ibar opt" style={{ "--w": `${opt}%` }} />
      <div className="muted" style={{ fontSize: 12 }}>
        Stored results: {r.scenario}, {r.nTest.toLocaleString()} held-out orders.
      </div>
    </div>
  );
}

export default function FeaturesSection({ res, onEnter }) {
  const [ref, seen] = useInView(0.15);
  const r = res.status === "ready" ? res.data : null;
  const cards = [
    { icon: BarChart3, title: "Demand-aware slotting", to: "eda", cta: "Open Data Analysis", demo: <DemandDemo />, tag: true, text: "Products are ranked by how often they are picked and grouped into ABC classes; the fastest are placed where walking and reaching are cheapest." },
    { icon: Boxes, title: "Live warehouse", to: "live", cta: "Open Live Warehouse", demo: <LiveDemo />, tag: true, text: "Every bin coloured by stock. Orders reduce stock as picks are recorded. Simulate applies 25 demo orders, and the page can then replay their picks." },
    { icon: ClipboardList, title: "Reslotting proposals", to: "orders", cta: "Open Work Orders", demo: <ReslotDemo />, tag: true, text: "When demand drifts, the planner proposes swaps and moves worth more than they cost. A proposal is not a move: the floor does it and marks it done." },
    { icon: Route, title: "Pick-path comparison", to: "path", cta: "Open the Pick Path Simulator", demo: <PathDemo />, tag: true, text: "The same order walked on a random, an ABC and the full layout, in 2D, in 3D, or as a playback." },
    { icon: ShieldCheck, title: "Constraint-aware", to: "rules", cta: "Open Constraints", demo: <RulesDemo />, tag: true, text: "Size, volume, weight, beam and rack-frame load, hazard zones, fragile and heavy shelf levels and incompatible neighbours are checked, and an independent validator re-checks the result." },
    { icon: TrendingUp, title: "Simulation and business impact", to: "impact", cta: "Open Business Impact", demo: <ImpactDemo r={r} />, tag: false, text: "Layouts are replayed on orders they never saw and compared with a random baseline, with confidence intervals. Your own assumptions turn it into hours and money." },
  ];
  return (
    <Section id="features" n="07" eyebrow="What it does" title="Six ways the engine works for a warehouse." lead="Each demonstration is a small illustration of a feature that exists in the dashboard. Select a card to open the real page.">
      <div ref={ref} className={`l-features${seen ? " play" : ""}`}>
        {cards.map((c, i) => (
          <article className="l-feature" key={c.title} style={{ transitionDelay: `${i * 70}ms` }}>
            <div className="l-feature-demo">{c.demo}</div>
            <h3>
              <c.icon size={18} aria-hidden="true" /> {c.title}
            </h3>
            <p>{c.text}</p>
            <div className="l-feature-foot">
              <button className="link-btn" onClick={() => onEnter(c.to)}>
                {c.cta}
              </button>
              {c.tag && <Illustrative>Illustration</Illustrative>}
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
