import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Menu, Warehouse, X } from "lucide-react";
import { NAV } from "../nav.js";
import { Select } from "../ui.jsx";

export function Sidebar({ tab, onNavigate, collapsed, onToggleCollapse, drawerOpen, onCloseDrawer }) {
  const firstRef = useRef(null);
  useEffect(() => {
    if (drawerOpen) firstRef.current?.focus();
  }, [drawerOpen]);
  return (
    <>
      <aside className="sidebar" id="primary-nav" aria-label="Sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Warehouse size={22} />
          </span>
          <div className="brand-text">
            <div className="brand-name">Warehouse Slotting Engine</div>
            <div className="brand-sub">Warehouse intelligence</div>
          </div>
        </div>
        <nav aria-label="Dashboard sections">
          {NAV.map((g, gi) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-label">{g.group}</div>
              {g.items.map((it, ii) => {
                const Icon = it.icon;
                const active = it.id === tab;
                return (
                  <button
                    key={it.id}
                    ref={gi === 0 && ii === 0 ? firstRef : null}
                    className="nav-item"
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? it.label : undefined}
                    title={collapsed ? it.label : undefined}
                    onClick={() => onNavigate(it.id)}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <span className="nav-text">{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-note">Read-only dashboard. Results are computed offline and stored; nothing runs live here.</div>
          <button className="collapse-btn" onClick={onToggleCollapse} aria-expanded={!collapsed} aria-controls="primary-nav" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : (<><ChevronLeft size={18} aria-hidden="true" /><span className="nav-text">Collapse</span></>)}
          </button>
        </div>
      </aside>
      <div className="backdrop" onClick={onCloseDrawer} aria-hidden="true" />
    </>
  );
}

const STATUS = {
  loading: ["loading", "Connecting…"],
  ok: ["ok", "Stored results"],
  error: ["error", "Can't reach the API"],
};

export function Topbar({ item, runs, scenarioId, onScenario, profileLabel, onMenu, drawerOpen, apiState }) {
  const [state, text] = STATUS[apiState] || STATUS.loading;
  return (
    <header className="topbar">
      <button className="menu-btn" onClick={onMenu} aria-label={drawerOpen ? "Close navigation" : "Open navigation"} aria-expanded={drawerOpen} aria-controls="primary-nav">
        {drawerOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      <div className="topbar-title">
        <h1>{item.title}</h1>
        <p>{item.subtitle}</p>
      </div>
      <div className="topbar-tools">
        {runs.length > 0 && (
          <div className="scenario">
            <Select
              label="Scenario"
              id="scenario-select"
              value={scenarioId ?? ""}
              onChange={(v) => onScenario(Number(v))}
              options={runs.map((r) => ({ value: r.id, label: profileLabel(r) }))}
            />
          </div>
        )}
        <span className="status" data-state={state} role="status">
          <i aria-hidden="true" />
          <span>{text}</span>
        </span>
      </div>
    </header>
  );
}
