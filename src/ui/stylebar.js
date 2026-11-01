// The style bar above the pages: the settings for what you've selected, or for the tool you're
// holding (its next mark). Colours, size, font, weight, line width, and quick actions.
import { el, icon, colorRow, modal, popover, closePopover } from "./kit.js";
import { state, on, findObject, updateObject, removeObjects, emit } from "../core/store.js";
import { FAMILIES } from "../core/fonts.js";
import { toolPrefs, setToolPrefs, toolById } from "../tools/registry.js";
import { duplicate, arrange, alignSelection, startTyping } from "../tools/select.js";
import { TEXT_DEFAULTS, DRAW_DEFAULTS, MARK_DEFAULTS, SHAPE_DEFAULTS } from "../tools/builtin.js";

const extra = []; // features add controls: fn({ obj, tool }) -> node | null
export function registerStyleControls(fn) { extra.push(fn); }

let bar;
export function mountStylebar(node) {
  bar = node;
  on((e) => { if (["select", "tool", "doc", "toolprefs"].includes(e.type) || (e.type === "change" && e.undo)) render(); });
  render();
}

const iconToggle = (name, title, on_, click) => el("button.sb-btn", { type: "button", title, "aria-pressed": String(!!on_), class: on_ ? "on" : null, on: { click } }, icon(name, 17));
const label = (t) => el("span.sb-label", {}, t);

function sizeStepper(value, set, { min = 4, max = 144, step = 1, unit = "" } = {}) {
  const num = el("input.sb-num", { type: "number", min, max, step, value: Math.round(value * 10) / 10, "aria-label": "Size",
    on: { change: () => set(Math.max(min, Math.min(max, Number(num.value) || value))) } });
  return el("div.sb-step", {},
    el("button.sb-btn", { type: "button", title: "Smaller", on: { click: () => set(Math.max(min, Math.round((value - step) * 10) / 10)) } }, icon("Minus", 15)),
    num, unit ? el("small", {}, unit) : null,
    el("button.sb-btn", { type: "button", title: "Bigger", on: { click: () => set(Math.min(max, Math.round((value + step) * 10) / 10)) } }, icon("Plus", 15)));
}

// The bar sits above the pages, so showing it would push the page down under your finger mid-drag:
// scroll by the same amount to keep the page still.
function render() {
  if (!bar) return;
  const h0 = bar.offsetHeight;
  paint();
  const d = bar.offsetHeight - h0, vp = bar.parentElement?.querySelector(".viewport");
  if (d && vp) vp.scrollTop += d;
}

function paint() {
  bar.replaceChildren();
  const sel = state.selection.map((id) => findObject(id)?.obj).filter(Boolean);
  const one = sel.length === 1 ? sel[0] : null;
  const tool = state.tool;
  let kind, val, set;
  if (sel.length) {
    kind = one ? one.type : "many";
    val = one || {};
    set = (patch, lbl = "Style") => { if (one) updateObject(one.id, patch, lbl); };
  } else {
    const map = { text: ["text", TEXT_DEFAULTS], draw: ["ink", DRAW_DEFAULTS], highlight: ["highlight", MARK_DEFAULTS], rect: ["rect", SHAPE_DEFAULTS],
      ellipse: ["ellipse", SHAPE_DEFAULTS], line: ["line", SHAPE_DEFAULTS], arrow: ["arrow", SHAPE_DEFAULTS], whiteout: ["whiteout", { color: "#ffffff" }], note: ["note", { color: "#ffd60a" }] };
    const m = map[tool];
    if (!m) { bar.classList.remove("show"); return addExtra({ tool }); }
    kind = m[0];
    const prefKey = ["rect", "ellipse", "line", "arrow"].includes(tool) ? "shapes" : tool;
    val = toolPrefs(prefKey, m[1]);
    set = (patch) => { setToolPrefs(prefKey, patch); };
  }
  bar.classList.add("show");
  const row = el("div.sb-row");
  if (!sel.length) row.append(el("span.sb-tag", {}, icon(toolById(tool)?.icon || "Settings2", 15), toolById(tool)?.label || ""));

  if (kind === "text") {
    row.append(
      el("select.sb-sel", { "aria-label": "Font", on: { change: (e) => set({ font: e.target.value }, "Font") } },
        Object.entries(FAMILIES).map(([k, f]) => el("option", { value: k, selected: (val.font || "sans") === k }, f.label)),
        String(val.font).startsWith("pdf3:") ? el("option", { value: val.font, selected: true }, "This PDF's own font") : null),
      sizeStepper(val.size || 14, (v) => set({ size: v }, "Text size"), { unit: "pt" }),
      iconToggle("Bold", "Bold", val.bold, () => set({ bold: !val.bold }, "Bold")),
      iconToggle("Italic", "Italic", val.italic, () => set({ italic: !val.italic }, "Italic")),
      iconToggle("Underline", "Underline", val.underline, () => set({ underline: !val.underline }, "Underline")),
      iconToggle(val.align === "center" ? "AlignCenter" : val.align === "right" ? "AlignRight" : "AlignLeft", "Alignment", false,
        () => set({ align: val.align === "left" || !val.align ? "center" : val.align === "center" ? "right" : "left" }, "Align")),
      colorRow(val.color || "#111111", (c) => set({ color: c }, "Text colour")),
    );
    if (one) row.append(el("button.sb-btn.wide", { type: "button", on: { click: () => startTyping(one.id) } }, icon("Pencil", 15), "Type"));
    if (one?.cover) row.append(el("label.sb-chip", { title: "The patch that hides the old words" }, "Patch", el("input", { type: "color", value: one.cover.color || "#ffffff",
      on: { input: (e) => set({ cover: { ...one.cover, color: e.target.value } }, "Patch colour") } })));
    if (one?.cover) row.append(el("span.sb-note.sb-warn", { title: "Edit text paints over the old words and types the new ones. The old words are still inside the file, so someone could copy them out. For private details, use Black out: it removes them for good." },
      icon("Info", 15), "Old words are covered, not erased. Private? Use Black out."));
  } else if (kind === "ink") {
    row.append(label("Pen"), sizeStepper(val.width || 2.5, (v) => set({ width: v }, "Pen size"), { min: 0.5, max: 30, step: 0.5 }),
      colorRow(val.color, (c) => set({ color: c }, "Pen colour")), opacity(val, set));
  } else if (kind === "highlight") {
    row.append(
      el("div.sb-seg", {}, [["highlight", "Highlighter", "Highlight"], ["underline", "Underline", "Underline"], ["strike", "Strikethrough", "Strike"]].map(([k, ic, t]) =>
        el("button.sb-btn", { type: "button", title: t, class: (val.style || "highlight") === k ? "on" : null, on: { click: () => set({ style: k, opacity: k === "highlight" ? 0.45 : 1 }, t) } }, icon(ic, 16)))),
      colorRow(val.color, (c) => set({ color: c }, "Colour"), { colors: ["#ffd60a", "#7cf29a", "#7ad7ff", "#ff9ecb", "#ffb15c", "#d81f3c", "#1f4fd8", "#111111"] }));
  } else if (["rect", "ellipse", "line", "arrow"].includes(kind)) {
    row.append(label("Line"), sizeStepper(val.width ?? 2, (v) => set({ width: v }, "Line width"), { min: 0.5, max: 24, step: 0.5 }),
      colorRow(val.stroke, (c) => set({ stroke: c }, "Line colour")));
    if (kind === "rect" || kind === "ellipse") {
      row.append(label("Fill"), colorRow(val.fill === "none" ? "" : val.fill, (c) => set({ fill: c }, "Fill"), { colors: ["#ffffff", "#ffd60a", "#7ad7ff", "#ff9ecb", "#111111"] }),
        iconToggle("Ban", "No fill", val.fill === "none" || !val.fill, () => set({ fill: "none" }, "No fill")));
    }
    row.append(opacity(val, set));
  } else if (kind === "whiteout") {
    row.append(label("Cover colour"), colorRow(val.color || "#ffffff", (c) => set({ color: c }, "Cover colour"), { colors: ["#ffffff", "#f6f1e7", "#eeeeee", "#111111"] }));
  } else if (kind === "note") {
    row.append(colorRow(val.color, (c) => set({ color: c }, "Note colour"), { colors: ["#ffd60a", "#7cf29a", "#7ad7ff", "#ff9ecb", "#ffb15c"] }));
    if (one) row.append(el("button.sb-btn.wide", { type: "button", on: { click: () => emit("edit-note", { id: one.id }) } }, icon("Pencil", 15), "Write"));
  } else if (kind === "image") {
    row.append(opacity(val, set));
  } else if (kind === "redact") {
    row.append(el("span.sb-note", {}, icon("ShieldCheck", 15), "Removed for good when you save"));
  }
  bar.append(row);
  addExtra({ obj: one, tool, row });
  if (sel.length) {
    bar.append(el("div.sb-row.sb-actions", {},
      el("button.sb-btn", { type: "button", title: "Duplicate (Ctrl+D)", on: { click: () => duplicate(state.selection) } }, icon("Copy", 16)),
      el("button.sb-btn", { type: "button", title: sel.length > 1 ? "Line up and spread out" : "Line up with the page", "aria-haspopup": "dialog", on: { click: (e) => alignMenu(e.currentTarget, sel.length) } }, icon("AlignStartVertical", 16)),
      el("button.sb-btn", { type: "button", title: "Bring to front (Ctrl+Shift+])", on: { click: () => arrange("front") } }, icon("BringToFront", 16)),
      el("button.sb-btn", { type: "button", title: "Bring forward (Ctrl+])", on: { click: () => arrange("forward") } }, icon("ChevronUp", 16)),
      el("button.sb-btn", { type: "button", title: "Send backward (Ctrl+[)", on: { click: () => arrange("backward") } }, icon("ChevronDown", 16)),
      el("button.sb-btn", { type: "button", title: "Send to back (Ctrl+Shift+[)", on: { click: () => arrange("back") } }, icon("SendToBack", 16)),
      el("button.sb-btn.danger", { type: "button", title: "Delete", on: { click: () => removeObjects(state.selection) } }, icon("Trash2", 16))));
  }
}

/** Align and spread-out buttons in a small pop-up. */
function alignMenu(anchor, count) {
  const b = (how, ic, t) => el("button.sb-btn", { type: "button", title: t, "aria-label": t, on: { click: () => { alignSelection(how); closePopover(); } } }, icon(ic, 17));
  popover(anchor, el("div.sb-align", {},
    el("div.sb-row", {}, b("left", "AlignStartVertical", "Left"), b("center", "AlignCenterVertical", "Centre"), b("right", "AlignEndVertical", "Right")),
    el("div.sb-row", {}, b("top", "AlignStartHorizontal", "Top"), b("middle", "AlignCenterHorizontal", "Middle"), b("bottom", "AlignEndHorizontal", "Bottom")),
    count >= 3 ? el("div.sb-row", {}, b("x", "AlignHorizontalDistributeCenter", "Even gaps across"), b("y", "AlignVerticalDistributeCenter", "Even gaps down")) : null,
    el("small.sb-hint", {}, count > 1 ? "Lines them up with each other." : "Lines it up with the page.")));
}

function addExtra(ctx) {
  for (const fn of extra) {
    try { const n = fn(ctx); if (n) { (ctx.row || bar).append(n); bar.classList.add("show"); } } catch (e) { console.error("[stylebar]", e); }
  }
}

function opacity(val, set) {
  const r = el("input.sb-range", { type: "range", min: 10, max: 100, value: Math.round((val.opacity ?? 1) * 100), "aria-label": "Opacity",
    on: { change: (e) => set({ opacity: Number(e.target.value) / 100 }, "Opacity") } });
  return el("label.sb-chip", { title: "See-through" }, icon("Droplet", 14), r);
}

/** Write or edit a sticky note's words. */
export function editNote(id) {
  const f = findObject(id);
  if (!f) return;
  const ta = el("textarea.input", { rows: 5, placeholder: "Write your note…" }, f.obj.text || "");
  modal("Note", (close) => el("div.stack", {}, ta, el("div.row.end", {},
    el("button.btn.ghost", { type: "button", on: { click: () => { removeObjects([id], "Delete note"); close(); } } }, icon("Trash2", 16), "Delete"),
    el("button.btn.primary", { type: "button", on: { click: () => { updateObject(id, { text: ta.value }, "Note"); close(); } } }, "Save note"))));
  setTimeout(() => ta.focus(), 40);
}
on((e) => { if (e.type === "edit-note") editNote(e.id); });
