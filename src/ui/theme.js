// Day (warm paper) or night (ink desk). Follows the system until the person picks one.
import { el, icon } from "./kit.js";
import { registerTopAction } from "./shell.js";

const KEY = "ocpdf.theme";
const sys = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function pick() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
function apply() { document.documentElement.dataset.theme = pick() || sys(); }

export function installTheme() {
  apply();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  registerTopAction({
    id: "theme", order: 40,
    render: () => {
      const b = el("button.icon-btn.theme-btn.hide-phone-editor", { type: "button", "aria-label": "Day or night look", title: "Day or night look", on: { click: () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch { /* */ }
        document.documentElement.classList.add("theme-swap");
        apply();
        setTimeout(() => document.documentElement.classList.remove("theme-swap"), 500);
      } } }, icon("SunMoon", 19));
      return b;
    },
  });
}
