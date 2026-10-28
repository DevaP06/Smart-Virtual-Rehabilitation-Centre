// Shared helpers for the live-operations pages: API calls with readable errors, polling data, the selected warehouse.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, RefreshCw, Upload, Warehouse } from "lucide-react";
import { EmptyState, Note, Select, Skeleton } from "../ui.jsx";

/* ------------------------------------------------------------------ calls */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function messageOf(body, r) {
  const d = body?.detail;
  if (d && typeof d === "object" && !Array.isArray(d) && d.message) return d.message;
  if (Array.isArray(d)) return d.map((x) => `${(x.loc || []).slice(1).join(".") || "value"}: ${x.msg}`).join(". ");
  if (typeof d === "string") return d;
  return `${r.status} ${r.statusText || "request failed"}`;
}

/** fetch JSON; throws ApiError with the server's plain-language message. */
export async function call(path, { method = "GET", body } = {}) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (for example a platform error page): reported below */
  }
  if (!r.ok) throw new ApiError(messageOf(data, r), r.status, data?.detail?.data ?? null);
  return data;
}

/** A random key so a retried write (double click, flaky network) is applied once. */
export const newKey = () => (window.crypto?.randomUUID ? window.crypto.randomUUID().replace(/-/g, "").slice(0, 32) : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`);

/* ------------------------------------------------------------------ selected warehouse (shared by every live page) */
let current = null;
const subs = new Set();
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const setWarehouse = (id) => {
  current = id;
  subs.forEach((f) => f());
};
export const useWarehouseId = () => useSyncExternalStore(subscribe, () => current);
export const withWh = (path, wh) => (wh ? `${path}${path.includes("?") ? "&" : "?"}warehouse=${wh}` : path);

/* ------------------------------------------------------------------ data */
/** Like useApi but keeps showing the previous data while it refreshes, and can poll. */
export function useLive(path, { poll = 0 } = {}) {
  const [s, setS] = useState({ data: null, error: null, loading: !!path, loaded: false, at: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    const load = (first) => {
      if (first) setS((p) => ({ ...p, loading: true, error: null }));
      call(path)
        .then((data) => live && setS({ data, error: null, loading: false, loaded: true, at: Date.now() }))
        .catch((error) => live && setS((p) => ({ ...p, error, loading: false })));
    };
    load(true);
    const id = poll ? setInterval(() => document.visibilityState === "visible" && load(false), poll) : 0;
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [path, poll, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...s, refresh };
}

/** Run a write: tracks busy / error / result so a button can show progress and the message. */
export function useAction() {
  const [s, setS] = useState({ busy: false, error: null, result: null });
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const run = useCallback(async (fn) => {
    setS({ busy: true, error: null, result: null });
    try {
      const result = await fn();
      if (alive.current) setS({ busy: false, error: null, result });
      return result;
    } catch (error) {
      if (alive.current) setS({ busy: false, error, result: null });
      return undefined;
    }
  }, []);
  const clear = useCallback(() => setS({ busy: false, error: null, result: null }), []);
  return { ...s, run, clear };
}

/** Skeleton before the first load, a retry panel if it never loaded, the children once there is data (stale data stays visible). */
export function LiveAsync({ state, children, skeleton = "page", label }) {
  if (!state.loaded && state.loading) return <Skeleton variant={skeleton} label={label} />;
  if (!state.loaded && state.error) {
    return (
      <div className="state-panel error fade-in" role="alert">
        <AlertTriangle size={30} aria-hidden="true" />
        <h3>Couldn't load {label}</h3>
        <p>{state.error.message}</p>
        {state.error.status === 404 ? null : (
          <button className="btn primary" onClick={state.refresh}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    );
  }
  if (!state.loaded) return null;
  return (
    <>
      {state.error && (
        <Note kind="warn">
          Showing the last data received. The latest refresh failed: {state.error.message}
        </Note>
      )}
      {children(state.data)}
    </>
  );
}

/** Shown by every live page when no warehouse has been imported yet. */
export function NoWarehouse({ message }) {
  return (
    <EmptyState
      icon={Warehouse}
      title="No warehouse set up yet"
      action={
        <button className="btn primary" onClick={() => (window.location.hash = "setup")}>
          <Upload size={16} aria-hidden="true" /> Open Setup
        </button>
      }
    >
      {message || "Import your bins and products on the Setup page, or run scripts/seed_live.py to load the demo warehouse."}
    </EmptyState>
  );
}

/** The error of an action as a note (nothing when there is none). */
export function ActionError({ error }) {
  if (!error) return null;
  return (
    <div role="alert">
      <Note kind="warn">{error.message}</Note>
    </div>
  );
}

/** Warehouse chooser, shown only when more than one warehouse exists. Also sets the shared selection. */
export function WarehouseBar() {
  const list = useLive("/api/live/warehouses");
  const wh = useWarehouseId();
  useEffect(() => {
    if (list.data?.length && !list.data.some((w) => w.id === wh)) setWarehouse(list.data[0].id);
  }, [list.data, wh]);
  if (!list.data || list.data.length < 2) return null;
  return (
    <div className="toolbar" style={{ marginBottom: 0 }}>
      <Select label="Warehouse" value={wh ?? ""} onChange={(v) => setWarehouse(Number(v))} options={list.data.map((w) => ({ value: w.id, label: `${w.name}${w.source === "demo" ? " (demo)" : ""}` }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ small formatting helpers */
export const nf = (v) => (v == null ? "–" : Number(v).toLocaleString("en-US"));
export function ago(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - (typeof ts === "number" ? ts : Date.parse(ts))) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
/** Re-render every `ms` so "updated 12 s ago" stays true. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
export const STATUS_TONE = { ok: "good", replenish: "warn", reorder: "warn", stockout: "bad", unplaced: "bad", low: "warn", empty: "bad" };
export const STATUS_LABEL = { ok: "OK", replenish: "Refill face", reorder: "Reorder", stockout: "Out of stock", unplaced: "No bin yet", low: "Low", empty: "Empty" };
