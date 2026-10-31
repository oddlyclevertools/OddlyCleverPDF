// Looks: pick a colour set + live background (see looks/). Remembered on this device. The first
// visit follows the system: Ink Night when it's dark, Paper Desk when it's light.
import "./looks/looks.css";
import { el, icon, modal, toggle } from "./kit.js";
import { stagger } from "./motion.js";
import { registerTopAction, registerCommands } from "./shell.js";
import { LOOKS, lookById } from "./looks/catalog.js";
import { createBackdrop, colours, stillFrame } from "./looks/backdrop.js";

const KEY = "ocpdf.look";
const OPTS = "ocpdf.lookopts";
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const sysDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let backdrop = null;
let opts = read(OPTS, { calm: false, behindPages: false });
const currentId = () => read(KEY, "") || (sysDark() ? "ink-night" : "paper-desk");

function apply(id = currentId()) {
  const look = lookById(id);
  const root = document.documentElement;
  for (const l of LOOKS) for (const k of Object.keys(l.vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v);
  root.dataset.theme = look.dark ? "dark" : "light";
  root.dataset.look = look.id;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", colours().desk));
  refreshBackdrop(true);
  return look;
}

function refreshBackdrop(rebuild) {
  if (!backdrop) return;
  const inEditor = document.body.dataset.view === "editor";
  const still = opts.calm || reduced() || (inEditor && !opts.behindPages);
  document.documentElement.dataset.calm = String(!!opts.calm);
  backdrop.set(lookById(currentId()).scene, still);
  if (rebuild) backdrop.rebuild();
}

/** Set a look by id (also used by the AI and the tests). */
export function setLook(id) {
  write(KEY, id);
  document.documentElement.classList.add("theme-swap");
  apply(id);
  setTimeout(() => document.documentElement.classList.remove("theme-swap"), 500);
}

export function openLooks() {
  const grid = el("div.lk-grid", { role: "radiogroup", "aria-label": "Looks" });
  const draw = () => {
    grid.replaceChildren(...LOOKS.map((l) => {
      const cv = el("canvas.lk-prev", { width: 300, height: 180 });
      const on = l.id === currentId();
      const card = el("button.lk-card", { type: "button", role: "radio", "aria-checked": String(on), class: on ? "on" : null,
        on: { click: () => { setLook(l.id); draw(); } } },
        cv, el("span.lk-name", {}, l.name, on ? icon("Check", 16) : null), el("small", {}, l.blurb),
        el("span.lk-sw", {}, l.swatch.map((c) => el("i", { style: { background: c } }))));
      // a still frame of the scene in the look's own colours
      requestAnimationFrame(() => {
        const c = { ...colours(), desk: l.vars["--desk"] || (l.dark ? "#15111a" : "#fff4e3"), accent: l.vars["--accent"] || "#ff2e7e" };
        try { stillFrame(cv, l.scene, c); } catch (e) { console.error("[looks] preview", e); }
      });
      return card;
    }));
    stagger(grid, { max: 8 });
  };
  draw();
  const calm = toggle({ label: "Calm mode (no movement)", value: opts.calm, onChange: (v) => { opts = { ...opts, calm: v }; write(OPTS, opts); refreshBackdrop(); } });
  const behind = toggle({ label: "Keep it moving behind my pages", value: opts.behindPages, onChange: (v) => { opts = { ...opts, behindPages: v }; write(OPTS, opts); refreshBackdrop(); } });
  modal("Pick a look", el("div.lk", {}, el("p.muted", {}, "Colours and a live background, all made for this app. Your pick stays on this device."), grid,
    el("div.lk-opts", {}, calm, behind), el("p.muted.small", {}, "Backgrounds pause when the tab is hidden and slow down when you're away.")), { wide: true });
}

export function installTheme() {
  apply();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!read(KEY, "")) apply(); });
  queueMicrotask(() => {
    backdrop = createBackdrop(document.body);
    refreshBackdrop(true);
    // calmer while editing: the background holds still unless asked to move
    new MutationObserver(() => refreshBackdrop()).observe(document.body, { attributes: true, attributeFilter: ["data-view"] });
  });
  registerTopAction({
    id: "theme", order: 40,
    render: () => el("button.icon-btn.theme-btn.keep-home.hide-phone-editor", { type: "button", "aria-label": "Change the look", title: "Change the look", on: { click: openLooks } }, icon("Palette", 19)),
  });
  registerCommands(() => [
    { id: "looks", label: "Change the look", group: "Look", icon: "Palette", keywords: "theme dark light background colour color night", run: openLooks },
    ...LOOKS.map((l) => ({ id: `look:${l.id}`, label: `Look: ${l.name}`, group: "Look", icon: "Palette", keywords: "theme background", run: () => setLook(l.id) })),
  ]);
}
