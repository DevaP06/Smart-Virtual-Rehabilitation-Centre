// The Spatial section's worked example: one illustrative product tested against four illustrative bins.
// The verdicts are computed from these inputs (not typed in), and the 3D stage reads the same list so both always agree.
export const PRODUCT = { id: "SKU-203", dims: [38, 28, 22], kg: 14, hazard: "flammable" };
export const HEAVY_LIMIT_KG = 10; // example limit for levels above 3

// `bin` is where the case sits in the 3D warehouse: [rack, col, row, level index]. `cell` is its place in the SVG rack elevation.
export const CANDS = [
  { loc: "A2-04-L2", dims: [60, 40, 40], level: 2, zone: "hazard", cell: [1, 2], bin: [1, 1, 3, 1] },
  { loc: "A1-02-L1", dims: [30, 30, 40], level: 1, zone: "hazard", cell: [0, 1], bin: [1, 1, 1, 0] },
  { loc: "A3-06-L4", dims: [60, 40, 40], level: 4, zone: "hazard", cell: [2, 4], bin: [1, 1, 5, 3] },
  { loc: "A2-09-L2", dims: [60, 40, 40], level: 2, zone: "general", cell: [2, 2], bin: [1, 1, 7, 1] },
];
const vol = (d) => d[0] * d[1] * d[2];

export function check(c) {
  if (PRODUCT.dims.some((d, i) => d > c.dims[i])) return { ok: false, rule: "dimension_overflow", short: "too small", why: `${PRODUCT.dims[0]} cm wide, bin is ${c.dims[0]} cm × ${c.dims[1]} cm` };
  if (PRODUCT.kg > HEAVY_LIMIT_KG && c.level > 3) return { ok: false, rule: "heavy_too_high", short: "too high", why: `${PRODUCT.kg} kg on level ${c.level} (example limit ${HEAVY_LIMIT_KG} kg above level 3)` };
  if (PRODUCT.hazard !== "none" && c.zone !== "hazard") return { ok: false, rule: "hazard_zone_breach", short: "hazard zone", why: `${PRODUCT.hazard} product outside the hazard zone` };
  return { ok: true, short: "fits", why: `fits, ${Math.round((100 * vol(PRODUCT.dims)) / vol(c.dims))}% of the bin volume, ${PRODUCT.kg} kg` };
}
export const VERDICTS = CANDS.map(check);
