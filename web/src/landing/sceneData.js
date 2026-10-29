// Illustrative warehouse used by the landing page. NOTHING here is a stored or measured result: it is a small, hand-made layout whose only
// job is to explain the ideas (demand classes, placement, routes). Every place it is shown labels it as illustrative.
//
// Plan geometry (metres-ish): 4 back-to-back racks, 3 aisles between them, a front cross-aisle and a dispatch depot at the front.
// Rack r spans x = 5r .. 5r+2 (two bin columns). Aisle a is the 3 m gap between rack a and rack a+1.
export const GEO = { racks: 4, cols: 2, rows: 8, levels: 4, pitch: 1.2, front: 2.4, rackStep: 5, width: 17 };
export const DEPOT = [8.5, 0.6]; // centre of aisle 1, on the front cross-aisle
export const CROSS_Z = 0.6;
export const aisleX = (a) => a * GEO.rackStep + 3.5;
export const binXZ = (rack, col, row) => [rack * GEO.rackStep + 0.5 + col, GEO.front + row * GEO.pitch];
export const aisleOf = (rack, col) => (col === 1 ? rack : rack - 1); // the aisle a bin is picked from (-1 / 3 = wall side)
export const depth = GEO.front + GEO.rows * GEO.pitch;
export const binLabel = (rack, col, row, level) => `A${aisleOf(rack, col) + 1}-${String(row + 1).padStart(2, "0")}-L${level + 1}`;

// Eight illustrative products. cls = demand class, grp = bought-together group, w = illustrative relative demand.
// base / opt = [rack, col, row, level] before and after "slotting".
export const ITEMS = [
  { id: "SKU-101", cls: "A", grp: 1, w: 96, base: [0, 1, 6, 0], opt: [1, 1, 0, 1] },
  { id: "SKU-102", cls: "A", grp: 1, w: 88, base: [3, 0, 2, 3], opt: [1, 1, 1, 1] },
  { id: "SKU-103", cls: "A", grp: 2, w: 74, base: [2, 1, 7, 1], opt: [2, 0, 0, 1] },
  { id: "SKU-104", cls: "B", grp: 1, w: 46, base: [1, 0, 5, 2], opt: [1, 1, 2, 1] },
  { id: "SKU-105", cls: "B", grp: 2, w: 38, base: [1, 1, 7, 0], opt: [2, 0, 1, 1] },
  { id: "SKU-106", cls: "C", grp: 3, w: 14, base: [2, 0, 1, 2], opt: [0, 1, 5, 0] },
  { id: "SKU-107", cls: "C", grp: 3, w: 9, base: [1, 1, 3, 1], opt: [3, 0, 5, 0] },
  { id: "SKU-108", cls: "B", grp: 3, w: 30, base: [0, 1, 2, 2], opt: [1, 0, 0, 2] },
];
export const ORDER_IDS = ["SKU-101", "SKU-102", "SKU-103", "SKU-104", "SKU-105"]; // the demo customer order
export const itemById = (id) => ITEMS.find((i) => i.id === id);

/** Plan position [x, z] of an item in the baseline or optimized arrangement. */
export const itemXZ = (it, which) => binXZ(...(which === "opt" ? it.opt : it.base).slice(0, 3));

/** Return-route walk (front cross-aisle only): visit each needed aisle left to right, go in as deep as needed, come back out. */
export function routePoints(which, ids = ORDER_IDS) {
  const deepest = new Map(); // aisle -> deepest z
  ids.forEach((id) => {
    const it = itemById(id);
    const b = which === "opt" ? it.opt : it.base;
    const a = aisleOf(b[0], b[1]);
    const [, z] = binXZ(...b.slice(0, 3));
    deepest.set(a, Math.max(deepest.get(a) ?? 0, z));
  });
  const pts = [DEPOT];
  [...deepest.keys()].sort((p, q) => p - q).forEach((a) => {
    pts.push([aisleX(a), CROSS_Z], [aisleX(a), deepest.get(a)], [aisleX(a), CROSS_Z]);
  });
  pts.push(DEPOT);
  return pts;
}

/** Path an item travels when it is re-slotted: out to its aisle, to the front, across, up the new aisle, into the bin. Never through a rack. */
export function movePath(it) {
  const [bx, bz] = itemXZ(it, "base");
  const [ox, oz] = itemXZ(it, "opt");
  const a0 = aisleOf(it.base[0], it.base[1]);
  const a1 = aisleOf(it.opt[0], it.opt[1]);
  const pts = [[bx, bz], [aisleX(a0), bz]];
  if (a0 !== a1) pts.push([aisleX(a0), CROSS_Z], [aisleX(a1), CROSS_Z]);
  else if (Math.abs(bz - oz) > 0.01) pts.push([aisleX(a0), oz]);
  pts.push([aisleX(a1), oz], [ox, oz]);
  return pts;
}

export function polyLength(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  return t;
}
/** Point after walking fraction f (0..1) of an axis-aligned polyline. */
export function pointAt(pts, f) {
  const total = polyLength(pts);
  let d = Math.min(1, Math.max(0, f)) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (d <= len || i === pts.length - 1) {
      const k = len ? Math.min(1, d / len) : 1;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    d -= len;
  }
  return pts[pts.length - 1];
}

// Deterministic decorative fill so the racks look stocked. Not data.
const hash = (a, b, c, d) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 2654435761)) >>> 0) % 100;
export const isStocked = (rack, col, row, level) => hash(rack + 1, col + 1, row + 1, level + 1) < 62;

export const ALL_BINS = [];
for (let r = 0; r < GEO.racks; r++) for (let c = 0; c < GEO.cols; c++) for (let w = 0; w < GEO.rows; w++) for (let l = 0; l < GEO.levels; l++) ALL_BINS.push([r, c, w, l]);
