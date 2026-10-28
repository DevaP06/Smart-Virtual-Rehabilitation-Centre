import { Component, useCallback, useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { Async, EmptyState, ErrorPanel, useApi } from "./ui.jsx";
import { DEFAULT_TAB, NAV_ITEMS, findItem, scenarioLabel } from "./nav.js";
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

// Tab ids are the URL-hash values used before the redesign (#overview, #impact, #layout, #path, #tradeoff, #stress, #general, #eda, #rules, #forecast, #method).
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
};

const ORDER = ["fulfilment_centre", "grocery", "dark_store"];
const profileLabel = scenarioLabel;

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorPanel error={this.state.error} label="this page" onRetry={() => this.setState({ error: null })} />;
  }
}

const readTab = () => {
  const h = window.location.hash.slice(1);
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
  const runs = useApi("/api/runs");
  const [runId, setRunId] = useState(() => Number(new URLSearchParams(window.location.search).get("run")) || null); // ?run=<id> picks a scenario
  const [tab, setTab] = useState(readTab);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const mainRef = useRef(null);

  // Hash navigation: pushing a hash makes back/forward work; this listener keeps the page in step with the URL.
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", `#${DEFAULT_TAB}`);
    const onHash = () => {
      setTab(readTab());
      setDrawer(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const item = findItem(tab);
  useEffect(() => {
    document.title = `${item.title} · Warehouse Slotting Engine`;
  }, [item]);

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

  const rank = (r) => (ORDER.includes(r.profile) ? ORDER.indexOf(r.profile) : 99); // presets first, then company runs
  const sorted = runs.data ? [...runs.data].sort((a, b) => rank(a) - rank(b) || b.id - a.id) : [];
  const id = runId ?? sorted[0]?.id;
  const detail = useApi(id ? `/api/runs/${id}` : null);
  const Page = PAGES[tab] || Overview;
  const apiState = runs.loading ? "loading" : runs.error ? "error" : "ok";

  return (
    <div className="app" data-collapsed={collapsed} data-drawer={drawer}>
      <button className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <Sidebar tab={tab} onNavigate={navigate} collapsed={collapsed} onToggleCollapse={toggleCollapse} drawerOpen={drawer} onCloseDrawer={() => setDrawer(false)} />
      <div className="main">
        <Topbar item={item} runs={sorted} scenarioId={id} onScenario={setRunId} profileLabel={profileLabel} onMenu={() => setDrawer((d) => !d)} drawerOpen={drawer} apiState={apiState} />
        <main id="main" ref={mainRef} className="content" tabIndex={-1}>
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
        </main>
      </div>
    </div>
  );
}
