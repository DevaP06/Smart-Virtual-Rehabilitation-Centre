import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null);
export const prefersReducedMotion = () => !!mq()?.matches;
export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = mq();
      m?.addEventListener?.("change", cb);
      return () => m?.removeEventListener?.("change", cb);
    },
    prefersReducedMotion,
    () => false,
  );
}

/** [ref, seen]: seen turns true once the element has been on screen and stays true, so reveals play once. Always true under reduced motion. */
export function useInView(threshold = 0.25) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen || reduced];
}

/** 0..1 progress that runs once when `active` becomes true. Instant under reduced motion. */
export function useEased(active, ms = 700) {
  const reduced = useReducedMotion();
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    if (reduced) {
      setP(1);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, ms, reduced]);
  return p;
}

/** Moves a 0..1 value toward `target` over `ms` (the baseline/optimized morph). Jumps under reduced motion. */
export function useTween(target, ms = 1600) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced) {
      cur.current = target;
      setV(target);
      return undefined;
    }
    const from = cur.current;
    if (from === target) return undefined;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cur.current = from + (target - from) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}
