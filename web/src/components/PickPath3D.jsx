// 3D Simulation of the pick-path data: the warehouse's rack faces with each layout's walk on the floor, played from the SAME clock as the 2D plots
// (`sim.k`, owned by tabs/PickPath.jsx). Same coordinate conventions as Warehouse3D (x negated so aisle 0 is on the left; route y runs along the
// aisle) and the same OrbitControls. It only draws what the stored run provides: the grid from run.config and the route points from /paths.
// The picker is a marker moving along the stored polyline (the data has no more detail than that); the far-end markers are the polyline's own corners.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Cuboid } from "lucide-react";
import { EmptyState, LABEL, fmt } from "../ui.jsx";
import { COLORS, POLICY_COLORS } from "../chartTheme.js";
import { sceneColors, useTheme } from "../theme.js";
import { BOX, Controls, hasWebGL } from "./Warehouse3D.jsx";
import { Environment, Floor, RackFrames, lanesFor } from "./sceneKit.jsx";

const LEVEL_Z = [20, 70, 120, 170, 220];
const SHIFT = { B0_random: -0.35, B2_abc: 0, Full: 0.35 }; // keeps the three walks from lying on top of each other
const W = 0.4; // ribbon width (m)

/** One slab per rack face (aisle x side), sized from the run's grid. Bins are not drawn: the walks are what matters here. */
function useRacks(config) {
  return useMemo(() => {
    const need = ["aisles", "bays", "aisle_pitch", "bay_pitch", "y0"];
    if (!config || need.some((k) => typeof config[k] !== "number")) return [];
    const top = ((config.level_z || LEVEL_Z).slice(-1)[0] + 30) / 100;
    const len = config.bays * config.bay_pitch;
    const out = [];
    for (let a = 0; a < config.aisles; a++)
      for (let s = 0; s < 2; s++) out.push({ key: `${a}-${s}`, pos: [-(a * config.aisle_pitch + (s === 0 ? -0.75 : 0.75)), top / 2, config.y0 + (len - config.bay_pitch) / 2], size: [BOX[0] * 1.2, top, len] });
    return out;
  }, [config]);
}

function Racks({ racks, sc }) {
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useEffect(() => () => edge.dispose(), [edge]);
  return (
    <group>
      {racks.map((r) => (
        <group key={r.key} position={r.pos} scale={r.size}>
          <mesh raycast={() => null}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={sc.rack} transparent opacity={0.07} depthWrite={false} />
          </mesh>
          <lineSegments geometry={edge} raycast={() => null}>
            <lineBasicMaterial color={sc.rack} transparent opacity={0.8} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** Wakes the on-demand renderer whenever the shared clock moves (and once on mount). */
function Sync({ sim }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const wake = () => invalidate();
    sim.subs.add(wake);
    invalidate();
    return () => sim.subs.delete(wake);
  }, [sim, invalidate]);
  return null;
}

/** One walk: a faint ribbon for the whole route, a solid ribbon for the part walked, a picker marker, and far-end markers that light up when reached. */
function Walk({ walk, color, shift, sim, step, sc }) {
  const { points, total } = walk;
  const segs = useMemo(() => {
    let acc = 0;
    return points.slice(1).map((p, i) => {
      const q = points[i];
      const len = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
      const s = { q, p, len, start: acc, alongX: Math.abs(p[0] - q[0]) > 0 };
      acc += len;
      return s;
    });
  }, [points]);
  const stops = useMemo(() => {
    let acc = 0;
    const out = [];
    points.forEach((p, i) => {
      if (i > 0) acc += Math.abs(p[0] - points[i - 1][0]) + Math.abs(p[1] - points[i - 1][1]);
      if (i > 0 && i < points.length - 1 && p[1] > 0) out.push({ at: acc, x: -p[0] + shift, z: p[1] + shift }); // far ends of the aisles walked
    });
    return out;
  }, [points, shift]);
  const solid = useRef([]);
  const picker = useRef(null);
  const marks = useRef([]);
  const lastK = useRef(-1);
  const hot = useMemo(() => new THREE.Color(sc.hot), [sc]);
  const off = useMemo(() => new THREE.Color(sc.ghost), [sc]);
  useFrame(() => {
    if (lastK.current === sim.k) return;
    lastK.current = sim.k;
    const d = Math.min(sim.k * step, total);
    segs.forEach((s, i) => {
      const m = solid.current[i];
      if (!m) return;
      const f = s.len ? Math.min(1, Math.max(0, (d - s.start) / s.len)) : 1;
      const len = Math.max(0.001, s.len * f);
      const dir = s.alongX ? Math.sign(s.p[0] - s.q[0]) : Math.sign(s.p[1] - s.q[1]);
      m.visible = f > 0;
      m.position.set(s.alongX ? -(s.q[0] + (dir * len) / 2) + shift : -s.q[0] + shift, 0.14, s.alongX ? s.q[1] + shift : s.q[1] + (dir * len) / 2 + shift);
      m.scale.set(s.alongX ? len + W : W, 1, s.alongX ? W : len + W);
    });
    // the picker: the point d metres along the stored polyline
    let acc = 0;
    let at = points[0];
    for (let i = 0; i < segs.length; i++) {
      if (d <= acc + segs[i].len || i === segs.length - 1) {
        const f = segs[i].len ? Math.min(1, (d - acc) / segs[i].len) : 1;
        at = [segs[i].q[0] + (segs[i].p[0] - segs[i].q[0]) * f, segs[i].q[1] + (segs[i].p[1] - segs[i].q[1]) * f];
        break;
      }
      acc += segs[i].len;
    }
    if (picker.current) picker.current.position.set(-at[0] + shift, 0.55, at[1] + shift);
    stops.forEach((s, i) => marks.current[i]?.material.color.copy(d >= s.at - 1e-6 ? hot : off));
  });
  return (
    <group>
      {segs.map((s, i) => (
        <group key={`g${i}`}>
          <mesh position={[s.alongX ? -((s.p[0] + s.q[0]) / 2) + shift : -s.q[0] + shift, 0.1, s.alongX ? s.q[1] + shift : (s.p[1] + s.q[1]) / 2 + shift]} raycast={() => null}>
            <boxGeometry args={[s.alongX ? s.len + W : W, 0.06, s.alongX ? W : s.len + W]} />
            <meshBasicMaterial color={color} transparent opacity={0.28} />
          </mesh>
          <mesh ref={(m) => (solid.current[i] = m)} visible={false} raycast={() => null}>
            <boxGeometry args={[1, 0.1, 1]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </group>
      ))}
      {stops.map((s, i) => (
        <mesh key={`s${i}`} ref={(m) => (marks.current[i] = m)} position={[s.x, 0.35, s.z]} raycast={() => null}>
          <boxGeometry args={[0.7, 0.7, 0.7]} />
          <meshBasicMaterial color={sc.ghost} />
        </mesh>
      ))}
      <mesh ref={picker} raycast={() => null}>
        <sphereGeometry args={[0.55, 20, 14]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  );
}

export default function PickPath3D({ config, walks, step, sim }) {
  const theme = useTheme();
  const sc = sceneColors(theme);
  const racks = useRacks(config);
  const webgl = useMemo(hasWebGL, []);
  const bounds = useMemo(() => {
    const xs = [0, ...racks.map((r) => r.pos[0]), ...walks.flatMap((w) => w.points.map((q) => -q[0]))];
    const zs = [0, ...racks.map((r) => r.pos[2] + r.size[2] / 2), ...walks.flatMap((w) => w.points.map((q) => q[1]))];
    const minX = Math.min(...xs), maxX = Math.max(...xs), maxZ = Math.max(...zs);
    return { minX, maxX, maxZ, cx: (minX + maxX) / 2, cz: maxZ / 2, span: Math.max(maxX - minX, maxZ) + 6 };
  }, [racks, walks]);
  // rack frames need bin-level positions; the grid in run.config gives them (the walks themselves only need the racks' extents)
  const framePts = useMemo(() => {
    if (!config || typeof config.aisles !== "number") return [];
    const levelZ = config.level_z || LEVEL_Z;
    const out = [];
    for (let a = 0; a < config.aisles; a++)
      for (let s = 0; s < 2; s++)
        for (let b = 0; b < config.bays; b++)
          for (let l = 0; l < levelZ.length; l++) out.push([-(a * config.aisle_pitch + (s === 0 ? -0.75 : 0.75)), levelZ[l] / 100 + BOX[1] / 2, config.y0 + b * config.bay_pitch]);
    return out;
  }, [config]);
  const lanes = useMemo(() => (config && typeof config.aisles === "number" ? lanesFor(Array.from({ length: config.aisles }, (_, a) => -(a * config.aisle_pitch)), config.y0 - 1.2, config.y0 + (config.bays - 1) * config.bay_pitch + 1.2, bounds.minX - 5, bounds.maxX + 5) : []), [config, bounds]);
  const target = useMemo(() => [bounds.cx, 0.5, bounds.cz], [bounds]);
  if (!webgl) {
    return (
      <EmptyState icon={Cuboid} title="3D simulation isn't available in this browser">
        This view needs WebGL, which this browser or device has switched off. The 2D Simulation shows the same walks.
      </EmptyState>
    );
  }
  return (
    <div>
      <div className="viewport3d" role="img" aria-label={`3D simulation of the warehouse with the ${walks.length} walks. ${walks.map((w) => `${LABEL[w.policy]}: ${fmt(w.dist, 0)} metres`).join("; ")}. Drag to rotate, scroll to zoom.`}>
        <Canvas key={theme} frameloop="demand" dpr={[1, 2]} camera={{ position: [bounds.cx, bounds.span * 0.55, -bounds.span * 0.62], fov: 45, near: 0.1, far: 2000 }} gl={{ antialias: true }}>
          <Environment sc={sc} span={bounds.span} />
          <Floor cx={bounds.cx} cz={bounds.maxZ / 2} w={bounds.maxX - bounds.minX + 18} d={bounds.maxZ + 14} sc={sc} lanes={lanes} />
          <RackFrames points={framePts} bin={BOX} sc={sc} />
          <Racks racks={racks} sc={sc} />
          {walks.map((w) => (
            <Walk key={w.policy} walk={w} color={POLICY_COLORS[w.policy] || COLORS.accent} shift={SHIFT[w.policy] ?? 0} sim={sim} step={step} sc={sc} />
          ))}
          <Sync sim={sim} />
          <Controls target={target} span={bounds.span} />
        </Canvas>
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {walks.map((w) => (
          <span key={w.policy}>
            <i style={{ background: POLICY_COLORS[w.policy] }} aria-hidden="true" />
            {LABEL[w.policy]}: {fmt(w.dist, 0)} m
          </span>
        ))}
        <span>
          <i style={{ background: sc.depot }} aria-hidden="true" /> depot
        </span>
        <span>
          <i style={{ background: sc.hot }} aria-hidden="true" /> far end reached
        </span>
        <span className="muted">Drag to rotate · scroll to zoom · right-drag to pan</span>
      </div>
    </div>
  );
}
