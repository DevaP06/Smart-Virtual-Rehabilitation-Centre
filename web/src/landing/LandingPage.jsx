// Landing page for The Living Warehouse. Sits outside the dashboard shell and is reached at #home (the default when the URL has no hash).
// Desktop: the 3D warehouse is a fixed backdrop and the page is a scroll-driven journey through it (see story.js). Tablet / phone / reduced
// motion: the hero keeps a smaller 3D card and each section shows its own diagram. The dashboard never depends on any of it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Compass } from "lucide-react";
import Logo from "../components/Logo.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import LivingBackground from "./LivingBackground.jsx";
import Plan from "./Plan.jsx";
import Stage from "./Stage.jsx";
import Bridge from "./Bridge.jsx";
import { StageCtx } from "./parts.jsx";
import { useReducedMotion } from "./hooks.js";
import { useResults } from "./useResults.js";
import { ITEMS, ORDER_IDS, itemXZ, routePoints } from "./sceneData.js";
import { emit, patch, story, trackPointer, trackScroll } from "./story.js";
import ProblemSection from "./sections/ProblemSection.jsx";
import DemandSection from "./sections/DemandSection.jsx";
import SpatialSection from "./sections/SpatialSection.jsx";
import TransformSection from "./sections/TransformSection.jsx";
import ResultsSection from "./sections/ResultsSection.jsx";
import RouteSection from "./sections/RouteSection.jsx";
import AlgorithmSection from "./sections/AlgorithmSection.jsx";
import FeaturesSection from "./sections/FeaturesSection.jsx";
import "./landing.css";

const DESTINATION = "overview";
const CINEMATIC_S = 2.9; // real length of the walk-in transition, in seconds
const CHOREO_S = 3.3; // length the camera / carton choreography was authored for; played slightly faster to fit

const webglOk = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};
// 3D is skipped on devices that report very little memory; the static plan carries the same message.
const canRun3D = () => webglOk() && !(navigator.deviceMemory && navigator.deviceMemory <= 2);

function useStageMode() {
  const reduced = useReducedMotion();
  const query = "(min-width: 1000px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setWide(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const [failed, setFailed] = useState(false);
  const ok = useMemo(canRun3D, []);
  const fail = useCallback(() => setFailed(true), []);
  return { stage: wide && ok && !reduced && !failed, inline3D: ok && !failed, reduced, fail };
}

function StaticHero() {
  const items = ITEMS.map((it) => {
    const [x, z] = itemXZ(it, "base");
    return { id: it.id, cls: it.cls, x, z, hot: ORDER_IDS.includes(it.id), dim: !ORDER_IDS.includes(it.id) };
  });
  return <Plan className="hero-plan" label="Top-down plan of an illustrative warehouse with a pick route to one order of five products." items={items} routes={[{ pts: routePoints("base"), tone: "base" }]} />;
}

/** The click on Get Started. Desktop with the 3D scene ready: a 3.3 s walk up an aisle, into a carton, out into the dashboard. Otherwise a short fade. */
function useActivation(onEnter, cinematicOK, reduced) {
  const [phase, setPhase] = useState("idle"); // idle | running
  const [kind, setKind] = useState("short"); // cinematic | short
  const busy = useRef(false); // double-click guard
  const raf = useRef(0);
  const timers = useRef([]);
  const clear = () => {
    cancelAnimationFrame(raf.current);
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(
    () => () => {
      clear(); // nothing outlives the page
      patch({ tr: { active: false, t: 0 } });
    },
    [],
  );
  const enter = useCallback(() => {
    clear();
    onEnter(DESTINATION);
  }, [onEnter]);
  const begin = () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("running");
    if (reduced) {
      setKind("short");
      timers.current.push(setTimeout(enter, 250));
    } else if (cinematicOK) {
      setKind("cinematic");
      const t0 = performance.now();
      patch({ tr: { active: true, t: 0 } });
      const loop = (now) => {
        const t = (now - t0) / 1000;
        story.tr.t = (t * CHOREO_S) / CINEMATIC_S;
        emit();
        if (t >= CINEMATIC_S) enter();
        else raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } else {
      setKind("short");
      timers.current.push(setTimeout(enter, 700));
    }
  };
  return { phase, kind, begin, skip: enter };
}

function Hero({ mode, activation, onSettled }) {
  const { stage, inline3D, fail } = mode;
  const { phase, kind, begin } = activation;
  const running = phase === "running";
  return (
    <header className="hero l-wrap">
      <div className="hero-copy">
        <p className="l-eyebrow">WAREHOUSE INTELLIGENCE / SLOT OPTIMIZATION</p>
        <h1>
          <span className="mask"><span>Every</span></span> <span className="mask"><span>Slot Has</span></span> <span className="mask"><span>a Strategy.</span></span>
        </h1>
        <p className="hero-lead">Transform warehouse data into intelligent storage decisions. Reduce picking distance, improve space utilization, and validate every layout against operational constraints.</p>
        <div className="hero-cta">
          <button type="button" className={`btn primary big${running ? " busy" : ""}`} onClick={begin} disabled={running} aria-live="polite">
            {running ? "ENTERING WAREHOUSE" : (
              <>
                Get Started <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
            {running && <span className="btn-progress" aria-hidden="true" style={{ animationDuration: kind === "cinematic" ? `${CINEMATIC_S}s` : "0.7s" }} />}
          </button>
          <button type="button" className="btn big" onClick={() => document.getElementById("problem")?.scrollIntoView({ behavior: "smooth" })}>
            <Compass size={18} aria-hidden="true" /> Explore the Engine
          </button>
        </div>
        <p className="hero-caps">DEMAND-AWARE · CONSTRAINT-VALIDATED · SIMULATION-TESTED</p>
      </div>
      {!stage && (
        <div className="hero-stage">
          {inline3D ? <Stage fixed={false} fallback={<StaticHero />} onSettled={onSettled} onFail={fail} skipIntro={mode.reduced} /> : <StaticHero />}
        </div>
      )}
    </header>
  );
}

export default function LandingPage({ onEnter }) {
  const res = useResults();
  const mode = useStageMode();
  const { stage, reduced, fail } = mode;
  const [ready, setReady] = useState(false); // the 3D scene has finished its entrance
  const activation = useActivation(onEnter, stage && ready, reduced);

  // Desktop: follow the scroll and the pointer. All of it is plain module state (story.js); React never re-renders for it.
  useEffect(() => {
    if (!stage) return undefined;
    const stopScroll = trackScroll(false);
    const stopPointer = trackPointer();
    patch({ stage: true });
    return () => {
      stopScroll();
      stopPointer();
    };
  }, [stage]);

  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const links = useMemo(
    () => [
      ["problem", "The problem"],
      ["transform", "Optimization"],
      ["results", "Results"],
      ["features", "Features"],
      ["engine", "Engine"],
    ],
    [],
  );
  const running = activation.phase === "running";
  return (
    <StageCtx.Provider value={stage}>
      <div className={`landing${stage ? " lw-on" : ""}${running ? ` is-entering is-${activation.kind}` : ""}`}>
        <a className="skip-link" href="#top" onClick={(e) => { e.preventDefault(); document.getElementById("top")?.focus(); }}>
          Skip to content
        </a>
        <LivingBackground />
        {stage && <Stage fixed fallback={null} onSettled={() => setReady(true)} onFail={fail} />}
        <nav className="l-nav" aria-label="Landing page">
          <div className="l-wrap l-nav-in">
            <button className="l-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="The Living Warehouse, back to top">
              <Logo size={24} /> <span>The Living Warehouse</span>
            </button>
            <div className="l-nav-links">
              {links.map(([id, t]) => (
                <button key={id} onClick={() => go(id)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="l-nav-tools">
              <ThemeToggle />
              <a className="btn small" href={`#${DESTINATION}`}>
                Open dashboard
              </a>
            </div>
          </div>
        </nav>
        <main id="top" tabIndex={-1}>
          <section id="hero" aria-label="Introduction">
            <Hero mode={mode} activation={activation} onSettled={() => setReady(true)} />
          </section>
          <ProblemSection />
          <DemandSection />
          <SpatialSection />
          <TransformSection res={res} />
          <ResultsSection res={res} onEnter={onEnter} />
          <RouteSection res={res} onEnter={onEnter} />
          <FeaturesSection res={res} onEnter={onEnter} />
          <AlgorithmSection />
          <section id="final" className="l-final l-wrap" aria-labelledby="final-h">
            <h2 id="final-h">Put every product where it earns its place.</h2>
            <p>Open the workspace to explore the stored results, inspect the layout in 3D, or run live operations.</p>
            <a className="btn primary big" href={`#${DESTINATION}`}>
              Open the workspace <ArrowRight size={18} aria-hidden="true" />
            </a>
          </section>
        </main>
        <footer className="l-footer">
          <div className="l-wrap">
            <b>The Living Warehouse</b> · Every slot has a strategy.
            <p>
              Results shown are simulated on stored order data; SKU dimensions, hazard classes and the warehouse grid are synthetic, and the time model is assumed. Scenes and examples on this page are illustrative and labelled as such.
            </p>
          </div>
        </footer>
        {running && (
          <button type="button" className="btn small l-skip" onClick={activation.skip}>
            Skip animation
          </button>
        )}
        {running && activation.kind === "cinematic" && <Bridge />}
        <div className="l-fade" aria-hidden="true" />
      </div>
    </StageCtx.Provider>
  );
}
