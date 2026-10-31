// Autosave: the open document (source files, pages, edits) is kept in this browser's IndexedDB
// a moment after every change, so a closed tab or a crash loses nothing. Never sent anywhere.
import { state, on, serialize } from "./store.js";

const DB = "oddlyclever-pdf", STORE = "session", KEY = "current";

function db() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("No storage in this browser."));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(mode, fn) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Storage is full."));
    });
  } finally { d.close(); }
}

let timer = 0, enabled = true;
export function startAutosave() {
  on((e) => {
    if (e.type !== "change" && e.type !== "doc" && e.type !== "rename") return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, 1200);
  });
}

export async function saveNow() {
  if (!enabled || !state.pages.length) return;
  try {
    await run("readwrite", (s) => s.put({ at: Date.now(), data: serialize() }, KEY));
  } catch (e) {
    console.warn("[autosave] skipped:", e?.message || e); // full or private mode: editing still works
  }
}

/** { name, pages, at } of the saved session, or null. */
export async function savedInfo() {
  try {
    const v = await run("readonly", (s) => s.get(KEY));
    return v?.data?.pages?.length ? { name: v.data.name, pages: v.data.pages.length, at: v.at } : null;
  } catch { return null; }
}
export async function loadSaved() {
  const v = await run("readonly", (s) => s.get(KEY));
  return v?.data || null;
}
export async function forgetSaved() {
  clearTimeout(timer);
  try { await run("readwrite", (s) => s.delete(KEY)); } catch { /* nothing stored */ }
}
export function pauseAutosave(v) { enabled = !v; }
