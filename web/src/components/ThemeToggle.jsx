import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "../theme.js";

export default function ThemeToggle({ className = "" }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" className={`icon-btn ${className}`} onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Warehouse Paper (light)" : "Night Shift (dark)"}>
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
