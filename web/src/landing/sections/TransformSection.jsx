import { useEffect, useMemo, useRef, useState } from "react";
import Plan from "../Plan.jsx";
import { Illustrative, Section, useStage } from "../parts.jsx";
import { patch } from "../story.js";
import { useInView, useTween } from "../hooks.js";
import { ITEMS, ORDER_IDS, movePath, pointAt, routePoints } from "../sceneData.js";
import { Segmented, fmt } from "../../ui.jsx";

const MODES = [
  { value: "baseline", label: "Baseline" },
  { value: "optimized", label: "Optimized" },
  { value: "compare", label: "Compare" },
];
const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export default function TransformSection({ res }) {
  const stage = useStage();
  const [ref, seen] = useInView(0.45);
  const [mode, setMode] = useState("baseline");
  const touched = useRef(false);
  const v = useTween(mode === "baseline" ? 0 : 1, 1900);

  // Plays baseline -> optimized once on first view, unless the visitor has already picked a mode.
  useEffect(() => {
    if (!seen) return undefined;
    const t = setTimeout(() => !touched.current && setMode("optimized"), 1100);
    return () => clearTimeout(t);
  }, [seen]);

  const compare = mode === "compare";
  useEffect(() => patch({ tween: v, compare }), [v, compare]); // the 3D warehouse morphs with the same value

  const paths = useMemo(() => ITEMS.map(movePath), []);
  const items = ITEMS.map((it, i) => {
    const [x, z] = pointAt(paths[i], v);
    const hot = ORDER_IDS.includes(it.id);
    return { id: it.id, cls: it.cls, x, z, hot, dim: !hot };
  });
  const routes = [
    { pts: routePoints("base"), tone: "base", opacity: compare ? 0.55 : 1 - smooth(0.05, 0.35, v) },
    { pts: routePoints("opt"), tone: "opt", opacity: smooth(0.7, 1, v) },
  ];

  return (
    <Section id="transform" n="04" eyebrow="Optimization" title="From random placement to intelligent slotting." lead="The same eight products and the same customer order, before and after slotting. Products travel along the aisles, never through the racks.">
      <figure className={`l-figure wide${stage ? " compact" : ""}`} ref={ref}>
        <div className="l-controls">
          <Segmented
            label="Layout shown"
            value={mode}
            onChange={(m) => {
              touched.current = true;
              setMode(m);
            }}
            options={MODES}
          />
          <Illustrative />
        </div>
        {!stage && (
          <Plan
            label={`Top-down plan of an illustrative warehouse showing the ${mode} arrangement of eight products and the picker's route for one order.`}
            items={items}
            routes={routes}
          />
        )}
        <figcaption className="l-summary" aria-live="polite">
          {mode === "baseline" && "Baseline: fast movers sit wherever space was free, so the route crosses all three aisles."}
          {mode === "optimized" && "Optimized: the order's products and their bought-together partners sit side by side near dispatch, so one short trip covers the order."}
          {compare && "Compare: the baseline route (faded) and the optimized route over the optimized arrangement."}
        </figcaption>
      </figure>
      <p className="l-measured">
        {res.status === "ready" ? (
          <>
            <b>Measured, not illustrated:</b> on the {res.data.scenario} scenario the real optimizer cut walking distance by <b>{fmt(res.data.distReduction)}%</b> and route time by <b>{fmt(res.data.timeReduction)}%</b> versus a random rule-compliant layout, on {res.data.nTest.toLocaleString()} orders it had never seen.
          </>
        ) : (
          <span className="muted">Measured results are shown below once the stored results load.</span>
        )}
      </p>
    </Section>
  );
}
