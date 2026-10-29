// Landing-page results, read from the same stored-results API the dashboard uses (/api/runs, /api/runs/:id, /api/runs/:id/kpis).
// The derivation mirrors tabs/Overview.jsx, so a number on the landing page is the number on the Overview page.
// If anything is missing or the API is down this reports status "error" / "empty": there is no fallback data.
import { useApi } from "../ui.jsx";
import { scenarioName, sortRuns } from "../nav.js";

export function useResults() {
  const runs = useApi("/api/runs");
  const sorted = runs.data ? sortRuns(runs.data) : [];
  const wanted = Number(new URLSearchParams(window.location.search).get("run")) || null; // same ?run=<id> as the dashboard
  const id = wanted ?? sorted[0]?.id ?? null;
  const detail = useApi(id ? `/api/runs/${id}` : null);
  const kpis = useApi(id ? `/api/runs/${id}/kpis` : null);
  const retry = () => [runs, detail, kpis].forEach((s) => s.retry?.());

  if (runs.loading || (id && (detail.loading || kpis.loading))) return { status: "loading", retry };
  const error = runs.error || detail.error || kpis.error;
  if (error) return { status: "error", error, retry };
  if (!id) return { status: "empty", retry };
  if (!detail.data || !kpis.data) return { status: "loading", retry };

  try {
    const run = detail.data;
    const k = kpis.data;
    const H = run.summary.headline;
    const v = (p, m) => k[p].kpis[m].value;
    const ci = k[H].ci.return;
    const t0 = v("B0_random", "avg_route_time_s");
    const t1 = v(H, "avg_route_time_s");
    const data = {
      run,
      scenario: scenarioName(run),
      headline: H,
      nTest: run.summary.n_test,
      createdAt: run.created_at,
      distReduction: ci.reduction_pct,
      distCi: [ci.reduction_ci_low, ci.reduction_ci_high],
      distPerOrder: [k.B0_random.ci.return.mean_dist_per_order, ci.mean_dist_per_order], // metres per order: random, headline layout
      time: [t0, t1],
      timeReduction: 100 * (1 - t1 / t0),
      fill: v(H, "fill_rate_pct"),
      fillRandom: v("B0_random", "fill_rate_pct"),
      violations: k[H].violations,
      violationsNaive: k.naive?.violations,
    };
    if ([data.distReduction, data.timeReduction, data.fill, data.violations].some((x) => x == null || Number.isNaN(x))) throw new Error("The stored results are incomplete.");
    return { status: "ready", data, retry };
  } catch (e) {
    return { status: "error", error: e, retry };
  }
}
