// "Inside the optimization engine": the pipeline described in tabs/Method.jsx (L3 features, L4 optimizer, L5 validator, L6 simulator).
import { useEffect, useRef, useState } from "react";
import { Section } from "../parts.jsx";
import { useInView, useReducedMotion } from "../hooks.js";

const MiniBars = () => (
  <svg viewBox="0 0 120 50" aria-hidden="true" className="anim">
    {[44, 30, 20, 12, 8, 5, 4, 3].map((h, i) => (
      <rect key={i} x={4 + i * 14} y={48 - h} width="10" height={h} className={i < 2 ? "hot" : i < 5 ? "mid" : ""} />
    ))}
  </svg>
);
const MiniMask = () => (
  <svg viewBox="0 0 120 50" aria-hidden="true" className="anim">
    {Array.from({ length: 5 }, (_, r) => Array.from({ length: 12 }, (_, c) => <rect key={`${r}${c}`} x={3 + c * 9.6} y={3 + r * 9} width="7" height="6.5" className={(r * 7 + c * 3) % 5 === 0 ? "" : "mid"} />))}
  </svg>
);
const MiniCost = () => (
  <svg viewBox="0 0 120 50" aria-hidden="true" className="anim">
    <path d="M4 42 C 30 40, 40 12, 60 14 S 96 38, 116 10" className="line" pathLength="1" />
    <circle cx="60" cy="14" r="3.5" className="dot" />
  </svg>
);
const MiniRoute = () => (
  <svg viewBox="0 0 120 50" aria-hidden="true" className="anim">
    <path d="M8 44 H28 V8 H40 V44 H60 V8 H72 V44 H92 V8 H104" className="line" pathLength="1" />
    <circle cx="8" cy="44" r="3.5" className="dot" />
  </svg>
);
const MiniCi = () => (
  <svg viewBox="0 0 120 50" aria-hidden="true" className="anim">
    <line x1="16" y1="14" x2="16" y2="40" className="rule" />
    <rect x="10" y="22" width="12" height="18" className="mid" />
    <line x1="74" y1="26" x2="74" y2="42" className="rule" />
    <rect x="68" y="30" width="12" height="12" className="hot" />
    <line x1="58" y1="36" x2="90" y2="36" className="rule" />
    <line x1="4" y1="46" x2="116" y2="46" className="rule" />
  </svg>
);

const STAGES = [
  {
    name: "Demand",
    method: "Velocity and ABC (Pareto) classification, and bought-together pair counts (each product's top partners). Lift, Jaccard similarity and Louvain communities describe the pairs for analysis; a weekly forecast feeds re-slotting.",
    inputs: "Order history (time-split 70/30 train and test), SKU master.",
    role: "Says which products matter most and which belong together.",
    Viz: MiniBars,
  },
  {
    name: "Constraints",
    method: "A feasibility mask over every product and every bin: dimensions, volume, weight, hazard zone, shelf level and neighbours. Bins that break a hard rule never get a score.",
    inputs: "Product dimensions, weight and hazard class; the bin and rack grid.",
    role: "Removes every illegal placement before optimization starts.",
    Viz: MiniMask,
  },
  {
    name: "Slotting",
    method: "Greedy placement by lowest cost (demand × distance and shelf penalty, plus a best-fit term and an affinity term), CP-SAT refinement on the fastest products, then swap-based local search.",
    inputs: "Demand classes, affinity pairs, the feasibility mask.",
    role: "Chooses one legal bin for every product.",
    Viz: MiniCost,
  },
  {
    name: "Route simulation",
    method: "Replays held-out orders on each layout with two routing policies (return route and S-shape) and an assumed time model.",
    inputs: "A layout, orders the optimizer never saw.",
    role: "Turns a layout into walking distance and time per order.",
    Viz: MiniRoute,
  },
  {
    name: "Evaluation",
    method: "KPIs and bootstrap confidence intervals against a random rule-compliant layout, plus an independent validator that shares no code with the optimizer.",
    inputs: "Simulation output, the validator's rule checks.",
    role: "Reports what the layout earned, with its uncertainty, and whether it is legal.",
    Viz: MiniCi,
  },
];

export default function AlgorithmSection() {
  const [i, setI] = useState(0);
  const refs = useRef([]);
  const [seenRef, seen] = useInView(0.35);
  const reduced = useReducedMotion();
  const touched = useRef(false);
  // Walks through the five stages once when the explorer first scrolls into view, unless the visitor has already chosen one.
  useEffect(() => {
    if (!seen || reduced) return undefined;
    const timers = [1, 2, 3, 4].map((k) => setTimeout(() => !touched.current && setI(k), 1600 * k));
    return () => timers.forEach(clearTimeout);
  }, [seen, reduced]);
  const s = STAGES[i];
  const onKey = (e) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? STAGES.length - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const j = (n + STAGES.length) % STAGES.length;
    touched.current = true;
    setI(j);
    refs.current[j]?.focus();
  };
  return (
    <Section id="engine" n="08" eyebrow="Algorithm explorer" title="Inside the optimization engine." lead="Five stages from raw orders to a tested layout. The first four run offline and store their results; the dashboard reads them.">
      <div ref={seenRef} className="l-pipeline" role="tablist" aria-label="Optimization pipeline" onKeyDown={onKey} style={{ "--p": (i + 1) / STAGES.length }}>
        {STAGES.map((st, k) => (
          <button key={st.name} ref={(el) => (refs.current[k] = el)} role="tab" id={`stage-${k}`} aria-selected={i === k} aria-controls="stage-panel" tabIndex={i === k ? 0 : -1} onClick={() => {
              touched.current = true;
              setI(k);
            }}>
            <span className="num">{k + 1}</span>
            {st.name}
          </button>
        ))}
      </div>
      <div className="l-stage" role="tabpanel" id="stage-panel" aria-labelledby={`stage-${i}`}>
        <div className="l-stage-viz" key={i}>
          <s.Viz />
        </div>
        <dl>
          <dt>Method</dt>
          <dd>{s.method}</dd>
          <dt>Inputs</dt>
          <dd>{s.inputs}</dd>
          <dt>Role in the pipeline</dt>
          <dd>{s.role}</dd>
        </dl>
      </div>
    </Section>
  );
}
