import { useEffect, useRef, useState } from "react";
import { Illustrative, Section } from "../parts.jsx";
import { useInView, useReducedMotion } from "../hooks.js";
import { ITEMS } from "../sceneData.js";
import { patch } from "../story.js";

const STEPS = [
  { name: "Demand", text: "Every product has a demand: how often it appears in order lines. The bar is its share of the busiest product." },
  { name: "ABC classes", text: "Pareto / ABC analysis ranks products by demand. Class A is the small group that causes most of the picking; C is the long tail." },
  { name: "Bought together", text: "Products that appear in the same orders are linked by how often they are bought together. The optimizer pulls each product's top partners close together. (Lift, Jaccard similarity and Louvain groups describe the pairs on the Data Analysis page; they do not move products.)" },
];

// Tile positions (percent of the stage) per step: a grid, then columns by class, then columns by bought-together group.
const W = 22;
const H = 26;
function position(it, i, step) {
  if (step === 0) return [1 + (i % 4) * 25, 3 + Math.floor(i / 4) * 44];
  const key = step === 1 ? it.cls : String(it.grp);
  const cols = step === 1 ? ["A", "B", "C"] : ["1", "2", "3"];
  const members = ITEMS.filter((o) => (step === 1 ? o.cls : String(o.grp)) === key);
  return [2 + cols.indexOf(key) * 34, 2 + members.indexOf(it) * 31];
}
const maxW = Math.max(...ITEMS.map((i) => i.w));

export default function DemandSection() {
  const [ref, seen] = useInView(0.4);
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const touched = useRef(false);
  useEffect(() => patch({ demandStep: step }), [step]); // the 3D warehouse shows the same step

  // Plays through the three steps once when the section scrolls into view, unless the visitor has already chosen a step.
  useEffect(() => {
    if (!seen || reduced) return undefined;
    const timers = [setTimeout(() => !touched.current && setStep(1), 1500), setTimeout(() => !touched.current && setStep(2), 3300)];
    return () => timers.forEach(clearTimeout);
  }, [seen, reduced]);

  const pos = ITEMS.map((it, i) => position(it, i, step));
  const links = [];
  if (step === 2)
    [1, 2, 3].forEach((g) => {
      const m = ITEMS.map((it, i) => ({ it, i })).filter((x) => x.it.grp === g);
      for (let a = 0; a < m.length - 1; a++) links.push([pos[m[a].i], pos[m[a + 1].i]]);
    });

  return (
    <Section id="demand" n="02" eyebrow="Demand intelligence" title="Understand what moves before deciding where it belongs." lead="Placement starts from the order history, not from the shelf: which products are picked most, and which are picked together.">
      <div className="l-split reverse">
        <figure className="l-figure" ref={ref}>
          <div className="l-steps" role="group" aria-label="Demand analysis steps">
            {STEPS.map((s, i) => (
              <button
                key={s.name}
                type="button"
                aria-pressed={step === i}
                onClick={() => {
                  touched.current = true;
                  setStep(i);
                }}
              >
                <span className="num">{i + 1}</span> {s.name}
              </button>
            ))}
          </div>
          <div className="l-tiles" role="img" aria-label="Eight illustrative products shown as tiles with a demand bar. They regroup by demand class, then by bought-together group.">
            <svg className="l-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {links.map(([a, b], i) => (
                <line key={i} x1={a[0] + W / 2} y1={a[1] + H / 2} x2={b[0] + W / 2} y2={b[1] + H / 2} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {ITEMS.map((it, i) => (
              <div key={it.id} className={`l-tile cls-${it.cls}${seen ? " on" : ""}`} style={{ left: `${pos[i][0]}%`, top: `${pos[i][1]}%`, transitionDelay: step === 0 ? `${i * 50}ms` : "0ms" }}>
                <span className="l-tile-id">{it.id}</span>
                <span className="l-bar">
                  <i style={{ width: `${(it.w / maxW) * 100}%` }} />
                </span>
                <span className={`l-cls${step >= 1 ? " show" : ""}`}>Class {it.cls}</span>
              </div>
            ))}
          </div>
          <figcaption>
            <Illustrative /> Demand values are made up to show the idea.
          </figcaption>
        </figure>
        <div className="l-copy" aria-live="polite">
          <h3>
            {step + 1}. {STEPS[step].name}
          </h3>
          <p>{STEPS[step].text}</p>
          <p className="muted">The same signals feed the real optimizer: velocity and ABC class, pair affinity from the order history, and a weekly demand forecast for re-slotting.</p>
        </div>
      </div>
    </Section>
  );
}
