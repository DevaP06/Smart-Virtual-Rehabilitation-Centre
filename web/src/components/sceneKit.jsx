// Shared pieces for every 3D view of the warehouse so they look like one place: a theme-aware gradient background with matching fog and light,
// a floor slab with painted aisle lanes and a dispatch pad, and real rack frames (uprights and shelf beams) built from the bin positions.
// Colours come from sceneColors() (three.js cannot read CSS variables). Nothing here knows about data: it only draws structure.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/** Gradient sky (top to horizon), fog in the horizon colour so the floor fades into the background, and soft hemisphere + key light. */
export function Environment({ sc, span = 40 }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, sc.bgTop);
    grad.addColorStop(0.55, sc.bgBottom);
    grad.addColorStop(1, sc.bgBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.fog = new THREE.Fog(sc.bgBottom, span * 1.1, span * 3.4);
    return () => {
      scene.background = null;
      scene.fog = null;
      tex.dispose();
    };
  }, [scene, sc, span]);
  return (
    <>
      <hemisphereLight args={[sc.sky, sc.ground, 0.85]} />
      <directionalLight position={[span * 0.5, span * 0.9, -span * 0.3]} intensity={1.15} />
      <directionalLight position={[-span * 0.6, span * 0.4, span * 0.6]} intensity={0.3} />
    </>
  );
}

/** Floor slab (with a darker edge), fine reference grid, painted lanes and the dispatch pad at the origin. lanes: [{ x, z, sx, sz }] centres and sizes in metres. */
export function Floor({ cx, cz, w, d, sc, lanes = [] }) {
  const grid = useMemo(() => {
    const size = Math.max(w, d);
    const n = Math.max(8, Math.round(size / 2));
    const g = new THREE.GridHelper(size, n, sc.grid1, sc.grid2);
    g.material.transparent = true;
    g.material.opacity = 0.45;
    return g;
  }, [w, d, sc]);
  useEffect(() => () => {
    grid.geometry.dispose();
    grid.material.dispose();
  }, [grid]);
  return (
    <group>
      <mesh position={[cx, -0.2, cz]} raycast={() => null}>
        <boxGeometry args={[w + 0.8, 0.3, d + 0.8]} />
        <meshStandardMaterial color={sc.floorEdge} roughness={0.95} />
      </mesh>
      <mesh position={[cx, -0.17, cz]} raycast={() => null}>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial color={sc.floor} roughness={0.92} />
      </mesh>
      <primitive object={grid} position={[cx, 0.006, cz]} raycast={() => null} />
      {lanes.map((l, i) => (
        <mesh key={i} position={[l.x, 0.012, l.z]} raycast={() => null}>
          <boxGeometry args={[l.sx, 0.012, l.sz]} />
          <meshBasicMaterial color={sc.lane} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, -1.3]} raycast={() => null}>
        <boxGeometry args={[4.2, 0.03, 2.4]} />
        <meshBasicMaterial color={sc.depot} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

/**
 * Rack frames from bin centres ([x, y, z] with y the bin's centre): per rack column two rails of uprights (at both ends and every few bays) and a shelf beam
 * under every level. `bin` is the [width, height, depth] of one bin box. Returns arrays of instance specs; memoise by the points array.
 */
export function buildRackFrames(points, bin) {
  const cols = new Map();
  points.forEach(([x, y, z]) => {
    const k = Math.round(x * 100);
    if (!cols.has(k)) cols.set(k, { x, zs: new Set(), ys: new Set() });
    const c = cols.get(k);
    c.zs.add(Math.round(z * 100) / 100);
    c.ys.add(Math.round((y - bin[1] / 2) * 100) / 100);
  });
  const ups = [];
  const beams = [];
  const hw = bin[0] / 2 + 0.05;
  cols.forEach((c) => {
    const zs = [...c.zs].sort((a, b) => a - b);
    const ys = [...c.ys].sort((a, b) => a - b);
    const z0 = zs[0] - bin[2] / 2 - 0.05;
    const z1 = zs[zs.length - 1] + bin[2] / 2 + 0.05;
    const top = ys[ys.length - 1] + bin[1] + 0.35;
    const stops = [z0];
    for (let i = 4; i < zs.length - 1; i += 4) stops.push((zs[i - 1] + zs[i]) / 2);
    stops.push(z1);
    [-hw, hw].forEach((dx) => {
      stops.forEach((z) => ups.push({ x: c.x + dx, z, h: top }));
      ys.forEach((y) => beams.push({ x: c.x + dx, y: y - 0.04, z0, z1 }));
    });
  });
  return { ups, beams };
}

export function RackFrames({ points, bin, sc }) {
  const frames = useMemo(() => buildRackFrames(points, bin), [points, bin]);
  const upRef = useRef(null);
  const beamRef = useRef(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const up = upRef.current;
    const bm = beamRef.current;
    if (up) {
      frames.ups.forEach((u, i) => {
        o.position.set(u.x, u.h / 2, u.z);
        o.scale.set(0.07, u.h, 0.07);
        o.updateMatrix();
        up.setMatrixAt(i, o.matrix);
      });
      up.instanceMatrix.needsUpdate = true;
    }
    if (bm) {
      frames.beams.forEach((b, i) => {
        o.position.set(b.x, b.y, (b.z0 + b.z1) / 2);
        o.scale.set(0.06, 0.07, b.z1 - b.z0);
        o.updateMatrix();
        bm.setMatrixAt(i, o.matrix);
      });
      bm.instanceMatrix.needsUpdate = true;
    }
  }, [frames]);
  if (!frames.ups.length) return null;
  return (
    <group>
      <instancedMesh key={`u${frames.ups.length}`} ref={upRef} args={[undefined, undefined, frames.ups.length]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={sc.upright} roughness={0.55} metalness={0.35} />
      </instancedMesh>
      <instancedMesh key={`b${frames.beams.length}`} ref={beamRef} args={[undefined, undefined, frames.beams.length]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={sc.beam} roughness={0.5} metalness={0.3} />
      </instancedMesh>
    </group>
  );
}

/** Painted aisle lanes between rack columns plus the cross-aisle in front, from the x positions of the aisles. */
export function lanesFor(aisleXs, z0, z1, xMin, xMax) {
  const lanes = aisleXs.map((x) => ({ x, z: (z0 + z1) / 2, sx: 0.14, sz: z1 - z0 }));
  lanes.push({ x: (xMin + xMax) / 2, z: 0.6, sx: xMax - xMin, sz: 0.14 });
  return lanes;
}
