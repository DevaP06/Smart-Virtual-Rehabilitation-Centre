// Live 3D status of the warehouse: every bin from the stored structure, coloured by what is in it right now.
// Loaded on demand (lazy) like the layout 3D view. Colours: stock level, demand, low stock, or open work orders.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Cuboid } from "lucide-react";
import { EmptyState } from "../ui.jsx";
import { BOX, Controls, hasWebGL, ramp } from "./Warehouse3D.jsx";

const C = { empty: "#fb7185", low: "#fbbf24", ok0: "#15805a", ok1: "#34d399", dim: "#243553", task: "#22d3ee", move: "#a78bfa" };
const col = (hex) => new THREE.Color(hex);

/** Colour of one occupied bin for the chosen mode. */
export function binColor(r, mode, logMax) {
  if (mode === "demand") return ramp(Math.log1p(r.vel) / logMax);
  if (mode === "low") return r.status === "empty" ? col(C.empty) : r.status === "low" ? col(C.low) : col(C.dim);
  if (mode === "tasks") return r.tasks.includes("move") ? col(C.move) : r.tasks.length ? col(C.task) : col(C.dim);
  if (r.status === "empty") return col(C.empty);                                     // stock level
  if (r.status === "low") return col(C.low);
  return col(C.ok0).lerp(col(C.ok1), Math.min(1, r.qty / Math.max(1, r.cap)));
}

/** Where each bin sits. x is negated so aisle 0 is on the left, as in the layout view. Bins sharing a rack level are spread along the aisle. */
function useGeometry(bins, rows) {
  return useMemo(() => {
    const group = new Map();
    bins.forEach((b) => {
      const k = `${b.aisle}|${b.side}|${b.bay}|${b.level}`;
      group.set(k, (group.get(k) || 0) + 1);
    });
    const pos = bins.map((b) => {
      const n = group.get(`${b.aisle}|${b.side}|${b.bay}|${b.level}`);
      const step = Math.min(0.6, 1.2 / n);
      return [-b.x, b.z / 100 + BOX[1] / 2, b.y + (b.bin - (n - 1) / 2) * step];
    });
    const index = new Map(bins.map((b, i) => [b.loc, i]));
    const occ = [];
    rows.forEach((r) => {
      const i = index.get(r.loc);
      if (i != null) occ.push({ i, r, level: bins[i].level });
    });
    const taken = new Set(occ.map((o) => o.i));
    const ghosts = bins.map((b, i) => ({ i, level: b.level })).filter((g) => !taken.has(g.i));
    const xs = pos.map((p) => p[0]);
    const zs = pos.map((p) => p[2]);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1), maxZ = Math.max(...zs, 1);
    return { pos, occ, ghosts, bounds: { cx: (minX + maxX) / 2, cz: maxZ / 2, span: Math.max(maxX - minX, maxZ) + 6 } };
  }, [bins, rows]);
}

function Occupied({ geo, mode, level, selected, onHover, onSelect }) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const logMax = useMemo(() => Math.log1p(Math.max(1, ...geo.occ.map((o) => o.r.vel))), [geo]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    geo.occ.forEach((e, k) => {
      const show = level === "all" || e.level === Number(level);
      o.position.set(...geo.pos[e.i]);
      o.scale.setScalar(show ? 1 : 0);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      const c = binColor(e.r, mode, logMax);
      if (selected && selected !== e.r.loc) c.multiplyScalar(0.55);
      m.setColorAt(k, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [geo, mode, level, selected, logMax, invalidate]);
  return (
    <instancedMesh
      key={geo.occ.length}
      ref={ref}
      args={[undefined, undefined, geo.occ.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(e.instanceId, e.nativeEvent);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(geo.occ[e.instanceId]?.r.loc ?? null);
      }}
    >
      <boxGeometry args={BOX} />
      <meshStandardMaterial roughness={0.55} metalness={0.1} />
    </instancedMesh>
  );
}

function Ghosts({ geo, level }) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    geo.ghosts.forEach((g, k) => {
      o.position.set(...geo.pos[g.i]);
      o.scale.setScalar(level === "all" || g.level === Number(level) ? 1 : 0);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [geo, level, invalidate]);
  if (!geo.ghosts.length) return null;
  return (
    <instancedMesh key={geo.ghosts.length} ref={ref} args={[undefined, undefined, geo.ghosts.length]} raycast={() => null}>
      <boxGeometry args={BOX} />
      <meshBasicMaterial color="#4a6aa5" wireframe transparent opacity={0.16} depthWrite={false} />
    </instancedMesh>
  );
}

function Selection({ geo, loc }) {
  const e = geo.occ.find((o) => o.r.loc === loc);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => invalidate(), [loc, invalidate]);
  if (!e) return null;
  return (
    <mesh position={geo.pos[e.i]} raycast={() => null}>
      <boxGeometry args={[BOX[0] * 1.18, BOX[1] * 1.3, BOX[2] * 1.18]} />
      <meshBasicMaterial color="#ffffff" wireframe />
    </mesh>
  );
}

export const LEGEND = {
  fill: [[C.empty, "empty pick face"], [C.low, "low: refill due"], [C.ok1, "stocked (darker = emptier)"]],
  demand: null,
  low: [[C.empty, "empty"], [C.low, "low"], [C.dim, "fine"]],
  tasks: [[C.task, "refill work order"], [C.move, "move work order"], [C.dim, "no open work"]],
};

export default function LiveWarehouse3D({ bins, rows, mode, level, selected, onSelect }) {
  const geo = useGeometry(bins, rows);
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const webgl = useMemo(hasWebGL, []);
  const target = useMemo(() => [geo.bounds.cx, 1, geo.bounds.cz], [geo.bounds.cx, geo.bounds.cz]);
  if (!webgl) {
    return (
      <EmptyState icon={Cuboid} title="3D view isn't available in this browser">
        This view needs WebGL, which this browser or device has switched off. Use the 2D map instead: it shows the same live status.
      </EmptyState>
    );
  }
  const onHover = (id, ev) => {
    if (id == null) return setHover(null);
    const r = box.current?.getBoundingClientRect();
    setHover({ id, x: ev.clientX - (r?.left || 0), y: ev.clientY - (r?.top || 0), w: r?.width || 0 });
  };
  const hr = hover != null ? geo.occ[hover.id]?.r : null;
  const { bounds } = geo;
  return (
    <div>
      <div className="viewport3d" ref={box} role="img" aria-label={`Live 3D view of ${geo.occ.length} occupied bins out of ${bins.length}. Drag to rotate, scroll to zoom, click a bin for its stock.`}>
        <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [bounds.cx, bounds.span * 0.62, -bounds.span * 0.62], fov: 45, near: 0.1, far: 1000 }} gl={{ antialias: true }} onPointerMissed={() => onSelect(null)}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[bounds.cx + 14, 26, -10]} intensity={1.2} />
          <gridHelper args={[Math.ceil(bounds.span * 1.4), Math.ceil(bounds.span * 1.4), "#27406b", "#16243f"]} position={[bounds.cx, 0, bounds.cz]} />
          <mesh position={[0, 0.12, -1]}>
            <boxGeometry args={[1.6, 0.24, 1.0]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
          <Ghosts geo={geo} level={level} />
          <Occupied geo={geo} mode={mode} level={level} selected={selected} onHover={onHover} onSelect={onSelect} />
          {selected && <Selection geo={geo} loc={selected} />}
          <Controls target={target} span={bounds.span} />
        </Canvas>
        {hr && (
          <div className="hover-card" style={{ left: Math.min(hover.x + 14, Math.max(0, hover.w - 250)), top: hover.y + 14 }}>
            <b>{hr.sku}</b>
            <div>
              {hr.loc} · {hr.category}
            </div>
            <div>
              {hr.qty} of {hr.cap} units in the face · {hr.reserve} in reserve
            </div>
            <div>Click for details</div>
          </div>
        )}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {mode === "demand" ? (
          <span>
            <span className="ramp" aria-hidden="true" /> low → high recent demand (log scale)
          </span>
        ) : (
          LEGEND[mode].map(([c, t]) => (
            <span key={t}>
              <i style={{ background: c }} aria-hidden="true" /> {t}
            </span>
          ))
        )}
        <span>
          <i style={{ background: "#22d3ee" }} aria-hidden="true" /> depot
        </span>
        {geo.ghosts.length > 0 && (
          <span>
            <i style={{ background: "#4a6aa5", opacity: 0.4 }} aria-hidden="true" /> unused bin
          </span>
        )}
        <span className="muted">Drag to rotate · scroll to zoom · right-drag to pan · click a bin</span>
      </div>
    </div>
  );
}
