// Optional 3D view of a stored layout. Loaded on demand (lazy) so the rest of the dashboard never pays for it.
// Every box is a real bin from the stored layout; nothing here is simulated. Empty bins are drawn only when the grid is the regular
// aisle x side x bay x level x bin grid (checked against the stored bin count), because the API does not list empty bins.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EmptyState, fmt } from "../ui.jsx";
import { Cuboid } from "lucide-react";

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

function Bins({ rows, placed, level, highlight, onHover }) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const logMax = useMemo(() => Math.log1p(Math.max(1, ...rows.map((r) => r.velocity))), [rows]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    rows.forEach((r, i) => {
      const show = level === "all" || r.level === Number(level);
      o.position.set(...placed[i]);
      o.scale.setScalar(show ? 1 : 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      const c = ramp(Math.log1p(r.velocity) / logMax);
      if (highlight != null && r.aisle !== highlight) c.multiplyScalar(0.28);
      m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [rows, placed, level, highlight, logMax, invalidate]);
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
      <meshStandardMaterial roughness={0.55} metalness={0.1} />
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
      o.scale.setScalar(show ? 1 : 0);
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
      <meshBasicMaterial color="#4a6aa5" wireframe transparent opacity={0.2} depthWrite={false} />
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

export default function Warehouse3D({ rows, grid, config, nBins, level, highlightAisle }) {
  const { placed, ghosts, regular, bounds } = useGeometry(rows, grid, config, nBins);
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const webgl = useMemo(hasWebGL, []);
  const target = useMemo(() => [bounds.cx, 1, bounds.cz], [bounds.cx, bounds.cz]);
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
        <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [bounds.cx, bounds.span * 0.62, -bounds.span * 0.62], fov: 45, near: 0.1, far: 1000 }} gl={{ antialias: true }} onPointerMissed={() => setHover(null)}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[bounds.cx + 14, 26, -10]} intensity={1.2} />
          <gridHelper args={[Math.ceil(bounds.span * 1.4), Math.ceil(bounds.span * 1.4), "#27406b", "#16243f"]} position={[bounds.cx, 0, bounds.cz]} />
          <mesh position={[0, 0.12, -1]}>
            <boxGeometry args={[1.6, 0.24, 1.0]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
          <Ghosts ghosts={ghosts} level={level} highlight={highlightAisle} />
          <Bins rows={rows} placed={placed} level={level} highlight={highlightAisle} onHover={onHover} />
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
            <div>{fmt(hr.velocity, 0)} pick lines in training</div>
          </div>
        )}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span>
          <span className="ramp" aria-hidden="true" /> low → high demand (log scale)
        </span>
        <span>
          <i style={{ background: "#22d3ee" }} aria-hidden="true" /> depot
        </span>
        {regular && (
          <span>
            <i style={{ background: "#4a6aa5", opacity: 0.4 }} aria-hidden="true" /> empty bin
          </span>
        )}
        <span className="muted">Drag to rotate · scroll to zoom · right-drag to pan · hover a bin for details</span>
      </div>
    </div>
  );
}
