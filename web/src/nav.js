// Navigation map. `id` values are the existing URL-hash tab ids: do not rename them.
import { Activity, BarChart3, BookOpen, CalendarClock, ClipboardList, LayoutDashboard, Layers, Package, PackagePlus, Route, ShieldCheck, SlidersHorizontal, TrendingUp, Upload, Wallet, Warehouse } from "lucide-react";

// `live: true` pages work on the live warehouse (stock, orders, work orders), not on a stored experiment run: no scenario selector.
export const NAV = [
  {
    group: "Operations",
    items: [
      { id: "live", label: "Live Warehouse", icon: Activity, live: true, title: "Live Warehouse", subtitle: "What is in every bin right now: stock levels, low pick faces, work in progress and alerts" },
      { id: "inventory", label: "Inventory", icon: Package, live: true, title: "Inventory", subtitle: "Units in every pick face and in reserve. Record sales and corrections; every change is logged" },
      { id: "receiving", label: "Receiving", icon: PackagePlus, live: true, title: "Receiving", subtitle: "Book a delivery: top up a pick face, or place a new product in the best legal bin" },
      { id: "orders", label: "Work Orders", icon: ClipboardList, live: true, title: "Work Orders", subtitle: "Refills and re-slotting moves for the floor team, and the nightly planner" },
    ],
  },
  {
    group: "Results",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard, title: "Warehouse Performance Overview", subtitle: "How much walking, time and space the proposed layout saves, tested on orders it has never seen" },
      { id: "impact", label: "Business Impact", icon: Wallet, title: "Business Impact", subtitle: "Turn the simulated gains into hours and money using your own assumptions" },
    ],
  },
  {
    group: "Warehouse",
    items: [
      { id: "layout", label: "Warehouse Layout", icon: Warehouse, title: "Warehouse Layout", subtitle: "Compare where products sit before and after optimization, and inspect any single product" },
      { id: "path", label: "Pick Path Simulator", icon: Route, title: "Pick Path Simulator", subtitle: "Watch the same customer order picked on three different layouts" },
    ],
  },
  {
    group: "Optimization",
    items: [
      { id: "tradeoff", label: "Optimization Trade-offs", icon: SlidersHorizontal, title: "Optimization Trade-offs", subtitle: "Choose what the layout should favour and see the consequences" },
      { id: "stress", label: "Demand Surge", icon: TrendingUp, title: "Demand Surge", subtitle: "Stress test: what happens when a group of products suddenly sells much more" },
      { id: "general", label: "Generalization", icon: Layers, title: "Generalization", subtitle: "Does the method hold up when the customer mix or the dataset changes?" },
      { id: "forecast", label: "Forecast & Re-slotting", icon: CalendarClock, title: "Forecast & Re-slotting", subtitle: "Weekly demand forecasts, and whether moving products over time pays off" },
    ],
  },
  {
    group: "Evidence",
    items: [
      { id: "eda", label: "Data Analysis", icon: BarChart3, title: "Data Analysis", subtitle: "What the order history looks like: concentration, baskets, space and bought-together patterns" },
      { id: "rules", label: "Constraints", icon: ShieldCheck, title: "Constraints", subtitle: "Independent validator results: every safety and capacity rule, layout by layout" },
      { id: "method", label: "Methodology", icon: BookOpen, title: "Methodology", subtitle: "How a product is assigned to a storage bin, and how the result is tested" },
    ],
  },
  {
    group: "Setup",
    items: [{ id: "setup", label: "Setup", icon: Upload, live: true, title: "Setup", subtitle: "Import your own warehouse: bins, products, order history and starting stock" }],
  },
];

export const NAV_ITEMS = NAV.flatMap((g) => g.items);
export const DEFAULT_TAB = "overview";
export const HOME = "home"; // landing page: not a dashboard tab, so it is not in NAV

const PRESET_ORDER = ["fulfilment_centre", "grocery", "dark_store"];
/** Presets first, then company runs, newest first. Shared by the dashboard and the landing page so both pick the same default scenario. */
export const sortRuns = (runs) => {
  const rank = (r) => (PRESET_ORDER.includes(r.profile) ? PRESET_ORDER.indexOf(r.profile) : 99);
  return [...runs].sort((a, b) => rank(a) - rank(b) || b.id - a.id);
};
export const findItem = (id) => NAV_ITEMS.find((i) => i.id === id) || NAV_ITEMS[0];

// Scenario names shown in the selector and in page headers.
export const PROFILE = { fulfilment_centre: "Fulfilment centre", grocery: "Grocery dark store", dark_store: "Dark store" };
export const scenarioName = (run) => PROFILE[run.profile] || run.dataset;
export const scenarioLabel = (run) => (PROFILE[run.profile] ? `${PROFILE[run.profile]} · ${run.dataset}` : run.dataset);
