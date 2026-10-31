// Tools: what a press on a page does. One tool is active at a time (store.state.tool). The page's
// tool layer catches presses for every tool except Select (which works on the objects and lets
// you select text natively). A tool is { id, label, icon, mode, down, move, up, tap, cursor, prefs }.
//   mode "drag": owns one-finger touches (drawing); "tap": scrolling still works, a tap acts.
import { state, on, setTool, emit } from "../core/store.js";
import { toPage, pageAt } from "../viewer/viewer.js";

const tools = new Map();
export const toolList = () => [...tools.values()];
export const toolById = (id) => tools.get(id);

/** @param {{ id, label, icon, group?, order?, mode?: "drag"|"tap"|"none", key?: string, hint?: string, down?, move?, up?, tap?, cancel?, enter?, leave? }} t */
export function registerTool(t) {
  tools.set(t.id, { order: 50, mode: "drag", group: "edit", ...t });
}

// Per-tool settings people pick (colour, size…), remembered on this device.
const PREFS_KEY = "ocpdf.toolprefs";
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch { prefs = {}; }
export function toolPrefs(id, defaults = {}) { return { ...defaults, ...(prefs[id] || {}) }; }
export function setToolPrefs(id, patch) {
  prefs[id] = { ...(prefs[id] || {}), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  emit("toolprefs", { id });
}

export function useTool(id) {
  const prev = tools.get(state.tool);
  if (prev?.id !== id) prev?.leave?.();
  setTool(tools.has(id) ? id : "select");
  tools.get(state.tool)?.enter?.();
  document.body.dataset.tool = state.tool;
  document.body.dataset.toolMode = tools.get(state.tool)?.mode || "none";
}

let active = null; // { tool, pageId, id, start, moved }
const TAP_SLOP = 8;

/** Wire pointer events on the page column. */
export function attach(column) {
  column.addEventListener("pointerdown", (e) => {
    const layer = e.target.closest?.(".layer-tool");
    if (!layer || e.button > 0) return;
    const tool = tools.get(state.tool);
    if (!tool || tool.mode === "none") return;
    const pageId = layer.dataset.page;
    const pt = toPage(pageId, e.clientX, e.clientY);
    active = { tool, pageId, id: e.pointerId, sx: e.clientX, sy: e.clientY, start: pt, moved: false, e };
    if (tool.mode === "drag") {
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      tool.down?.({ pageId, pt, e });
    }
  });
  column.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== active.id) {
      const tool = tools.get(state.tool);
      if (tool?.hover && e.pointerType === "mouse") {
        const pageId = pageAt(e.clientX, e.clientY);
        tool.hover(pageId ? { pageId, pt: toPage(pageId, e.clientX, e.clientY), e } : null);
      }
      return;
    }
    if (Math.hypot(e.clientX - active.sx, e.clientY - active.sy) > TAP_SLOP) active.moved = true;
    if (active.tool.mode === "drag") active.tool.move?.({ pageId: active.pageId, pt: toPage(active.pageId, e.clientX, e.clientY), e });
  });
  const finish = (e, cancelled) => {
    if (!active || e.pointerId !== active.id) return;
    const a = active; active = null;
    const pt = toPage(a.pageId, e.clientX, e.clientY);
    if (cancelled) { a.tool.cancel?.(); return; }
    if (a.tool.mode === "drag") a.tool.up?.({ pageId: a.pageId, pt, e, moved: a.moved, start: a.start });
    else if (!a.moved) a.tool.tap?.({ pageId: a.pageId, pt, e });
  };
  column.addEventListener("pointerup", (e) => finish(e, false));
  column.addEventListener("pointercancel", (e) => finish(e, true));
  on((ev) => { if (ev.type === "pinch-start" && active) { active.tool.cancel?.(); active = null; } });
}

/**
 * Place something with the next tap (signatures, stamps, pictures): shows a ghost under the mouse.
 * make({ pageId, pt }) adds the object. Returns to `back` (default Select) afterwards.
 */
export function placeNext({ label, ghost, make, back = "select" }) {
  registerTool({
    id: "place", label, icon: "MousePointerClick", mode: "tap", hidden: true,
    hover: ghost ? (h) => ghost(h) : undefined,
    tap: ({ pageId, pt }) => { make({ pageId, pt }); ghost?.(null); useTool(back); },
    leave: () => ghost?.(null),
  });
  useTool("place");
  emit("hint", { text: `Tap where you want the ${label.toLowerCase()}.` });
}
