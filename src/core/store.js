// The document model: source files (PDF bytes), the page list, the edits on each page, images,
// form values, undo/redo and change events. Every feature reads and changes the document here.
//
// Coordinates: each page has its own space in PDF points, origin top-left, y down, NOT rotated
// (page.rotate is applied on screen and on export). page.box is the PDF view box [x0, y0, x1, y1],
// so a point (x, y) is PDF user space (box[0] + x, box[3] - y).

const uid = (p = "o") => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export { uid };

const listeners = new Set();
const MAX_HISTORY = 120;

export const state = {
  /** @type {Map<string, {id, name, bytes: Uint8Array, password?: string, pdf?: any}>} */
  files: new Map(),
  /** @type {Array<Page>} */
  pages: [],
  /** imageId -> dataURL (png/jpeg). Kept out of the page JSON so undo snapshots stay small. */
  images: new Map(),
  /** form field name -> value (string | boolean | string[]) */
  form: {},
  name: "",
  meta: {},
  dirty: false,
  selection: [], // object ids
  tool: "select",
  zoom: 1,
  /** Free-form options other features keep with the document (watermark settings and so on). */
  extras: {},
};

const undoStack = [];
const redoStack = [];

const snap = () => JSON.stringify({ pages: state.pages, form: state.form, meta: state.meta, extras: state.extras });
function restore(s) {
  const v = JSON.parse(s);
  state.pages = v.pages;
  state.form = v.form;
  state.meta = v.meta;
  state.extras = v.extras || {};
  state.selection = state.selection.filter((id) => findObject(id));
}

/** Listen for changes. fn({ type, ... }). Returns an unsubscribe function. */
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(type, detail = {}) {
  for (const fn of [...listeners]) {
    try { fn({ type, ...detail }); } catch (e) { console.error("[store] listener failed", e); }
  }
}

/**
 * Change the document as ONE undo step. fn mutates `state` directly.
 * @param {string} label shown in the undo tooltip ("Add text")
 * @param {() => void} fn
 * @param {{ pages?: string[] | "all", silent?: boolean }} [o] which pages changed (for redraw)
 */
export function change(label, fn, o = {}) {
  const before = snap();
  fn();
  const after = snap();
  if (before === after) return false;
  undoStack.push({ label, before, after });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  state.dirty = true;
  emit("change", { label, pages: o.pages || "all" });
  return true;
}

/** For drags: call begin() at pointer-down, then mutate freely, then end(label) at pointer-up. */
let pending = null;
export function begin() { pending = snap(); }
export function end(label, o = {}) {
  if (pending == null) return;
  const before = pending; pending = null;
  const after = snap();
  if (before === after) return;
  undoStack.push({ label, before, after });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  state.dirty = true;
  emit("change", { label, pages: o.pages || "all" });
}
/** Live update during a drag (redraw only, no undo step). */
export function live(pageIds) { emit("live", { pages: pageIds || "all" }); }

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => undoStack.at(-1)?.label || "";
export const redoLabel = () => redoStack.at(-1)?.label || "";
export function undo() {
  const s = undoStack.pop(); if (!s) return;
  redoStack.push(s); restore(s.before); state.dirty = true;
  emit("change", { label: `Undo ${s.label}`, pages: "all", undo: true });
}
export function redo() {
  const s = redoStack.pop(); if (!s) return;
  undoStack.push(s); restore(s.after); state.dirty = true;
  emit("change", { label: `Redo ${s.label}`, pages: "all", undo: true });
}
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; }

// ---- lookups -------------------------------------------------------------------------------

export const pageById = (id) => state.pages.find((p) => p.id === id);
export const pageIndex = (id) => state.pages.findIndex((p) => p.id === id);
export function findObject(id) {
  for (const p of state.pages) {
    const o = p.objects.find((x) => x.id === id);
    if (o) return { page: p, obj: o };
  }
  return null;
}

/** Width/height as shown (after rotation). */
export function shownSize(page) {
  const r = ((page.rotate % 360) + 360) % 360;
  return r === 90 || r === 270 ? { w: page.h, h: page.w } : { w: page.w, h: page.h };
}

// ---- edits on pages -------------------------------------------------------------------------

/** Add an object to a page (one undo step). Returns the object. */
export function addObject(pageId, obj, label = "Add") {
  const o = { id: uid(), ...obj };
  change(label, () => pageById(pageId)?.objects.push(o), { pages: [pageId] });
  return o;
}
export function updateObject(id, patch, label = "Change") {
  const f = findObject(id); if (!f) return;
  change(label, () => Object.assign(f.obj, patch), { pages: [f.page.id] });
}
export function removeObjects(ids, label = "Delete") {
  const set = new Set(ids);
  change(label, () => { for (const p of state.pages) p.objects = p.objects.filter((o) => !set.has(o.id)); });
  state.selection = state.selection.filter((id) => !set.has(id));
  emit("select");
}

/** Keep a picture (data URL) and return its id. */
export function putImage(dataUrl) {
  for (const [id, v] of state.images) if (v === dataUrl) return id;
  const id = uid("img");
  state.images.set(id, dataUrl);
  return id;
}

export function select(ids) {
  state.selection = [...new Set(ids)];
  emit("select");
}

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  emit("tool", { tool });
}

// ---- files and pages ------------------------------------------------------------------------

/** Make a page record from a source file's page (sizes from pdf.js). */
export function makePage(fileId, index, { box, rotate = 0 }) {
  return { id: uid("p"), src: { fileId, index }, box, w: box[2] - box[0], h: box[3] - box[1], rotate, objects: [] };
}

/** Start a fresh document (clears everything). */
export function reset(name = "") {
  for (const f of state.files.values()) f.pdf?.destroy?.();
  state.files.clear();
  state.images.clear();
  state.pages = [];
  state.form = {};
  state.meta = {};
  state.extras = {};
  state.selection = [];
  state.name = name;
  state.dirty = false;
  clearHistory();
  emit("doc");
}

/** Everything needed to save the session (autosave) and bring it back. */
export function serialize() {
  return {
    v: 1, name: state.name, pages: state.pages, form: state.form, meta: state.meta, extras: state.extras,
    images: [...state.images], files: [...state.files.values()].map((f) => ({ id: f.id, name: f.name, bytes: f.bytes, password: f.password || "" })),
  };
}
