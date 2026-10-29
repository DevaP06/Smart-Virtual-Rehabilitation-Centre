// Short annotations pinned to points in the 3D warehouse. Each says when it is visible (a function of the story) and where it sits.
// They are decorative duplicates of the section text (aria-hidden) and are all about the illustrative warehouse.
import { CANDS, VERDICTS } from "./spatialCases.js";
import { aisleX, binXZ, itemById, movePath, pointAt } from "./sceneData.js";
import { clamp01, lerp, story, weight } from "./story.js";

const LEVEL_Y = (l) => 0.35 + l * 0.95;
const itemPos = (id, A) => {
  const it = itemById(id);
  const [x, z] = pointAt(movePath(it), A);
  return [x, lerp(LEVEL_Y(it.base[3]), LEVEL_Y(it.opt[3]), A) + 0.9, z];
};

export const LABELS = [
  { id: "zone", text: "STORAGE ZONE A", anchor: () => [1, 4.5, 6.8], alpha: (u) => weight(0, u) * story.intro },
  { id: "hv", text: "HIGH-VELOCITY SKU", tone: "hot", anchor: (A) => itemPos("SKU-101", A), alpha: (u) => Math.max(weight(0, u) * story.intro, weight(1, u)) },
  { id: "route", text: "PICK ROUTE", tone: "route", anchor: (A) => [lerp(aisleX(2) + 0.2, aisleX(1) + 0.2, A), 0.7, lerp(5.2, 3, A)], alpha: (u) => Math.max(weight(0, u) * story.intro, weight(1, u) * 0.9, weight(6, u)) },
  { id: "dispatch", text: "DISPATCH", anchor: () => [8.5, 3.1, -0.5], alpha: (u) => Math.max(weight(0, u) * story.intro, weight(6, u), weight(9, u)) },
  { id: "far", text: "FAST MOVER, FAR FROM DISPATCH", tone: "hot", anchor: () => itemPos("SKU-102", 0), alpha: (u) => weight(1, u) * 0.95 },
  ...["SKU-101", "SKU-103", "SKU-105", "SKU-106"].map((id) => {
    const it = itemById(id);
    return { id: `d-${id}`, text: `${id} · CLASS ${it.cls}`, tone: `cls-${it.cls}`, anchor: (A) => itemPos(id, A), alpha: (u) => weight(2, u) * 0.95 };
  }),
  ...CANDS.map((c, i) => ({
    id: `c-${i}`,
    text: `${String.fromCharCode(65 + i)} ${VERDICTS[i].ok ? "✓ valid" : `✕ ${VERDICTS[i].short}`}`,
    tone: VERDICTS[i].ok ? "ok" : "no",
    anchor: () => {
      const [x, z] = binXZ(...c.bin.slice(0, 3));
      return [x + 0.9, LEVEL_Y(c.bin[3]) + 0.55, z];
    },
    alpha: (u) => weight(3, u) * (story.spatialShown > i ? 1 : 0),
  })),
];

export const labelAlpha = (l, u) => clamp01(l.alpha(u));
