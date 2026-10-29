// Theme management: "light" (Warehouse Paper, default) and "dark" (Night Shift). The explicit choice is stored in localStorage;
// index.html applies it before first paint, this module keeps the DOM, the chart palette and React in step afterwards.
import { useSyncExternalStore } from "react";
import { setChartPalette } from "./chartTheme.js";

const KEY = "theme";
const META = { light: "#F3F1E8", dark: "#111B17" };

const stored = () => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
};

let current = stored() || "light"; // ponytail: system preference not followed; add matchMedia fallback here if wanted
const listeners = new Set();

function apply(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[theme]);
  setChartPalette(theme);
}
apply(current);

export function setTheme(theme) {
  if (theme === current) return;
  current = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export const useTheme = () => useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => current);

/** Colours for the three.js scenes (they cannot read CSS variables). */
const SCENE = {
  light: { grid1: "#b9c0b3", grid2: "#dde1d6", ghost: "#8996a3", ghostOpacity: 0.35, depot: "#d89545", dim: "#cdd3c8", rack: "#9aa59d", floor: "#cdd3c3", floorEdge: "#a9b2a0", lane: "#e7eadc", bgTop: "#f8f7ef", bgBottom: "#dde2d3", sky: "#ffffff", ground: "#b9c0b0", wire: "#26332e", bin1: "#c9cfc2", bin2: "#b6beae", hot: "#d89545", opt: "#008b68", route: "#008b68", upright: "#56665d", beam: "#8d9b92", cb: "#7d8c9c", cc: "#aeb7ab", bad: "#c64c45", carton: "#c9a26d", cartonIn: "#b58d57", paper: "#fbfaf6", bench: "#9aa59d" },
  dark: { grid1: "#3f5046", grid2: "#26332d", ghost: "#7d8f86", ghostOpacity: 0.3, depot: "#e1a15a", dim: "#34443b", rack: "#566a5f", floor: "#2b4338", floorEdge: "#3a5a4b", lane: "#4a6558", bgTop: "#0b1310", bgBottom: "#1b2b25", sky: "#a9c0b4", ground: "#0b1210", wire: "#edf2ec", bin1: "#4b6156", bin2: "#3f5448", hot: "#e1a15a", opt: "#35b08c", route: "#35b08c", upright: "#97ab9f", beam: "#6c8277", cb: "#8798a9", cc: "#4a5a50", bad: "#f08078", carton: "#b38e5a", cartonIn: "#8f6f44", paper: "#2a3730", bench: "#566a5f" },
};
export const sceneColors = (theme = current) => SCENE[theme];
