// Top-down warehouse plan (SVG) for the illustrative scenes on the landing page. Pure drawing: positions, routes and the walker come in as props.
import { memo } from "react";
import { CROSS_Z, DEPOT, GEO, aisleX, binXZ, depth, isStocked } from "./sceneData.js";

const VB_Y = depth + 0.6;
const Y = (z) => VB_Y - z; // plan z grows away from the depot; SVG y grows downward
const path = (pts) => pts.map(([x, z], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${Y(z).toFixed(2)}`).join(" ");

const Racks = memo(function Racks() {
  const out = [];
  for (let r = 0; r < GEO.racks; r++) {
    out.push(<rect key={`f${r}`} className="plan-rack" x={r * GEO.rackStep} y={Y(depth)} width={2} height={depth - GEO.front + 0.2} rx="0.12" />);
    for (let c = 0; c < GEO.cols; c++)
      for (let w = 0; w < GEO.rows; w++) {
        const [x, z] = binXZ(r, c, w);
        const stocked = [0, 1, 2, 3].some((l) => isStocked(r, c, w, l));
        out.push(<rect key={`${r}-${c}-${w}`} className={stocked ? "plan-bin on" : "plan-bin"} x={x - 0.42} y={Y(z) - 0.5} width={0.84} height={1} rx="0.08" />);
      }
  }
  for (let a = 0; a < GEO.racks - 1; a++) out.push(<line key={`a${a}`} className="plan-aisle" x1={aisleX(a)} x2={aisleX(a)} y1={Y(depth - 0.2)} y2={Y(CROSS_Z)} />);
  out.push(<line key="cross" className="plan-aisle" x1={0} x2={GEO.width} y1={Y(CROSS_Z)} y2={Y(CROSS_Z)} />);
  return <g>{out}</g>;
});

/**
 * items:   [{ id, x, z, cls, hot, dim }]   products as small tiles (class letter inside, so class never relies on colour)
 * routes:  [{ pts, tone: "base" | "opt", opacity, draw }]   draw 0..1 reveals the line from the depot
 * walker:  [x, z] | null   a picker marker
 * notes:   [{ x, z, text, anchor }]   short annotations
 */
export default function Plan({ items = [], routes = [], walker = null, notes = [], label, className = "" }) {
  return (
    <svg className={`plan ${className}`} viewBox={`-1 -0.3 ${GEO.width + 2} ${VB_Y + 0.9}`} role="img" aria-label={label}>
      <rect className="plan-floor" x={-1} y={-0.3} width={GEO.width + 2} height={VB_Y + 0.9} rx="0.4" />
      <Racks />
      <rect className="plan-depot" x={DEPOT[0] - 1.8} y={Y(0.1) - 0.45} width={3.6} height={0.9} rx="0.15" />
      <text className="plan-text" x={DEPOT[0]} y={Y(0.1) + 0.15} textAnchor="middle">
        DISPATCH
      </text>
      {routes.map((r, i) => (
        <path key={i} className={`plan-route ${r.tone}`} d={path(r.pts)} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - (r.draw ?? 1)} style={{ opacity: r.opacity ?? 1 }} />
      ))}
      {items.map((it) => (
        <g key={it.id} transform={`translate(${it.x} ${Y(it.z)})`} className={`plan-item cls-${it.cls}${it.hot ? " hot" : ""}${it.dim ? " dim" : ""}`}>
          <rect x={-0.46} y={-0.46} width={0.92} height={0.92} rx="0.14" />
          <text y={0.2} textAnchor="middle">
            {it.cls}
          </text>
          <title>{`${it.id} · class ${it.cls} (illustrative)`}</title>
        </g>
      ))}
      {walker && <circle className="plan-walker" cx={walker[0]} cy={Y(walker[1])} r={0.34} />}
      {notes.map((n, i) => (
        <text key={i} className="plan-note" x={n.x} y={Y(n.z)} textAnchor={n.anchor || "start"} style={{ opacity: n.opacity ?? 1 }}>
          {n.text}
        </text>
      ))}
    </svg>
  );
}
