// Settings this feature keeps with the document (state.extras.pages): they are in undo and autosave.
import { state, change, begin, end, live } from "../../core/store.js";

export const DEFAULTS = {
  watermark: { on: false, kind: "text", text: "CONFIDENTIAL", imageId: "", color: "#888888", opacity: 0.3, angle: 45, position: "middle", size: 60, scope: "all", range: "" },
  numbers: { on: false, format: "Page {n} of {total}", position: "bottom-center", size: 11, start: 1, skipFirst: false, color: "#444444" },
  headfoot: { on: false, hl: "", hc: "", hr: "", fl: "", fc: "", fr: "", size: 10, skipFirst: false, color: "#444444" },
  security: { on: false, user: "", owner: "", print: true, copy: true, edit: true },
  flatten: { on: false },
  crop: {}, // pageId -> { l, t, r, b } in points, in page space
};

const root = () => state.extras.pages || {};
/** Current settings of one group (defaults filled in). Do not mutate the result. */
export function get(key) {
  const v = root()[key];
  return Array.isArray(DEFAULTS[key]) || key === "crop" ? (v || {}) : { ...DEFAULTS[key], ...(v || {}) };
}

/** Change settings as one undo step. */
export function set(key, patch, label) {
  change(label || "Change settings", () => {
    state.extras.pages = state.extras.pages || {};
    state.extras.pages[key] = { ...get(key), ...patch };
  });
}

// A typing/dragging gesture is ONE undo step: the first edit starts it, commit() ends it.
let gesture = false;
export function edit(key, patch) {
  if (!gesture) { begin(); gesture = true; }
  state.extras.pages = state.extras.pages || {};
  state.extras.pages[key] = { ...get(key), ...patch };
  live("all");
}
export function commit(label) {
  if (!gesture) return;
  gesture = false;
  end(label || "Change settings");
}

export const cropOf = (pageId) => get("crop")[pageId] || null;
