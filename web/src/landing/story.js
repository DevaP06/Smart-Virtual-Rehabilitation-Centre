// The single source of truth for the landing page's motion. Plain module state (no React state), so scroll and pointer never re-render anything.
//
//   scroll position -> u (a fractional section index) -> camera pose, scene weights, arrangement morph
//
// Everything visual is a pure function of (u, story): scrolling backwards therefore restores the earlier state by construction.
// Native scrolling is never touched (no smooth-scroll library, no scroll hijacking, no pinning).
import { useSyncExternalStore } from "react";

export const SCENES = ["overview", "problem", "demand", "constraints", "optimization", "results", "route", "features", "engine", "finale"];
// The DOM section that anchors each scene, in page order.
export const SECTION_IDS = ["hero", "problem", "demand", "spatial", "transform", "results", "route", "features", "engine", "final"];

const CX = 8.5;
// Camera keyframes: where the camera sits when that section is centred on screen. `shift` moves the model sideways on screen (fraction of
// the viewport width) to leave room for the text column; `dim` fades the 3D layer behind busy content.
const RAW = [
  { pos: [CX - 17.5, 16, -13], target: [CX + 0.5, 0.6, 5.6], shift: 0.2, dim: 1 }, // overview: elevated three-quarter view
  { pos: [CX - 10, 7.2, -6.5], target: [CX + 1.5, 0.8, 6.5], shift: 0.2, dim: 1 }, // problem: lower, closer to the aisles
  { pos: [CX + 13, 13.5, -6], target: [CX - 1, 1, 7.5], shift: 0.2, dim: 1 }, // demand: rises and swings round for a broad view
  { pos: [CX + 0.6, 2.6, 1.6], target: [6.4, 1.6, 6.4], shift: 0.2, dim: 1 }, // constraints: inside aisle 1, looking at one rack face
  { pos: [CX - 12, 12.5, -9], target: [CX, 0.8, 5.5], shift: 0.2, dim: 1 }, // optimization: back out to a broad view
  { pos: [CX - 3, 21, -3], target: [CX, 0, 6], shift: 0, dim: 0.34 }, // results: high and centred, dimmed behind the metric cards
  { pos: [CX - 4.5, 3.4, -4.8], target: [CX, 0.5, 4.5], shift: 0.2, dim: 1 }, // route: near the floor, following the picker
  { pos: [CX - 13, 15, -12], target: [CX, 0.6, 5.8], shift: 0, dim: 0.36 }, // features: calm overview behind the cards
  { pos: [CX - 14, 15, -12], target: [CX, 0.6, 5.8], shift: 0, dim: 0.4 }, // engine: calm overview behind the explorer
  { pos: [CX - 15, 13.5, -11], target: [CX, 0.6, 5.8], shift: 0.2, dim: 1 }, // finale: clean overview
];
// Pull each pose back from its target so the model never swamps the text column; the in-aisle pose stays close on purpose.
const FAR = [1.3, 1.32, 1.3, 1.12, 1.3, 1.1, 1.45, 1.1, 1.1, 1.1];
export const KEYS = RAW.map((k, i) => ({ ...k, pos: k.target.map((t, n) => t + (k.pos[n] - t) * FAR[i]), shift: k.shift ? 0.27 : 0 }));

export const story = {
  u: 0,
  scene: SCENES[0],
  px: 0, // pointer, -1..1 across the viewport
  py: 0,
  tween: 0, // baseline (0) -> optimized (1) morph, owned by the Optimization section
  compare: false, // Optimization section's "Compare" mode: keep the faded baseline route
  route: "base", // Route section toggle: "base" | "opt"
  walk: -1, // picker progress along the chosen route, -1 = no picker
  demandStep: 0, // Demand section step 0..2
  spatialShown: 0, // how many spatial candidates have been checked, 0..4
  intro: 0, // hero entrance progress 0..1
  stage: false, // true when the fixed 3D stage is the page's backdrop (desktop)
  tr: { active: false, t: 0 }, // dashboard transition clock in seconds
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () => listeners.forEach((fn) => fn());
/** Merge values into the story and tell the scene / background. Cheap: no React involved. */
export function patch(p) {
  Object.assign(story, p);
  emit();
}
/** Discrete scene name for the few React components that need it. */
export const useScene = () => useSyncExternalStore(subscribe, () => story.scene);

/* ---------------------------------------------------------------- maths */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** How strongly scene `i` is in effect at u: 1 around its anchor, 0 one section away. */
export const weight = (i, u) => clamp01(1.6 - 1.6 * Math.abs(u - i));

export function cameraAt(u) {
  const i = Math.min(KEYS.length - 2, Math.max(0, Math.floor(u)));
  const k = smooth(0.12, 0.88, clamp01(u - i)); // holds near each anchor so text stays readable, moves between them
  const a = KEYS[i];
  const b = KEYS[i + 1];
  return {
    pos: a.pos.map((v, n) => lerp(v, b.pos[n], k)),
    target: a.target.map((v, n) => lerp(v, b.target[n], k)),
    shift: lerp(a.shift, b.shift, k),
    dim: lerp(a.dim, b.dim, k),
  };
}

/**
 * What the warehouse should show at (u, story): the arrangement morph and how visible each route is.
 * A = 0 baseline arrangement, 1 optimized. Each section owns its own stretch of the page; the blends between them are smooth.
 */
export function visuals(u, s = story) {
  if (s.tr.active) {
    // dashboard transition: the warehouse settles into its optimized state while the camera walks the aisle
    const t = s.tr.t;
    return { A: smooth(0.3, 1.5, t), baseOp: 1 - smooth(0.3, 0.9, t), optOp: smooth(0.4, 1.1, t), baseDraw: 1, attention: 0, demand: 0, constraints: 0, picker: 0 };
  }
  const w = (i) => weight(i, u);
  let A = lerp(0, s.tween, smooth(3.3, 3.8, u)); // optimization section: the morph the visitor controls
  A = lerp(A, 1, smooth(4.2, 4.7, u)); // results: settled
  A = lerp(A, s.route === "opt" ? 1 : 0, smooth(5.3, 5.8, u)); // route section follows its toggle
  A = lerp(A, 1, smooth(6.2, 6.7, u)); // engine + finale
  const baseOp = Math.max(w(0) * 0.9, w(1), w(4) * (s.compare ? 0.55 : 1 - smooth(0.05, 0.35, A)), w(6) * (s.route === "opt" ? 0 : 1));
  const optOp = Math.max(w(4) * smooth(0.7, 1, A), w(5), w(6) * (s.route === "opt" ? 1 : 0), w(7) * 0.6, w(8) * 0.6, w(9) * 0.9);
  return {
    A,
    baseOp,
    optOp,
    baseDraw: u < 1.2 ? clamp01(Math.max(w(0), 1.4 * w(1))) : 1, // the problem route draws itself as the section arrives
    attention: w(1), // rings on the misplaced products
    demand: Math.max(w(2), w(3) * 0.35), // class colours / sizes
    constraints: w(3),
    picker: w(6),
  };
}

/* ---------------------------------------------------------------- scroll tracking */
let anchors = [];
function measure() {
  const vh = window.innerHeight;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
  const raw = SECTION_IDS.map((id, i) => {
    if (i === 0) return 0;
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.top + window.scrollY + r.height / 2 - vh / 2;
  });
  let prev = -1;
  anchors = raw.map((v, i) => {
    const a = Math.min(maxScroll, Math.max(prev + 1, v ?? prev + 1));
    prev = a;
    return a;
  });
}

function compute(reduced) {
  const y = window.scrollY;
  let u = 0;
  if (anchors.length) {
    const n = anchors.length - 1;
    if (y >= anchors[n]) u = n;
    else {
      let i = 0;
      while (i < n - 1 && y >= anchors[i + 1]) i++;
      u = i + clamp01((y - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]));
    }
  }
  if (reduced) u = Math.round(u); // reduced motion: static states, no travelling camera
  if (u !== story.u) {
    story.u = u;
    story.scene = SCENES[Math.round(u)] || SCENES[0];
    emit();
  }
}

/** Starts following the page scroll. Returns the cleanup. */
export function trackScroll(reduced) {
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      compute(reduced);
    });
  };
  const remeasure = () => {
    measure();
    compute(reduced);
  };
  remeasure();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", remeasure);
  // Sections change height as data loads and as they animate in: re-measure when the page height changes.
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
  ro?.observe(document.body);
  const late = setTimeout(remeasure, 600); // fonts / first paint
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(late);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", remeasure);
    ro?.disconnect();
    patch({ u: 0, scene: SCENES[0], intro: 0, tween: 0, compare: false, route: "base", walk: -1, demandStep: 0, spatialShown: 0, stage: false, tr: { active: false, t: 0 } });
  };
}

/** Pointer position for the (small) parallax. Written to plain fields: no state, no re-render. */
export function trackPointer() {
  const move = (e) => {
    story.px = (e.clientX / window.innerWidth) * 2 - 1;
    story.py = (e.clientY / window.innerHeight) * 2 - 1;
    emit();
  };
  window.addEventListener("pointermove", move, { passive: true });
  return () => window.removeEventListener("pointermove", move);
}
