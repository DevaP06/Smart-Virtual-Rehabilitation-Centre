// The landing page's 3D warehouse. One scene, many states: everything it draws is a function of the story (scroll position, section controls,
// dashboard-transition clock), and ONE camera controller owns the camera. Illustrative layout (see sceneData.js), same visual language as the
// dashboard's Warehouse3D: instanced bins, racks, on-demand rendering. Frames are only requested while something is changing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sceneColors, useTheme } from "../theme.js";
import { ALL_BINS, DEPOT, GEO, ITEMS, ORDER_IDS, aisleX, binLabel, binXZ, depth, isStocked, movePath, pointAt, routePoints } from "./sceneData.js";
import { CANDS, VERDICTS } from "./spatialCases.js";
import { LABELS, labelAlpha } from "./stageLabels.js";
import { KEYS, cameraAt, clamp01, easeInOut, lerp, smooth, story, subscribe, visuals } from "./story.js";
import Carton, { CARTON } from "./Carton.jsx";

const LEVEL_Y = (l) => 0.35 + l * 0.95;
const BOX = [0.86, 0.6, 1.0];
const CX = 8.5;
const INTRO_S = 1.2;
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);

const key = (r, c, w, l) => `${r}-${c}-${w}-${l}`;
const itemKeys = new Set(ITEMS.flatMap((it) => [key(...it.base), key(...it.opt)]));
const DECOR = ALL_BINS.filter((b) => isStocked(...b) && !itemKeys.has(key(...b)));

/* ---------------------------------------------------------------- intro clock */
function Intro({ intro, onSettled }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (intro.t >= 1) onSettled?.();
    invalidate();
  }, [intro, invalidate, onSettled]);
  useFrame((_, dt) => {
    if (intro.t >= 1) return;
    intro.t = Math.min(1, intro.t + Math.min(dt, 0.05) / INTRO_S);
    story.intro = intro.t;
    if (intro.t >= 1) onSettled?.();
    invalidate();
  });
  return null;
}

/* ---------------------------------------------------------------- the one camera controller */
// A cubic-ish path through the aisle to the packing bench and into the carton. Control point k is reached at TIMES[k] seconds.
const TIMES = [0.2, 0.8, 1.15, 1.5, 1.8, 2.1, 2.45, 2.9];
const P = [null, [CX, 7, depth + 3.6], [CX, 2.7, depth + 0.6], [CX, 2.0, 7], [CX, 1.7, 3.2], [CX, 1.9, 1.5], [CX, 3.3, 0.5], [CX, 1.4, CARTON.z + 0.15]];
const T = [null, [CX, 1.4, 6], [CX, 1.2, 2.2], [CX, 1.3, CARTON.z + 0.6], [CX, 1.3, CARTON.z], [CX, 1.2, CARTON.z], [CX, 1.0, CARTON.z], [CX, 0.7, CARTON.z - 0.1]];

function pathIndex(t) {
  if (t <= TIMES[0]) return 0;
  for (let k = 1; k < TIMES.length; k++)
    if (t <= TIMES[k]) {
      let f = (t - TIMES[k - 1]) / (TIMES[k] - TIMES[k - 1]);
      if (k === 1) f = easeInOut(f); // accelerate away from the overview
      if (k === TIMES.length - 1) f = 1 - Math.pow(1 - f, 2); // settle inside the box
      return k - 1 + f;
    }
  return TIMES.length - 1;
}

function CameraRig() {
  const { camera, gl, size, invalidate } = useThree();
  const cur = useRef({ pos: new THREE.Vector3(...KEYS[0].pos), target: new THREE.Vector3(...KEYS[0].target), off: new THREE.Vector3() });
  const path = useRef(null);
  const tmp = useMemo(() => ({ r: new THREE.Vector3(), u: new THREE.Vector3(), pos: new THREE.Vector3(), tg: new THREE.Vector3() }), []);
  useEffect(() => subscribe(invalidate), [invalidate]);
  useEffect(() => () => camera.clearViewOffset(), [camera]);

  useFrame((_, dt) => {
    const c = cur.current;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    let shift = 0;
    let dim = 1;
    if (story.tr.active) {
      if (!path.current) {
        const pc = [c.pos.clone(), ...P.slice(1).map((p) => new THREE.Vector3(...p))];
        const tc = [c.target.clone(), ...T.slice(1).map((p) => new THREE.Vector3(...p))];
        path.current = { pos: new THREE.CatmullRomCurve3(pc, false, "centripetal"), target: new THREE.CatmullRomCurve3(tc, false, "centripetal") };
      }
      const s = pathIndex(story.tr.t) / (TIMES.length - 1);
      path.current.pos.getPoint(s, tmp.pos);
      path.current.target.getPoint(s, tmp.tg);
      c.pos.copy(tmp.pos);
      c.target.copy(tmp.tg);
      c.off.set(0, 0, 0);
      shift = cameraAt(story.u).shift * (1 - smooth(0.2, 0.8, story.tr.t));
      invalidate();
    } else {
      path.current = null;
      const cam = cameraAt(story.stage ? story.u : 0);
      shift = story.stage ? cam.shift : 0;
      dim = story.stage ? cam.dim : 1;
      const intro = 1 - easeOut(story.intro); // entrance: a small pull-back that settles
      tmp.pos.set(...cam.pos).add(tmp.u.set(-2.2, 2.4, -3.2).multiplyScalar(intro));
      tmp.tg.set(...cam.target);
      c.pos.lerp(tmp.pos, k);
      c.target.lerp(tmp.tg, k);
      // small pointer parallax on top of the scroll-driven pose (never replaces it)
      camera.position.copy(c.pos);
      camera.lookAt(c.target);
      camera.updateMatrixWorld();
      tmp.r.setFromMatrixColumn(camera.matrixWorld, 0);
      tmp.u.setFromMatrixColumn(camera.matrixWorld, 1);
      const amp = story.stage ? 0.7 : 0.25;
      const want = tmp.r.multiplyScalar(story.px * amp).add(tmp.u.multiplyScalar(-story.py * amp * 0.55));
      c.off.lerp(want, k);
      if (c.pos.distanceTo(tmp.pos) > 0.01 || c.target.distanceTo(tmp.tg) > 0.01 || c.off.distanceTo(want) > 0.005 || story.intro < 1) invalidate();
    }
    camera.position.copy(c.pos).add(c.off);
    camera.lookAt(c.target);
    if (shift) camera.setViewOffset(size.width, size.height, -shift * size.width, 0, size.width, size.height);
    else camera.clearViewOffset();
    gl.domElement.style.opacity = String(dim);
  });
  return null;
}

/* ---------------------------------------------------------------- static structure */
function Floor({ sc }) {
  return (
    <group>
      <mesh position={[CX, -0.06, depth / 2 - 0.4]} raycast={() => null}>
        <boxGeometry args={[GEO.width + 5, 0.1, depth + 3.4]} />
        <meshStandardMaterial color={sc.floor} roughness={0.95} transparent opacity={0.6} depthWrite={false} />
      </mesh>
      {[0, 1, 2].map((a) => (
        <mesh key={a} position={[aisleX(a), 0.0, depth / 2 + 0.4]} raycast={() => null}>
          <boxGeometry args={[0.07, 0.02, depth - 1.6]} />
          <meshBasicMaterial color={sc.grid1} />
        </mesh>
      ))}
      <mesh position={[CX, 0.0, 0.6]} raycast={() => null}>
        <boxGeometry args={[GEO.width, 0.02, 0.07]} />
        <meshBasicMaterial color={sc.grid1} />
      </mesh>
      <mesh position={[DEPOT[0], 0.0, -0.5]} raycast={() => null}>
        <boxGeometry args={[4.2, 0.04, 2.0]} />
        <meshBasicMaterial color={sc.hot} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

function Racks({ intro, sc }) {
  const ref = useRef(null);
  const specs = useMemo(() => {
    const out = [];
    for (let r = 0; r < GEO.racks; r++)
      [0.04, 1.96].forEach((dx) => {
        const x = r * GEO.rackStep + dx;
        for (let k = 0; k <= 4; k++) out.push({ kind: "up", r, x, z: GEO.front - 0.6 + k * 2 * GEO.pitch });
        for (let l = 0; l <= GEO.levels; l++) out.push({ kind: "beam", r, x, y: 0.05 + l * 0.95, z0: GEO.front - 0.6, len: GEO.rows * GEO.pitch });
      });
    return out;
  }, []);
  const o = useMemo(() => new THREE.Object3D(), []);
  const last = useRef(-1);
  const apply = () => {
    const m = ref.current;
    if (!m) return;
    const col = new THREE.Color();
    specs.forEach((s, i) => {
      const p = easeOut((intro.t - 0.04 - s.r * 0.09) / 0.35);
      if (s.kind === "up") {
        o.position.set(s.x, 1.95 * p, s.z);
        o.scale.set(0.08, Math.max(0.001, 3.9 * p), 0.08);
      } else {
        o.position.set(s.x, s.y, s.z0 + (s.len * p) / 2);
        o.scale.set(0.06, 0.06, Math.max(0.001, s.len * p));
      }
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, col.set(s.kind === "up" ? sc.upright : sc.beam));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  useLayoutEffect(() => {
    apply();
    last.current = intro.t;
  });
  useFrame(() => {
    if (last.current !== intro.t) {
      last.current = intro.t;
      apply();
    }
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, specs.length]} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.8} metalness={0.1} />
    </instancedMesh>
  );
}

/** Decorative stock. Dims while the demand scene highlights the products; hover / click shows a bin's (illustrative) details. */
function Stock({ intro, sc, onInfo, hover, setHover, sel, setSel }) {
  const ref = useRef(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => DECOR.map((_, i) => new THREE.Color(i % 3 === 0 ? sc.bin2 : sc.bin1)), [sc]);
  const last = useRef(-1);
  const paint = () => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    DECOR.forEach((b, i) => {
      const [r, cc, w, l] = b;
      const [x, z] = binXZ(r, cc, w);
      const p = easeOut((intro.t - 0.1 - r * 0.09 - l * 0.035 - w * 0.004) / 0.3);
      o.position.set(x, LEVEL_Y(l), z);
      o.scale.setScalar(Math.max(0.001, p));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      c.copy(colors[i]);
      if (i === hover || i === sel) c.lerp(new THREE.Color(sc.wire), 0.35);
      m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  useLayoutEffect(() => {
    paint();
    last.current = intro.t;
  }, [colors, hover, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    if (last.current !== intro.t) {
      last.current = intro.t;
      paint();
    }
    const m = ref.current;
    if (m) {
      const v = visuals(story.u, story);
      m.material.opacity = lerp(1, 0.5, Math.max(v.demand * 0.9, v.constraints * 0.5));
    }
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, DECOR.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (e.instanceId !== hover) setHover(e.instanceId);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(-1);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        setSel(e.instanceId);
        const [r, c, w, l] = DECOR[e.instanceId];
        onInfo({ loc: binLabel(r, c, w, l), sku: null });
      }}
    >
      <boxGeometry args={BOX} />
      <meshStandardMaterial roughness={0.75} metalness={0.05} transparent />
    </instancedMesh>
  );
}

/* ---------------------------------------------------------------- the eight illustrative products */
const LINKS = [[0, 1], [1, 3], [2, 4], [5, 6], [6, 7]]; // bought-together pairs (same group)
const MOVES = ITEMS.map(movePath);
const itemProg = (A, i) => clamp01((A - (0.3 * i) / (ITEMS.length - 1)) / 0.7); // staggered, so products leave one after another

function Items({ sc, onInfo }) {
  const meshes = useRef([]);
  const rings = useRef([]);
  const links = useRef(null);
  const linkPos = useMemo(() => new Float32Array(LINKS.length * 6), []);
  const cls = { A: sc.opt, B: sc.cb, C: sc.cc };
  const base = useMemo(() => ITEMS.map((it) => new THREE.Color(ORDER_IDS.includes(it.id) ? sc.hot : sc.bin2)), [sc]);
  const ringGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX[0] * 1.25, BOX[1] * 1.3, BOX[2] * 1.2)), []);
  useEffect(() => () => ringGeo.dispose(), [ringGeo]);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const v = visuals(story.u, story);
    const world = [];
    ITEMS.forEach((it, i) => {
      const m = meshes.current[i];
      if (!m) return;
      const A = itemProg(v.A, i);
      const [x, z] = pointAt(MOVES[i], A);
      const y = lerp(LEVEL_Y(it.base[3]), LEVEL_Y(it.opt[3]), A) + Math.sin(Math.PI * A) * 0.3;
      m.position.set(x, y, z);
      m.scale.setScalar(1 + v.demand * (it.w / 100) * 0.4);
      tmp.copy(base[i]).lerp(new THREE.Color(cls[it.cls]), v.demand);
      m.material.color.copy(tmp);
      world.push([x, y, z]);
      const r = rings.current[i];
      if (r) {
        r.position.set(x, y, z);
        r.visible = ORDER_IDS.includes(it.id) || v.attention > 0.05;
        r.material.opacity = ORDER_IDS.includes(it.id) ? 0.9 : v.attention;
        r.scale.setScalar(m.scale.x);
      }
    });
    const l = links.current;
    if (l) {
      LINKS.forEach(([a, b], k) => {
        linkPos.set(world[a], k * 6);
        linkPos.set(world[b], k * 6 + 3);
      });
      l.geometry.attributes.position.needsUpdate = true;
      l.material.opacity = story.demandStep >= 2 ? v.demand : 0;
    }
  });
  return (
    <group>
      {ITEMS.map((it, i) => (
        <group key={it.id}>
          <mesh
            ref={(m) => (meshes.current[i] = m)}
            onClick={(e) => {
              e.stopPropagation();
              const v = visuals(story.u, story);
              const b = v.A < 0.5 ? it.base : it.opt;
              onInfo({ loc: binLabel(...b), sku: it.id, cls: it.cls, demand: it.w, inOrder: ORDER_IDS.includes(it.id) });
            }}
            onPointerOver={() => (document.body.style.cursor = "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <boxGeometry args={BOX} />
            <meshStandardMaterial roughness={0.7} />
          </mesh>
          <lineSegments ref={(m) => (rings.current[i] = m)} geometry={ringGeo} raycast={() => null}>
            <lineBasicMaterial color={sc.hot} transparent />
          </lineSegments>
        </group>
      ))}
      <lineSegments ref={links} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={linkPos} count={LINKS.length * 2} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={sc.hot} transparent opacity={0} />
      </lineSegments>
    </group>
  );
}

/* ---------------------------------------------------------------- spatial constraint overlays */
function Candidates({ sc }) {
  const refs = useRef([]);
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX[0] * 1.12, BOX[1] * 1.2, BOX[2] * 1.08)), []);
  useEffect(() => () => edge.dispose(), [edge]);
  useFrame(() => {
    const v = visuals(story.u, story);
    refs.current.forEach((g, i) => {
      if (!g) return;
      const a = v.constraints * (story.spatialShown > i ? 1 : 0);
      g.visible = a > 0.02;
      g.children[0].material.opacity = 0.38 * a;
      g.children[1].material.opacity = a;
    });
  });
  return (
    <group>
      {CANDS.map((c, i) => {
        const [x, z] = binXZ(...c.bin.slice(0, 3));
        const color = VERDICTS[i].ok ? sc.opt : sc.bad;
        return (
          <group key={c.loc} ref={(g) => (refs.current[i] = g)} position={[x, LEVEL_Y(c.bin[3]), z]} visible={false}>
            <mesh raycast={() => null}>
              <boxGeometry args={[BOX[0] * 1.1, BOX[1] * 1.18, BOX[2] * 1.06]} />
              <meshBasicMaterial color={color} transparent depthWrite={false} />
            </mesh>
            <lineSegments geometry={edge} raycast={() => null}>
              <lineBasicMaterial color={color} transparent />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}

/* ---------------------------------------------------------------- routes + picker */
function Ribbon({ pts, color, width = 0.3, opacityRef }) {
  const refs = useRef([]);
  const segs = useMemo(() => {
    let acc = 0;
    return pts.slice(1).map((p, i) => {
      const q = pts[i];
      const len = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
      const s = { q, p, len, start: acc, alongX: Math.abs(p[0] - q[0]) > 0 };
      acc += len;
      return s;
    });
  }, [pts]);
  const total = segs.reduce((a, s) => a + s.len, 0);
  useFrame(() => {
    const { draw, op } = opacityRef();
    const d = draw * total;
    segs.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      const f = clamp01((d - s.start) / s.len);
      const len = Math.max(0.001, s.len * f);
      const dir = s.alongX ? Math.sign(s.p[0] - s.q[0]) : Math.sign(s.p[1] - s.q[1]);
      m.position.set(s.alongX ? s.q[0] + (dir * len) / 2 : s.q[0], 0.07, s.alongX ? s.q[1] : s.q[1] + (dir * len) / 2);
      m.scale.set(s.alongX ? len : width, 1, s.alongX ? width : len);
      m.visible = f > 0 && op > 0.01;
      m.material.opacity = op;
    });
  });
  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} raycast={() => null}>
          <boxGeometry args={[1, 0.05, 1]} />
          <meshBasicMaterial color={color} transparent />
        </mesh>
      ))}
    </group>
  );
}

function Routes({ intro, sc }) {
  const base = useMemo(() => routePoints("base"), []);
  const opt = useMemo(() => routePoints("opt"), []);
  const picker = useRef(null);
  useFrame(() => {
    const v = visuals(story.u, story);
    const m = picker.current;
    if (!m) return;
    const pts = story.route === "opt" ? opt : base;
    const on = v.picker > 0.2 && story.walk >= 0;
    m.visible = on;
    if (on) {
      const [x, z] = pointAt(pts, story.walk);
      m.position.set(x, 0.42, z);
    }
  });
  return (
    <group>
      <Ribbon pts={base} color={sc.cb} opacityRef={() => {
        const v = visuals(story.u, story);
        return { draw: v.baseDraw * easeOut((intro.t - 0.55) / 0.42), op: v.baseOp };
      }} />
      <Ribbon pts={opt} width={0.34} color={sc.route} opacityRef={() => {
        const v = visuals(story.u, story);
        return { draw: story.tr.active ? smooth(0.5, 1.5, story.tr.t) : 1, op: v.optOp };
      }} />
      <mesh ref={picker} visible={false} raycast={() => null}>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshStandardMaterial color={sc.hot} roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- labels (projected to the DOM, written straight to style: no React state) */
function Labels({ els }) {
  const { camera, size } = useThree();
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const v = visuals(story.u, story);
    const u = story.tr.active ? -9 : story.u;
    LABELS.forEach((l) => {
      const el = els.get(l.id);
      if (!el) return;
      const a = labelAlpha(l, u);
      el.style.opacity = a.toFixed(3);
      if (a < 0.02) return;
      const [x, y, z] = l.anchor(v.A);
      v3.set(x, y, z).project(camera);
      const sx = Math.min(size.width - 120, Math.max(120, ((v3.x + 1) / 2) * size.width)); // keep labels on screen
      el.style.transform = `translate(${sx}px, ${((1 - v3.y) / 2) * size.height}px) translate(-50%, -100%)`;
    });
  });
  return null;
}

/* ---------------------------------------------------------------- canvas */
export default function StageScene({ labelEls, intro: playIntro = true, onSettled, onInfo }) {
  const theme = useTheme();
  const sc = sceneColors(theme);
  const intro = useRef({ t: playIntro ? 0 : 1 }).current;
  const [hover, setHover] = useState(-1);
  const [sel, setSel] = useState(-1);
  const coarse = useMemo(() => window.matchMedia?.("(pointer: coarse)").matches ?? false, []);
  useEffect(() => {
    if (!playIntro) story.intro = 1;
  }, [playIntro]);
  return (
    <Canvas
      key={theme}
      frameloop="demand"
      dpr={[1, coarse ? 1.5 : 2]}
      camera={{ position: KEYS[0].pos, fov: 36, near: 0.1, far: 220 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onPointerMissed={() => {
        setSel(-1);
        onInfo(null);
      }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[CX + 10, 22, -6]} intensity={1.5} />
      <directionalLight position={[CX - 12, 8, 14]} intensity={0.35} />
      <Floor sc={sc} />
      <Racks intro={intro} sc={sc} />
      <Stock intro={intro} sc={sc} onInfo={onInfo} hover={hover} setHover={setHover} sel={sel} setSel={setSel} />
      <Items sc={sc} onInfo={onInfo} />
      <Candidates sc={sc} />
      <Routes intro={intro} sc={sc} />
      <Carton sc={sc} />
      <Labels els={labelEls} />
      <CameraRig />
      <Intro intro={intro} onSettled={onSettled} />
    </Canvas>
  );
}
