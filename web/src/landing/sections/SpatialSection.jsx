import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Illustrative, Section, useStage } from "../parts.jsx";
import { CANDS, PRODUCT, check } from "../spatialCases.js";
import { patch } from "../story.js";
import { useInView, useReducedMotion } from "../hooks.js";
import { RULE_LABEL } from "../../ui.jsx";

export default function SpatialSection() {
  const stage = useStage();
  const [ref, seen] = useInView(0.4);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? CANDS.length : 0);
  useEffect(() => {
    if (!seen) return undefined;
    if (reduced) {
      setShown(CANDS.length);
      return undefined;
    }
    const t = [...CANDS.keys()].map((i) => setTimeout(() => setShown(i + 1), 500 + i * 750));
    return () => t.forEach(clearTimeout);
  }, [seen, reduced]);

  useEffect(() => patch({ spatialShown: shown }), [shown]); // the 3D warehouse overlays the same checks
  return (
    <Section id="spatial" n="03" eyebrow="Spatial intelligence" title="Every product must fit. Every placement must be valid." lead="A bin is only a candidate if the product's size, weight and hazard class respect the bin, the shelf level and the rack. Anything else is never scored.">
      <div className="l-split">
        {!stage && (
        <figure className="l-figure" ref={ref}>
          <svg className="l-rack" viewBox="0 0 150 124" role="img" aria-label="Elevation of a rack with three bays and four levels. Four candidate bins are tested for one product; one is valid and three are rejected.">
            {[1, 2, 3, 4].map((lv) =>
              [0, 1, 2].map((bay) => {
                const ci = CANDS.findIndex((c) => c.cell[0] === bay && c.cell[1] === lv);
                const done = ci >= 0 && ci < shown;
                const r = ci >= 0 ? check(CANDS[ci]) : null;
                return (
                  <g key={`${bay}-${lv}`} transform={`translate(${6 + bay * 46} ${96 - (lv - 1) * 29})`}>
                    <rect className={`l-cell${done ? (r.ok ? " ok" : " no") : ""}${ci >= 0 ? " cand" : ""}`} width="42" height="25" rx="2" />
                    {done && (
                      <>
                        <rect className="l-box" x="9" y="7" width="24" height="15" rx="1.5" />
                        <text x="38" y="9" textAnchor="end" className="l-mark">
                          {r.ok ? "✓" : "✕"}
                        </text>
                      </>
                    )}
                    {ci >= 0 && (
                      <text x="3" y="9" className="l-cell-id">
                        {String.fromCharCode(65 + ci)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
          <figcaption>
            <Illustrative /> One example product, four example bins. Level 1 is the bottom shelf.
          </figcaption>
        </figure>
        )}
        <div className="l-copy" ref={stage ? ref : undefined}>
          <p className="l-product">
            <b className="mono">{PRODUCT.id}</b> · {PRODUCT.dims.join(" × ")} cm · {PRODUCT.kg} kg · {PRODUCT.hazard}
          </p>
          <ol className="l-checks" aria-live="polite">
            {CANDS.map((c, i) => {
              const r = check(c);
              const done = i < shown;
              return (
                <li key={c.loc} className={done ? (r.ok ? "ok" : "no") : "wait"}>
                  <span className="l-check-ico" aria-hidden="true">
                    {done ? r.ok ? <Check size={15} /> : <X size={15} /> : null}
                  </span>
                  <div>
                    <b>
                      {String.fromCharCode(65 + i)} · <span className="mono">{c.loc}</span>
                    </b>
                    <span>{done ? (r.ok ? `Valid: ${r.why}` : `Rejected: ${RULE_LABEL[r.rule]}. ${r.why}`) : "Waiting to be checked…"}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="muted">The real rules: dimensions and volume, bin weight, shelf-beam and rack-frame load, hazard zones, fragile and heavy shelf levels, incompatible neighbours. An independent validator re-checks every placed product.</p>
        </div>
      </div>
    </Section>
  );
}
