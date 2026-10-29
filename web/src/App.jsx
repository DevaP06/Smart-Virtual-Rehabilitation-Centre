import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { Async, EmptyState, ErrorPanel, useApi } from "./ui.jsx";
import { DEFAULT_TAB, HOME, NAV_ITEMS, findItem, scenarioLabel, sortRuns } from "./nav.js";
import { Sidebar, Topbar } from "./components/Shell.jsx";
import Overview from "./tabs/Overview.jsx";
import Layout from "./tabs/Layout.jsx";
import PickPath from "./tabs/PickPath.jsx";
import Eda from "./tabs/Eda.jsx";
import Constraints from "./tabs/Constraints.jsx";
import Forecast from "./tabs/Forecast.jsx";
import Method from "./tabs/Method.jsx";
import Impact from "./tabs/Impact.jsx";
import Tradeoff from "./tabs/Tradeoff.jsx";
import Stress from "./tabs/Stress.jsx";
import Generalize from "./tabs/Generalize.jsx";
import LiveWarehouse from "./tabs/LiveWarehouse.jsx";
import Inventory from "./tabs/Inventory.jsx";
import Receiving from "./tabs/Receiving.jsx";
import WorkOrders from "./tabs/WorkOrders.jsx";
import Setup from "./tabs/Setup.jsx";

// The landing page (and its 3D scene) loads only for visitors who see it; direct links to a dashboard page never download it.
const Landing = lazy(() => import("./landing/LandingPage.jsx"));

// Tab ids are the URL-hash values used before the redesign (#overview, #impact, #layout, #path, #tradeoff, #stress, #general, #eda, #rules, #forecast, #method)
// plus the live-operations pages (#live, #inventory, #receiving, #orders, #setup), which do not use a stored scenario.
const PAGES = {
  overview: Overview,
  impact: Impact,
  layout: Layout,
  path: PickPath,
  tradeoff: Tradeoff,
  stress: Stress,
  general: Generalize,
  eda: Eda,
  rules: Constraints,
  forecast: Forecast,
  method: Method,
  live: LiveWarehouse,
  inventory: Inventory,
  receiving: Receiving,
  orders: WorkOrders,
  setup: Setup,
};

const profileLabel = scenarioLabel;

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <ErrorPanel error={this.state.error} label="this page" onRetry={() => this.setState({ error: null })} />
        {this.props.escape && (
          <p style={{ textAlign: "center" }}>
            <a className="btn" href={`#${DEFAULT_TAB}`}>
              Open the dashboard instead
            </a>
          </p>
        )}
      </>
    );
  }
}

const readTab = () => {
  const h = window.location.hash.slice(1);
  if (!h || h === HOME) return HOME; // no hash: the landing page. Every existing #tab link still opens its page.
  return NAV_ITEMS.some((i) => i.id === h) ? h : DEFAULT_TAB;
};
const readCollapsed = () => {
  try {
    return window.localStorage.getItem("sidebar-collapsed") === "1";
  } catch {
    return false;
  }
};

export default function App() {
  const [tab, setTab] = useState(readTab);
  const home = tab === HOME;
  const runs = useApi(home ? null : "/api/runs"); // the landing page loads its own results; no duplicate request
  const [runId, setRunId] = useState(() => Number(new URLSearchParams(window.location.search).get("run")) || null); // ?run=<id> picks a scenario
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const mainRef = useRef(null);

  // Hash navigation: pushing a hash makes back/forward work; this listener keeps the page in step with the URL.
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", `#${HOME}`);
    const onHash = () => {
      setTab(readTab());
      setDrawer(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const item = home ? { id: HOME, live: true, title: "The Living Warehouse", subtitle: "" } : findItem(tab);
  useEffect(() => {
    document.title = home ? "The Living Warehouse · Every slot has a strategy" : `${item.title} · The Living Warehouse`;
  }, [item, home]);

  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const navigate = useCallback(
    (id) => {
      setDrawer(false);
      if (window.location.hash.slice(1) !== id) window.location.hash = id;
      requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    },
    [],
  );
  const toggleCollapse = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* storage unavailable: the preference just isn't remembered */
      }
      return !c;
    });

  const sorted = runs.data ? sortRuns(runs.data) : [];
  const id = runId ?? sorted[0]?.id;
  const detail = useApi(id && !item.live ? `/api/runs/${id}` : null);
  const Page = PAGES[tab] || Overview;

  if (home)
    return (
      <Boundary key="home" escape>
        <Suspense fallback={<div className="landing-boot" role="status">Loading…</div>}>
          <Landing onEnter={navigate} />
        </Suspense>
      </Boundary>
    );
  const apiState = item.live ? "live" : runs.loading ? "loading" : runs.error ? "error" : "ok";

  return (
    <div className="app" data-collapsed={collapsed} data-drawer={drawer}>
      <button className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <Sidebar tab={tab} onNavigate={navigate} collapsed={collapsed} onToggleCollapse={toggleCollapse} drawerOpen={drawer} onCloseDrawer={() => setDrawer(false)} />
      <div className="main">
        <Topbar item={item} runs={item.live ? [] : sorted} scenarioId={id} onScenario={setRunId} profileLabel={profileLabel} onMenu={() => setDrawer((d) => !d)} drawerOpen={drawer} apiState={apiState} />
        <main id="main" ref={mainRef} className="content" tabIndex={-1}>
          {item.live ? (
            <Boundary key={tab}>
              <Page />
            </Boundary>
          ) : (
            <Async state={runs} skeleton="page" label="scenarios">
              {(list) =>
                list.length === 0 ? (
                  <EmptyState icon={Database} title="No stored results yet">
                    The database has no experiment runs. Create them with <code>python scripts/seed_db.py</code>, then reload this page.
                  </EmptyState>
                ) : (
                  <Async state={detail} skeleton="page" label="this scenario">
                    {(run) => (
                      <Boundary key={`${run.id}-${tab}`}>
                        <Page run={run} />
                      </Boundary>
                    )}
                  </Async>
                )
              }
            </Async>
          )}
        </main>
      </div>
    </div>
  );
}
