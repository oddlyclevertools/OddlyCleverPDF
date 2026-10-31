// Saved signatures and initials: IndexedDB "oddlyclever-pdf-sign", on this device only.
// If IndexedDB isn't available (private mode), they live in memory until the tab closes.
const DB = "oddlyclever-pdf-sign", STORE = "sigs";
let dbp = null;
const memory = new Map();

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) { reject(new Error("no indexedDB")); return; }
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: "id" });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  return dbp;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(mode) { return (await open()).transaction(STORE, mode).objectStore(STORE); }

/** All saved items of a kind ("signature" or "initials"), newest first. */
export async function listSaved(kind) {
  let all;
  try { all = await req((await store("readonly")).getAll()); } catch { all = [...memory.values()]; }
  return all.filter((s) => s.kind === kind).sort((a, b) => b.created - a.created);
}

/** Save a picture ({url, w, h}). Returns the saved record. */
export async function saveItem(kind, pic) {
  const rec = { id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, kind, url: pic.url, w: pic.w, h: pic.h, created: Date.now() };
  try { await req((await store("readwrite")).put(rec)); } catch { memory.set(rec.id, rec); }
  return rec;
}

export async function deleteItem(id) {
  memory.delete(id);
  try { await req((await store("readwrite")).delete(id)); } catch { /* nothing saved there */ }
}

export async function getItem(id) {
  if (!id) return null;
  if (memory.has(id)) return memory.get(id);
  try { return (await req((await store("readonly")).get(id))) || null; } catch { return null; }
}
