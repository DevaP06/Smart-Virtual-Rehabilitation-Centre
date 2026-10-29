// The last beat of the walk-in transition: inside the carton, the SKU cards slide into place and become the workspace's layout
// (sidebar, header, panels), then the real dashboard replaces it. Purely visual: empty outlines, no data, no fake dashboard.
// Timing is CSS (delays line up with the 3D carton flight in StageScene).
const CARDS = [
  // [left %, top %, width %, height %, scatter x, scatter y, rotation]
  [0, 0, 17, 100, -10, 6, -9],
  [17, 0, 83, 9, 12, -8, 6],
  [19, 13, 40, 36, -6, 14, 8],
  [61, 13, 37, 36, 14, 6, -7],
  [19, 53, 24, 32, -12, -10, 5],
  [45, 53, 53, 32, 10, 12, -4],
];
export default function Bridge() {
  return (
    <div className="l-bridge" aria-hidden="true">
      <div className="l-bridge-grid" />
      {CARDS.map(([l, t, w, h, sx, sy, r], i) => (
        <i key={i} className="l-bridge-card" style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, "--sx": `${sx}vw`, "--sy": `${sy}vh`, "--sr": `${r}deg`, animationDelay: `${2.4 + i * 0.04}s` }} />
      ))}
    </div>
  );
}
