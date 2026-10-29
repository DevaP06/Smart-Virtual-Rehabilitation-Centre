import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { NAV } from "../nav.js";
import Logo from "./Logo.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { Select } from "../ui.jsx";

export function Sidebar({ tab, onNavigate, collapsed, onToggleCollapse, drawerOpen, onCloseDrawer }) {
  const firstRef = useRef(null);
  useEffect(() => {
    if (drawerOpen) firstRef.current?.focus();
  }, [drawerOpen]);
  return (
    <>
      <aside className="sidebar" id="primary-nav" aria-label="Sidebar">
        <button className="brand" onClick={() => onNavigate("home")} aria-label="The Living Warehouse: back to the home page" title="Home">
          <span className="brand-mark" aria-hidden="true">
            <Logo />
          </span>
          <span className="brand-text">
            <span className="brand-name">The Living Warehouse</span>
            <span className="brand-sub">Every slot has a strategy</span>
          </span>
        </button>
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
          <div className="sidebar-note">Results pages show analysis computed offline and stored. Operations pages work on live stock and orders.</div>
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
  live: ["ok", "Live data"],
  error: ["error", "Can't reach the API"],
};

export function Topbar({ item, runs, scenarioId, onScenario, profileLabel, onMenu, drawerOpen, apiState }) {
  const [state, text] = STATUS[apiState] || STATUS.loading;
  const group = NAV.find((g) => g.items.some((i) => i.id === item.id))?.group;
  return (
    <header className="topbar">
      <button className="menu-btn" onClick={onMenu} aria-label={drawerOpen ? "Close navigation" : "Open navigation"} aria-expanded={drawerOpen} aria-controls="primary-nav">
        {drawerOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      <div className="topbar-title">
        {group && <div className="crumb">{group}</div>}
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
        <ThemeToggle />
      </div>
    </header>
  );
}
