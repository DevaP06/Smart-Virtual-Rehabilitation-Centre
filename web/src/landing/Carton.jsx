// The packing-bench carton at dispatch. It is the destination of the "enter the workspace" flight: the camera walks up the aisle, rises over the
// rim as the flaps open, and drops inside. A plain cardboard box on a bench: barcode label, tape seam, a few SKU cards, a miniature route and grid.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { smooth, story } from "./story.js";

export const CARTON = { x: 8.5, z: -0.5, benchH: 0.5, W: 1.7, H: 1.0, D: 1.2 };
const { W, H, D } = CARTON;
const FL = D / 2; // major flap length
const SL = W / 2; // minor flap length

function labelTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "#f4f0e6";
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#26332e";
  for (let i = 0; i < 46; i++) g.fillRect(14 + i * 4.9, 18, i % 3 === 0 ? 3.4 : 1.8, 62);
  g.font = "700 20px ui-monospace, Consolas, monospace";
  g.fillText("SLOT A1-04", 14, 112);
  g.font = "600 14px ui-monospace, Consolas, monospace";
  g.fillText("DEMO ORDER · FRAGILE", 14, 138);
  g.fillStyle = "#d89545";
  g.fillRect(200, 96, 42, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function Carton({ sc }) {
  const major = useRef([]); // front, back
  const minor = useRef([]); // left, right
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(labelTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const route = useMemo(() => new Float32Array([-0.6, 0, 0.3, -0.6, 0, -0.2, 0, 0, -0.2, 0, 0, 0.25, 0.55, 0, 0.25]), []);

  useFrame(() => {
    const t = story.tr.active ? story.tr.t : 0;
    const sideOpen = smooth(1.95, 2.3, t) * 2.5; // minor flaps first
    const mainOpen = smooth(2.05, 2.45, t) * 2.95; // folded right back so the camera can pass over the rim // then the major flaps
    major.current[0]?.rotation.set(mainOpen, 0, 0);
    major.current[1]?.rotation.set(-mainOpen, 0, 0);
    minor.current[0]?.rotation.set(0, 0, sideOpen);
    minor.current[1]?.rotation.set(0, 0, -sideOpen);
    if (t > 1.9 && t < 2.6) invalidate();
  });

  const card = (c) => <meshStandardMaterial color={c} roughness={0.7} />;
  const wall = { side: THREE.DoubleSide, roughness: 0.85 };
  return (
    <group position={[CARTON.x, 0, CARTON.z]}>
      {/* packing bench */}
      <mesh position={[0, CARTON.benchH / 2, 0.1]} raycast={() => null}>
        <boxGeometry args={[3.2, CARTON.benchH, 1.9]} />
        <meshStandardMaterial color={sc.bench} roughness={0.9} />
      </mesh>
      <group position={[0, CARTON.benchH, 0]}>
        {/* open-top body: 4 walls + base, double-sided so the inside is visible from the camera */}
        <mesh position={[0, H / 2, D / 2]} raycast={() => null}><planeGeometry args={[W, H]} /><meshStandardMaterial color={sc.carton} {...wall} /></mesh>
        <mesh position={[0, H / 2, -D / 2]} raycast={() => null}><planeGeometry args={[W, H]} /><meshStandardMaterial color={sc.cartonIn} {...wall} /></mesh>
        <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} raycast={() => null}><planeGeometry args={[D, H]} /><meshStandardMaterial color={sc.carton} {...wall} /></mesh>
        <mesh position={[W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} raycast={() => null}><planeGeometry args={[D, H]} /><meshStandardMaterial color={sc.carton} {...wall} /></mesh>
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}><planeGeometry args={[W, D]} /><meshStandardMaterial color={sc.paper} {...wall} /></mesh>
        {/* shipping label on the front wall */}
        <mesh position={[0.35, H * 0.55, D / 2 + 0.004]} raycast={() => null}><planeGeometry args={[0.64, 0.4]} /><meshBasicMaterial map={tex} /></mesh>
        {/* interior: grid, route, SKU cards, tiny racks */}
        <gridHelper args={[1.5, 8, sc.grid1, sc.grid1]} position={[0, 0.02, 0]} scale={[1, 1, 0.78]} />
        <lineSegments position={[0, 0.03, 0]} raycast={() => null}>
          <bufferGeometry><bufferAttribute attach="attributes-position" array={route} count={5} itemSize={3} /></bufferGeometry>
          <lineBasicMaterial color={sc.hot} />
        </lineSegments>
        <mesh position={[-0.5, 0.2, -0.15]} rotation={[0, 0.3, -0.12]} raycast={() => null}><boxGeometry args={[0.34, 0.4, 0.03]} />{card(sc.opt)}</mesh>
        <mesh position={[-0.12, 0.17, -0.3]} rotation={[0, -0.2, 0.1]} raycast={() => null}><boxGeometry args={[0.3, 0.34, 0.03]} />{card(sc.cb)}</mesh>
        <mesh position={[0.28, 0.15, -0.2]} rotation={[0, 0.15, -0.05]} raycast={() => null}><boxGeometry args={[0.28, 0.3, 0.03]} />{card(sc.hot)}</mesh>
        {[-0.2, 0.15, 0.5].map((x) => (
          <mesh key={x} position={[x + 0.1, 0.06, 0.3]} raycast={() => null}><boxGeometry args={[0.2, 0.12, 0.2]} />{card(sc.bin2)}</mesh>
        ))}
        {/* flaps: hinged on the top edges, minor (side) flaps open first, then the major (front / back) flaps */}
        <group ref={(g) => (major.current[0] = g)} position={[0, H, D / 2]}><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -FL / 2]} raycast={() => null}><planeGeometry args={[W, FL]} /><meshStandardMaterial color={sc.carton} {...wall} /></mesh></group>
        <group ref={(g) => (major.current[1] = g)} position={[0, H, -D / 2]}><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, FL / 2]} raycast={() => null}><planeGeometry args={[W, FL]} /><meshStandardMaterial color={sc.carton} {...wall} /></mesh></group>
        <group ref={(g) => (minor.current[0] = g)} position={[-W / 2, H, 0]}><mesh rotation={[-Math.PI / 2, 0, 0]} position={[SL / 2, 0.002, 0]} raycast={() => null}><planeGeometry args={[SL, D]} /><meshStandardMaterial color={sc.cartonIn} {...wall} /></mesh></group>
        <group ref={(g) => (minor.current[1] = g)} position={[W / 2, H, 0]}><mesh rotation={[-Math.PI / 2, 0, 0]} position={[-SL / 2, 0.002, 0]} raycast={() => null}><planeGeometry args={[SL, D]} /><meshStandardMaterial color={sc.cartonIn} {...wall} /></mesh></group>
      </group>
    </group>
  );
}
