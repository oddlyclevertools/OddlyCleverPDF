// The app frame: the top bar, the tool belt (a rail on computers, a strip along the bottom on
// phones), the side panel (a pull-up sheet on phones), the style bar, hints and the busy overlay.
// Features plug in through registerPanel / registerTopAction / registerCommands.
import { el, icon, toast, modal } from "./kit.js";
import { stagger, play } from "./motion.js";
import { state, on, undo, redo, canUndo, canRedo, undoLabel, redoLabel, emit } from "../core/store.js";
import { toolList, useTool } from "../tools/registry.js";

const panels = new Map();
const topActions = [];
const commandSources = [];
let ui = {};
let openPanelId = null;

/** A side panel. render(box) fills it each time it opens. `belt: true` also puts it on the tool belt. */
export function registerPanel(p) { panels.set(p.id, { order: 50, ...p }); ui.refreshBelt?.(); }
export function registerTopAction(a) { topActions.push({ order: 50, ...a }); topActions.sort((x, y) => x.order - y.order); ui.refreshTop?.(); }
/** fn(app) -> [{ id, label, group, icon, keywords, run }] for the Ctrl+K palette. */
export function registerCommands(fn) { commandSources.push(fn); }

export const currentPanel = () => openPanelId;
export const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

export function openPanel(id, opts = {}) {
  const p = panels.get(id);
  if (!p) return;
  openPanelId = id;
  const box = ui.panelBody;
  box.replaceChildren();
  ui.panelTitle.replaceChildren(icon(p.icon, 18), el("span", {}, p.title || p.label));
  document.body.classList.add("panel-open");
  ui.panel.dataset.panel = id;
  try { p.render(box, opts); } catch (e) { console.error(`[panel ${id}]`, e); box.append(el("p.bad", {}, "This panel failed to open.")); }
  stagger(box, { max: 12 });
  markBelt();
}
export function closePanel() {
  openPanelId = null;
  document.body.classList.remove("panel-open");
  markBelt();
}
export function togglePanel(id) { openPanelId === id ? closePanel() : openPanel(id); }

function markBelt() {
  for (const b of ui.belt?.querySelectorAll("[data-tool], [data-panel]") || []) {
    b.classList.toggle("on", b.dataset.tool ? b.dataset.tool === state.tool : b.dataset.panel === openPanelId);
  }
}

// ---- busy overlay (a paper plane flies while work runs) ---------------------------------------

/** Show progress for a long job. Returns { set(frac, label), done(msg), fail(err), signal }. */
export function busy(title) {
  const ctl = new AbortController();
  const bar = el("div.busy-bar", {}, el("i.busy-fill"));
  const label = el("p.busy-label", {}, "Starting…");
  const plane = el("div.busy-plane", { "aria-hidden": "true" }, planeSvg());
  const box = el("div.busy-back", {}, el("div.busy", { role: "status", "aria-live": "polite" },
    plane, el("h3", {}, title), bar, label,
    el("button.btn.ghost.small", { type: "button", on: { click: () => ctl.abort() } }, "Cancel")));
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add("show"));
  const close = () => { box.classList.remove("show"); setTimeout(() => box.remove(), 250); };
  return {
    signal: ctl.signal,
    set(f, text) {
      const k = Math.max(0, Math.min(1, f));
      bar.firstChild.style.width = `${k * 100}%`;
      plane.style.setProperty("--k", String(k));
      if (text) label.textContent = text;
    },
    done(msg) { close(); if (msg) celebrate(msg); },
    fail(err) { close(); if (err?.name !== "AbortError") toast(err?.message || String(err), { error: true, ms: 6000 }); },
  };
}

function planeSvg() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 48 48");
  s.innerHTML = '<path d="M4 22 44 6 34 42 24 30 4 22Z" fill="var(--paper-hi)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/><path d="M44 6 24 30v10l-4-10" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>';
  return s;
}

/** A happy finish: a stamp-style toast with a burst of paper confetti. */
export function celebrate(msg) {
  const t = toast(el("span.stamp-toast", {}, icon("BadgeCheck", 18), msg), { ms: 3600 });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return t;
  const burst = el("div.confetti", { "aria-hidden": "true" });
  const colors = ["var(--accent)", "var(--gold)", "var(--cyan)", "var(--mint)"];
  for (let i = 0; i < 26; i++) {
    burst.append(el("i", { style: { "--a": `${(i / 26) * 360}deg`, "--d": `${60 + Math.random() * 90}px`, "--r": `${Math.random() * 720 - 360}deg`, background: colors[i % 4] } }));
  }
  document.body.append(burst);
  setTimeout(() => burst.remove(), 1400);
  return t;
}

// ---- the frame -------------------------------------------------------------------------------

export function buildShell(root, app) {
  const top = el("header.topbar");
  const belt = el("nav.belt", { "aria-label": "Tools" });
  const stylebar = el("div.stylebar", { role: "toolbar", "aria-label": "Style" });
  const work = el("main.work");
  const hint = el("div.hint", { role: "status" });
  const panelTitle = el("h2.panel-title");
  const panelBody = el("div.panel-body");
  const grip = el("button.panel-grip", { type: "button", "aria-label": "Close panel", on: { click: closePanel } });
  const panel = el("aside.panel", {}, grip, el("div.panel-head", {}, panelTitle,
    el("button.icon-btn", { type: "button", title: "Close", "aria-label": "Close", on: { click: closePanel } }, icon("X", 18))), panelBody);
  const editor = el("div.editor", {}, belt, el("div.stage", {}, stylebar, work, hint), panel);
  const home = el("div.home");
  root.append(top, home, editor);
  ui = { root, top, belt, stylebar, work, hint, panel, panelBody, panelTitle, editor, home };

  // swipe the sheet down to close it (phones)
  let sy = null;
  grip.addEventListener("pointerdown", (e) => { sy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => { if (sy != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - sy)}px)`; });
  grip.addEventListener("pointerup", (e) => { const d = e.clientY - (sy ?? e.clientY); sy = null; panel.style.transform = ""; if (d > 60) closePanel(); });

  ui.refreshTop = () => renderTop(app);
  ui.refreshBelt = () => renderBelt();
  renderTop(app);
  renderBelt();

  on((e) => {
    if (e.type === "change" || e.type === "doc") updateUndo();
    if (e.type === "tool") { markBelt(); showHint(); }
    if (e.type === "hint") showHint(e.text);
    if (e.type === "doc") { ui.name && (ui.name.value = state.name || ""); }
  });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, select, [contenteditable=true]");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); palette(app); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); app.save?.(); return; }
    if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); app.pickFiles?.(); return; }
    if (typing || mod || e.altKey) return;
    const t = toolList().find((x) => x.key === e.key.toLowerCase() && !x.hidden);
    if (t && state.pages.length && app.view === "editor") useTool(t.id);
  });
  return ui;
}

export const shellUi = () => ui;

function updateUndo() {
  if (!ui.undo) return;
  ui.undo.disabled = !canUndo(); ui.redo.disabled = !canRedo();
  ui.undo.title = canUndo() ? `Undo ${undoLabel()} (Ctrl+Z)` : "Nothing to undo";
  ui.redo.title = canRedo() ? `Redo ${redoLabel()} (Ctrl+Y)` : "Nothing to redo";
}

let hintTimer = 0;
function showHint(text) {
  const t = text || toolList().find((x) => x.id === state.tool)?.hint;
  clearTimeout(hintTimer);
  if (!t || state.tool === "select" && !text) { ui.hint.classList.remove("show"); return; }
  ui.hint.textContent = t;
  ui.hint.classList.add("show");
  hintTimer = setTimeout(() => ui.hint.classList.remove("show"), 3800);
}

function renderTop(app) {
  const t = ui.top;
  t.replaceChildren();
  const logo = el("button.logo", { type: "button", title: "Home", on: { click: () => app.goHome() } },
    el("img", { src: `${import.meta.env.BASE_URL}favicon.svg`, alt: "", width: 30, height: 30 }),
    el("span.logo-words", {}, el("b", {}, "OddlyClever"), " PDF"));
  ui.name = el("input.doc-name", { type: "text", value: state.name || "", "aria-label": "File name", spellcheck: false,
    on: { change: () => { state.name = ui.name.value.trim() || "document.pdf"; emit("rename"); } } });
  ui.undo = el("button.icon-btn", { type: "button", "aria-label": "Undo", on: { click: undo } }, icon("Undo2", 19));
  ui.redo = el("button.icon-btn", { type: "button", "aria-label": "Redo", on: { click: redo } }, icon("Redo2", 19));
  const actions = el("div.top-actions");
  for (const a of topActions) { try { const n = a.render(app); if (n) actions.append(n); } catch (e) { console.error("[top]", e); } }
  t.append(logo, el("div.top-doc", {}, ui.name), el("div.top-edit", {}, ui.undo, ui.redo), actions);
  updateUndo();
}

function renderBelt() {
  const b = ui.belt;
  if (!b) return;
  b.replaceChildren();
  const tools = toolList().filter((x) => !x.hidden).sort((a, c) => a.order - c.order);
  const groups = new Map();
  for (const t of tools) { const g = t.group || "edit"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
  const btn = (t) => el("button.belt-btn", { type: "button", dataset: { tool: t.id }, title: `${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ""}`,
    on: { click: (e) => { useTool(t.id); play(e.currentTarget, "oc-done"); } } }, icon(t.icon, 21), el("span", {}, t.label));
  for (const t of groups.get("edit") || []) b.append(btn(t));
  const shapes = groups.get("shapes") || [];
  if (shapes.length) {
    // one button for all shapes; it remembers the last one picked
    let cur = shapes.find((s) => s.id === localStorage.getItem("ocpdf.shape")) || shapes[0];
    const sb = btn(cur);
    sb.classList.add("has-more");
    sb.addEventListener("click", () => {
      if (state.tool !== cur.id) return;
      const menu = el("div.shape-menu.oc-enter", {}, shapes.map((s) => el("button.belt-btn", { type: "button", title: s.label, on: { click: () => {
        cur = s; try { localStorage.setItem("ocpdf.shape", s.id); } catch { /* */ }
        useTool(s.id); renderBelt(); menu.remove();
      } } }, icon(s.icon, 20), el("span", {}, s.label))));
      document.querySelector(".shape-menu")?.remove();
      sb.after(menu);
      setTimeout(() => document.addEventListener("pointerdown", function off(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", off); } }), 0);
    });
    b.append(sb);
  }
  for (const [g, list] of groups) if (g !== "edit" && g !== "shapes") list.forEach((t) => b.append(btn(t)));
  const ps = [...panels.values()].filter((p) => p.belt).sort((a, c) => a.order - c.order);
  if (ps.length) b.append(el("div.belt-sep"));
  for (const p of ps) {
    b.append(el("button.belt-btn.panel-btn", { type: "button", dataset: { panel: p.id }, title: p.title || p.label, class: p.accent ? "accent" : null,
      on: { click: () => togglePanel(p.id) } }, icon(p.icon, 21), el("span", {}, p.label)));
  }
  markBelt();
}

// ---- command palette (Ctrl+K) -----------------------------------------------------------------

export function palette(app) {
  const input = el("input.input.pal-input", { type: "search", placeholder: "What do you want to do?", "aria-label": "Search commands" });
  const list = el("div.pal-list", { role: "listbox" });
  let items = [], idx = 0;
  const all = () => commandSources.flatMap((fn) => { try { return fn(app) || []; } catch { return []; } });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    items = all().filter((c) => words.every((w) => `${c.label} ${c.keywords || ""} ${c.group || ""}`.toLowerCase().includes(w))).slice(0, 40);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((c, i) => el("button.pal-item", { type: "button", class: i === idx ? "on" : null, on: { click: () => runIt(c) } },
      icon(c.icon || "ChevronRight", 17), el("span", {}, c.label), el("small", {}, c.group || ""))));
    if (!items.length) list.append(el("p.muted.pal-empty", {}, "Nothing matches. Try “merge”, “sign”, “word”…"));
  };
  let m;
  const runIt = (c) => { m.close(); setTimeout(() => c.run(), 30); };
  input.addEventListener("input", () => { idx = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter" && items[idx]) runIt(items[idx]);
  });
  m = modal("Find a tool", el("div.palette", {}, input, list));
  draw();
  setTimeout(() => input.focus(), 30);
}
