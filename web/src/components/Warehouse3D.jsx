// Optional 3D view of a stored layout. Loaded on demand (lazy) so the rest of the dashboard never pays for it.
// Every box is a real bin from the stored layout; nothing here is simulated. Empty bins are drawn only when the grid is the regular
// aisle x side x bay x level x bin grid (checked against the stored bin count), because the API does not list empty bins.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EmptyState, fmt } from "../ui.jsx";
import { sceneColors, useTheme } from "../theme.js";
import { Cuboid } from "lucide-react";
import { Environment, Floor, RackFrames, lanesFor } from "./sceneKit.jsx";

export const STOPS = ["#440154", "#3b528b", "#21908d", "#5dc963", "#fde725"].map((c) => new THREE.Color(c));
export const ramp = (t) => {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  return STOPS[i].clone().lerp(STOPS[i + 1], x - i);
};
export const hasWebGL = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};

const LEVEL_Z = [20, 70, 120, 170, 220];
export const BOX = [0.7, 0.4, 0.5]; // width across the aisle, height, depth along the aisle (metres)

function useGeometry(rows, grid, config, nBins) {
  return useMemo(() => {
    const levelZ = config.level_z || LEVEL_Z;
    const bins = config.bins || 2;
    // x is negated so aisle 0 is on the left and numbers grow to the right, matching the 2D heatmaps from the default camera.
    const pos = (aisle, side, bay, level, bin, x, y) => [-(x + (side === 0 ? -0.75 : 0.75)), levelZ[level - 1] / 100 + BOX[1] / 2, y + (bin === 0 ? -0.3 : 0.3)];
    const placed = rows.map((r) => pos(r.aisle, r.side, r.bay, r.level, r.bin, r.x, r.y));
    let ghosts = [];
    const regular = grid.aisles * 2 * grid.bays * 5 * bins === nBins && rows.every((r) => Math.abs(r.x - r.aisle * config.aisle_pitch) < 1e-6 && Math.abs(r.y - (config.y0 + r.bay * config.bay_pitch)) < 1e-6);
    if (regular) {
      const taken = new Set(rows.map((r) => `${r.aisle}-${r.side}-${r.bay}-${r.level}-${r.bin}`));
      for (let a = 0; a < grid.aisles; a++)
        for (let s = 0; s < 2; s++)
          for (let b = 0; b < grid.bays; b++)
            for (let l = 1; l <= 5; l++)
              for (let n = 0; n < bins; n++)
                if (!taken.has(`${a}-${s}-${b}-${l}-${n}`)) ghosts.push({ aisle: a, level: l, p: pos(a, s, b, l, n, a * config.aisle_pitch, config.y0 + b * config.bay_pitch) });
    }
    const xs = placed.map((p) => p[0]);
    const zs = placed.map((p) => p[2]);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1), maxZ = Math.max(...zs, 1);
    return { placed, ghosts, regular, bounds: { minX, maxX, maxZ, cx: (minX + maxX) / 2, cz: maxZ / 2, span: Math.max(maxX - minX, maxZ) + 6 } };
  }, [rows, grid, config, nBins]);
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const SORT_S = 1.5; // the whole sort takes this long; each box moves for 0.7 s, the fastest products first
const LIFT = 3.2; // boxes rise this far above the racks while they travel, so they never pass through a rack

/**
 * One instanced mesh for every occupied bin. When `animate` is set and the layout changes (baseline <-> proposed), every box that has to move
 * lifts out of its bin, travels over the racks and settles in its new bin, the fastest-moving products first. Colour follows the product
 * (its demand), so a box keeps its colour while it moves. `shown` remembers where each product was drawn last.
 */
function Bins({ rows, placed, level, highlight, marked, onHover, shown, animate }) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef(null);
  const cur = useRef(new Float32Array(rows.length * 3));
  const logMax = useMemo(() => Math.log1p(Math.max(1, ...rows.map((r) => r.velocity))), [rows]);

  const paint = () => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const a = anim.current;
    rows.forEach((r, i) => {
      const to = placed[i];
      let x = to[0], y = to[1], z = to[2];
      if (a) {
        const u = Math.min(1, Math.max(0, (a.t - a.rank[i] * 0.8) / 0.7));
        const e = ease(u);
        const fx = a.from[i * 3], fy = a.from[i * 3 + 1], fz = a.from[i * 3 + 2];
        x = fx + (to[0] - fx) * e;
        y = fy + (to[1] - fy) * e + Math.sin(Math.PI * u) * (a.moves[i] ? LIFT : 0);
        z = fz + (to[2] - fz) * e;
      }
      cur.current[i * 3] = x;
      cur.current[i * 3 + 1] = y;
      cur.current[i * 3 + 2] = z;
      const show = level === "all" || r.level === Number(level);
      o.position.set(x, y, z);
      o.scale.setScalar(show ? 0.94 : 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    shown.current.pos = cur.current;
    invalidate();
  };

  // colours: they depend on the product and the highlight, never on where the box is
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const dim = new THREE.Color(sceneColors().bin1);
    rows.forEach((r, i) => {
      const c = ramp(Math.log1p(r.velocity) / logMax);
      if (highlight != null && r.aisle !== highlight) c.multiplyScalar(0.28);
      if (marked && !marked.has(r.sku)) c.lerp(dim, 0.82); // only the marked products stay bright; the rest fade into a neutral tone
      m.setColorAt(i, c);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [rows, highlight, marked, logMax, invalidate]);

  // a different layout arrived: start the sort (if allowed) from where each product was last drawn
  useLayoutEffect(() => {
    const prev = shown.current;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    anim.current = null;
    if (animate && !reduced && prev.rows && prev.rows !== rows && prev.pos) {
      const idx = new Map(prev.skus.map((sku, j) => [sku, j]));
      const from = new Float32Array(rows.length * 3);
      const moves = new Uint8Array(rows.length);
      let moved = 0;
      rows.forEach((r, i) => {
        const j = idx.get(r.sku);
        const f = j != null ? [prev.pos[j * 3], prev.pos[j * 3 + 1], prev.pos[j * 3 + 2]] : placed[i];
        from.set(f, i * 3);
        if (Math.abs(f[0] - placed[i][0]) + Math.abs(f[1] - placed[i][1]) + Math.abs(f[2] - placed[i][2]) > 1e-6) {
          moves[i] = 1;
          moved += 1;
        }
      });
      if (moved) {
        const rank = new Float32Array(rows.length);
        rows
          .map((_, i) => i)
          .sort((p, q) => rows[q].velocity - rows[p].velocity)
          .forEach((i, k) => (rank[i] = k / Math.max(1, rows.length - 1)));
        anim.current = { t: 0, from, rank, moves };
      }
    }
    shown.current = { rows, skus: rows.map((r) => r.sku), pos: cur.current };
    paint();
  }, [rows, placed]); // eslint-disable-line react-hooks/exhaustive-deps -- paint reads the latest props through its closure on each call

  useLayoutEffect(() => paint(), [level]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a) return;
    a.t += Math.min(dt, 0.12); // real time, but a long stall (a background tab, a slow frame) cannot skip the move
    if (a.t >= SORT_S) anim.current = null;
    paint();
  });

  return (
    <instancedMesh
      key={rows.length}
      ref={ref}
      args={[undefined, undefined, rows.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(e.instanceId, e.nativeEvent);
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={BOX} />
      <meshStandardMaterial roughness={0.6} metalness={0.08} />
    </instancedMesh>
  );
}

function Ghosts({ ghosts, level, highlight }) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    ghosts.forEach((g, i) => {
      const show = (level === "all" || g.level === Number(level)) && (highlight == null || g.aisle === highlight);
      o.position.set(...g.p);
      o.scale.setScalar(show ? 0.94 : 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [ghosts, level, highlight, invalidate]);
  if (!ghosts.length) return null;
  return (
    <instancedMesh key={ghosts.length} ref={ref} args={[undefined, undefined, ghosts.length]} raycast={() => null}>
      <boxGeometry args={BOX} />
      <meshBasicMaterial color={sceneColors().ghost} wireframe transparent opacity={sceneColors().ghostOpacity * 0.3} depthWrite={false} />
    </instancedMesh>
  );
}

export function Controls({ target, span }) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.target.set(...target);
    c.maxPolarAngle = Math.PI * 0.49;
    c.minDistance = Math.max(4, span * 0.15);
    c.maxDistance = span * 3;
    c.addEventListener("change", invalidate);
    c.update();
    return () => {
      c.removeEventListener("change", invalidate);
      c.dispose();
    };
  }, [camera, gl, invalidate, target, span]);
  return null;
}

/**
 * `marked` (optional Set of SKU ids) keeps those products bright and dims the rest; `velocityText` names what the demand number in the hover card is;
 * `animate` makes a switch between two layouts of the same warehouse play as boxes being sorted into their new bins.
 */
export default function Warehouse3D({ rows, grid, config, nBins, level, highlightAisle, marked, animate = false, velocityText = "pick lines in training" }) {
  const theme = useTheme();
  const sc = sceneColors(theme);
  const { placed, ghosts, regular, bounds } = useGeometry(rows, grid, config, nBins);
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const shown = useRef({ rows: null, skus: [], pos: null });
  const webgl = useMemo(hasWebGL, []);
  const target = useMemo(() => [bounds.cx, 1, bounds.cz], [bounds.cx, bounds.cz]);
  const framePts = useMemo(() => [...placed, ...ghosts.map((g) => g.p)], [placed, ghosts]);
  const lanes = useMemo(() => {
    if (typeof config.aisle_pitch !== "number" || !grid?.aisles) return [];
    const xs = Array.from({ length: grid.aisles }, (_, a) => -(a * config.aisle_pitch));
    return lanesFor(xs, config.y0 - 1.2, config.y0 + (grid.bays - 1) * config.bay_pitch + 1.2, bounds.minX - 5, bounds.maxX + 5);
  }, [config, grid, bounds]);
  if (!webgl) {
    return (
      <EmptyState icon={Cuboid} title="3D view isn't available in this browser">
        This view needs WebGL, which this browser or device has switched off. The heatmaps and the rack elevation show the same layout in 2D.
      </EmptyState>
    );
  }
  const onHover = (id, ev) => {
    if (id == null) return setHover(null);
    const r = box.current?.getBoundingClientRect();
    setHover({ id, x: ev.clientX - (r?.left || 0), y: ev.clientY - (r?.top || 0), w: r?.width || 0 });
  };
  const hr = hover != null ? rows[hover.id] : null;
  return (
    <div>
      <div className="viewport3d" ref={box} role="img" aria-label={`3D view of ${rows.length} occupied bins. Drag to rotate, scroll to zoom. Brighter boxes hold faster-moving products.`}>
        <Canvas key={theme} frameloop="demand" dpr={[1, 2]} camera={{ position: [bounds.cx, bounds.span * 0.48, -bounds.span * 0.56], fov: 45, near: 0.1, far: 1000 }} gl={{ antialias: true }} onPointerMissed={() => setHover(null)}>
          <Environment sc={sc} span={bounds.span} />
          <Floor cx={bounds.cx} cz={bounds.maxZ / 2} w={bounds.maxX - bounds.minX + 18} d={bounds.maxZ + 14} sc={sc} lanes={lanes} />
          <RackFrames points={framePts} bin={BOX} sc={sc} />
          <Ghosts ghosts={ghosts} level={level} highlight={highlightAisle} />
          <Bins rows={rows} placed={placed} level={level} highlight={highlightAisle} marked={marked} onHover={onHover} shown={shown} animate={animate} />
          <Controls target={target} span={bounds.span} />
        </Canvas>
        {hr && (
          <div className="hover-card" style={{ left: Math.min(hover.x + 14, hover.w - 250), top: hover.y + 14 }}>
            <b>{hr.sku}</b>
            <div>
              {hr.category} · class {hr.abc}
              {hr.hazard !== "none" ? ` · ${hr.hazard}` : ""}
            </div>
            <div>
              {hr.loc} · level {hr.level}
            </div>
            <div>{fmt(hr.velocity, 0)} {velocityText}</div>
          </div>
        )}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span>
          <span className="ramp" aria-hidden="true" /> low → high demand (log scale)
        </span>
        <span>
          <i style={{ background: sc.depot }} aria-hidden="true" /> depot
        </span>
        {regular && (
          <span>
            <i style={{ background: sc.ghost, opacity: 0.5 }} aria-hidden="true" /> empty bin
          </span>
        )}
        <span className="muted">Drag to rotate · scroll to zoom · right-drag to pan · hover a bin for details</span>
      </div>
    </div>
  );
}
