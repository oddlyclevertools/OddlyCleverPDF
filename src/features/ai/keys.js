// API keys. By default a key lives only in this module's memory and is gone on reload. If the user
// opts in ("Remember on this device") it is also kept in IndexedDB `oddlyclever-pdf-ai`. Keys never
// go into the PDF, autosave, history, logs, URLs or localStorage. "Forget key" removes both copies.
const DB_NAME = "oddlyclever-pdf-ai";
const STORE = "keys";

const memory = new Map(); // providerId -> key
const remembered = new Set(); // providerIds whose key is in IndexedDB

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("This browser can't store keys.")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Couldn't open the key store."));
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error || new Error("The key store failed."));
      t.onabort = () => reject(t.error || new Error("The key store failed."));
    });
  } finally {
    db.close();
  }
}

/** Load remembered keys into memory (called once at start). Never throws. */
export async function loadRememberedKeys() {
  try {
    const db = await openDb();
    const entries = await new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(out); return; }
        out.push([String(c.key), c.value]);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    for (const [id, key] of entries) {
      if (typeof key !== "string" || !key) continue;
      remembered.add(id);
      if (!memory.has(id)) memory.set(id, key);
    }
  } catch { /* no IndexedDB (private mode): keys stay in memory only */ }
}

export const getKey = (providerId) => memory.get(providerId) || "";
export const hasKey = (providerId) => Boolean(memory.get(providerId));
export const isRemembered = (providerId) => remembered.has(providerId);

/** Set the key for a provider. `remember` also stores it in IndexedDB (or removes it from there). */
export async function setKey(providerId, key, { remember = false } = {}) {
  const clean = String(key || "").trim();
  if (clean) memory.set(providerId, clean);
  else memory.delete(providerId);
  if (remember && clean) {
    await tx("readwrite", (s) => s.put(clean, providerId));
    remembered.add(providerId);
  } else if (remembered.has(providerId)) {
    await tx("readwrite", (s) => s.delete(providerId));
    remembered.delete(providerId);
  }
}

/** Remove the key from memory and from this computer. */
export async function forgetKey(providerId) {
  memory.delete(providerId);
  remembered.delete(providerId);
  try { await tx("readwrite", (s) => s.delete(providerId)); } catch { /* nothing stored */ }
}
