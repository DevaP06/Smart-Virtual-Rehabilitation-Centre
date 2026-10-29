import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import Plan from "../Plan.jsx";
import { Illustrative, Section, useStage } from "../parts.jsx";
import { patch } from "../story.js";
import { useReducedMotion } from "../hooks.js";
import { ITEMS, ORDER_IDS, itemXZ, pointAt, routePoints } from "../sceneData.js";
import { Segmented, fmt } from "../../ui.jsx";

const MS = 5200; // one full walk of the illustrative route

export default function RouteSection({ res, onEnter }) {
  const stage = useStage();
  const reduced = useReducedMotion();
  const [which, setWhich] = useState("base");
  const [d, setD] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const pts = useMemo(() => routePoints(which), [which]);

  useEffect(() => {
    if (!playing) return undefined;
    const from = d >= 1 ? 0 : d;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, from + (now - t0) / MS);
      setD(k);
      if (k < 1) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => patch({ route: which === "opt" ? "opt" : "base", walk: d > 0 ? d : -1 }), [which, d]); // the 3D picker walks the same route

  const items = ITEMS.map((it) => {
    const [x, z] = itemXZ(it, which === "opt" ? "opt" : "base");
    const hot = ORDER_IDS.includes(it.id);
    return { id: it.id, cls: it.cls, x, z, hot, dim: !hot };
  });
  const r = res.status === "ready" ? res.data : null;

  return (
    <Section id="route" n="06" eyebrow="Route intelligence" title="Better placement means less unnecessary movement." lead="The same order, picked on the baseline arrangement and on the optimized one. Press play to follow the picker.">
      <div className="l-split">
        <figure className="l-figure">
          <div className="l-controls">
            <Segmented
              label="Route shown"
              value={which}
              onChange={(v) => {
                setPlaying(false);
                setD(reduced ? 1 : 0);
                setWhich(v);
              }}
              options={[
                { value: "base", label: "Baseline route" },
                { value: "opt", label: "Optimized route" },
              ]}
            />
            <div className="btn-row">
              <button className="btn small" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause the picker" : "Play the picker"}>
                {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {playing ? "Pause" : "Play"}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setPlaying(false);
                  setD(0);
                }}
                aria-label="Reset the picker to the dispatch area"
              >
                <RotateCcw size={15} aria-hidden="true" /> Reset
              </button>
            </div>
          </div>
          {!stage && (
            <Plan
              label={`Top-down plan showing the picker's ${which === "opt" ? "optimized" : "baseline"} route for one order of five products.`}
              items={items}
              routes={[{ pts, tone: which === "opt" ? "opt" : "base" }]}
              walker={d > 0 ? pointAt(pts, d) : null}
            />
          )}
          <figcaption>
            <Illustrative>Illustrative route drawing</Illustrative> The drawing explains the idea; the numbers on the right are measured.
          </figcaption>
        </figure>
        <div className="l-copy">
          <h3>Measured in the stored simulation</h3>
          {r ? (
            <dl className="l-stats">
              <div>
                <dt>Walking per order, random layout</dt>
                <dd className="num">{fmt(r.distPerOrder[0], 0)} m</dd>
              </div>
              <div>
                <dt>Walking per order, {r.scenario} headline layout</dt>
                <dd className="num">{fmt(r.distPerOrder[1], 0)} m</dd>
              </div>
              <div>
                <dt>Route time per order</dt>
                <dd className="num">
                  {fmt(r.time[0], 0)} s → {fmt(r.time[1], 0)} s
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">{res.status === "loading" ? "Loading the stored results…" : "Measured route figures are unavailable right now."}</p>
          )}
          <p className="muted">Distances use the standard return-route policy on held-out orders; time uses an assumed time model (walking speed, seconds per pick, shelf-height penalty).</p>
          <button className="btn primary" onClick={() => onEnter("path")}>
            Open the Pick Path Simulator
          </button>
        </div>
      </div>
    </Section>
  );
}
