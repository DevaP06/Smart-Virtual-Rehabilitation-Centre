import { useEffect, useState } from "react";
import { Async, useApi } from "./ui.jsx";
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

const TABS = [
  ["overview", "Results", Overview],
  ["impact", "Business impact", Impact],
  ["layout", "Layout", Layout],
  ["path", "Pick path", PickPath],
  ["tradeoff", "Trade-offs", Tradeoff],
  ["stress", "Demand surge", Stress],
  ["eda", "Data analysis", Eda],
  ["rules", "Constraints", Constraints],
  ["forecast", "Forecast & re-slotting", Forecast],
  ["method", "Method", Method],
];
const ORDER = ["fulfilment_centre", "dark_store"];
const PROFILE = { fulfilment_centre: "Fulfilment centre", dark_store: "Dark store" };

export default function App() {
  const runs = useApi("/api/runs");
  const [runId, setRunId] = useState(null);
  const [tab, setTab] = useState(() => window.location.hash.slice(1) || "overview");
  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);
  const rank = (r) => (ORDER.includes(r.profile) ? ORDER.indexOf(r.profile) : 99);   // presets first, then company runs
  const sorted = runs.data ? [...runs.data].sort((a, b) => rank(a) - rank(b) || b.id - a.id) : [];
  const id = runId ?? sorted[0]?.id;
  const detail = useApi(id ? `/api/runs/${id}` : null);
  const Tab = (TABS.find((t) => t[0] === tab) || TABS[0])[2];

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Warehouse Slotting Engine</h1>
          <div className="sub">Demand-aware SKU-to-bin assignment with rule enforcement and measured gains</div>
        </div>
        {sorted.length > 0 && (
          <div className="run-pick">
            Scenario
            <select value={id ?? ""} onChange={(e) => setRunId(Number(e.target.value))}>
              {sorted.map((r) => (
                <option key={r.id} value={r.id}>
                  {PROFILE[r.profile] ? `${PROFILE[r.profile]} · ${r.dataset}` : r.dataset}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={k === tab ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <Async state={runs}>
        {(list) =>
          list.length === 0 ? (
            <div className="state">No runs stored yet. Run <code>python scripts/seed_db.py</code> to create one.</div>
          ) : (
            <Async state={detail}>{(run) => <Tab key={`${run.id}-${tab}`} run={run} />}</Async>
          )
        }
      </Async>
    </div>
  );
}
