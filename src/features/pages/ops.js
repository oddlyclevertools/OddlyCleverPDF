// What you can do to pages. Each one is a single undo step (store.change). The panel, Ctrl+K and
// the home-screen tasks all call these.
import { PDFDocument } from "@cantoo/pdf-lib";
import { state, change, uid, shownSize, on } from "../../core/store.js";
import { describePages, reorder } from "./logic.js";

/** Which pages are picked in the Pages panel (ids). */
export const picked = new Set();
const subs = new Set();
export const onPicked = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function setPicked(ids) {
  picked.clear();
  for (const id of ids) if (state.pages.some((p) => p.id === id)) picked.add(id);
  for (const fn of [...subs]) fn();
}
on((e) => {
  if (e.type === "doc") picked.clear();
  if (e.type === "change" || e.type === "doc") {
    for (const id of [...picked]) if (!state.pages.some((p) => p.id === id)) picked.delete(id);
    for (const fn of [...subs]) fn();
  }
});

/** The ids to act on: the picked pages, else the page on screen. */
export function targets() {
  const ids = state.pages.filter((p) => picked.has(p.id)).map((p) => p.id);
  if (ids.length) return ids;
  const cur = state.pages[window.ocpdf?.currentPageIndex?.() ?? 0] || state.pages[0];
  return cur ? [cur.id] : [];
}
export const indexesOf = (ids) => { const s = new Set(ids); return state.pages.map((p, i) => (s.has(p.id) ? i : -1)).filter((i) => i >= 0); };

export function rotate(ids, delta) {
  const set = new Set(ids);
  change(delta > 0 ? "Turn pages right" : "Turn pages left", () => {
    for (const p of state.pages) if (set.has(p.id)) p.rotate = (((p.rotate + delta) % 360) + 360) % 360;
  });
}

/** Delete pages, always keeping at least one. Returns false if refused. */
export function remove(ids) {
  const set = new Set(ids);
  if (state.pages.every((p) => set.has(p.id))) return false;
  change(set.size > 1 ? "Delete pages" : "Delete page", () => { state.pages = state.pages.filter((p) => !set.has(p.id)); });
  return true;
}

export function duplicate(ids) {
  const set = new Set(ids);
  const made = [];
  change("Duplicate pages", () => {
    const out = [];
    for (const p of state.pages) {
      out.push(p);
      if (!set.has(p.id)) continue;
      const copy = JSON.parse(JSON.stringify(p));
      copy.id = uid("p");
      for (const o of copy.objects) o.id = uid();
      const crop = state.extras.pages?.crop?.[p.id];
      if (crop) state.extras.pages.crop[copy.id] = { ...crop };
      out.push(copy);
      made.push(copy.id);
    }
    state.pages = out;
  });
  return made;
}

/** Move pages to the start, the end, or before page index `to` (counted without the moved pages). */
export function move(ids, to) {
  change("Move pages", () => { state.pages = reorder(state.pages, ids, to === "start" ? 0 : to === "end" ? Infinity : to); });
}

/** Add pages (model Page[]) before index `at` (end when omitted). */
export function insertPages(pages, at = state.pages.length, label = "Add pages") {
  change(label, () => { state.pages.splice(Math.max(0, Math.min(state.pages.length, at)), 0, ...pages); });
}

export async function blankPage(app, like) {
  const ref = like || state.pages.at(-1);
  const { w, h } = ref ? shownSize(ref) : { w: 595.28, h: 841.89 };
  const d = await PDFDocument.create();
  d.addPage([w, h]);
  const rec = await app.addPdfBytes(await d.save(), "Blank page.pdf");
  return (await app.pagesOf(rec))[0];
}

/** Insert a blank page after page index `after` (-1 = at the very start). */
export async function insertBlank(app, after = state.pages.length - 1) {
  const pg = await blankPage(app, state.pages[Math.max(0, after)]);
  insertPages([pg], after + 1, "Add blank page");
  return pg.id;
}

/** Ask for files and put their pages in at index `at`. Returns the new page ids. */
export async function insertFromFiles(app, at = state.pages.length) {
  const files = await app.chooseFiles({ multiple: true });
  if (!files.length) return [];
  const b = app.busy("Adding pages");
  try {
    const pages = [];
    for (const [i, f] of files.entries()) {
      b.set(i / files.length, `Reading ${f.name}`);
      const rec = await app.addPdfBytes(await app.fileToPdfBytes(f), f.name);
      if (rec) pages.push(...(await app.pagesOf(rec)));
    }
    if (pages.length) insertPages(pages, at, "Add pages from a file");
    b.done(pages.length ? `Added ${pages.length} page${pages.length === 1 ? "" : "s"}` : "");
    return pages.map((p) => p.id);
  } catch (e) { b.fail(e); return []; }
}

/** Save the given pages as a new PDF (with all their edits). */
export async function extract(app, ids) {
  const b = app.busy("Making your new PDF");
  try {
    const { bytes } = await app.buildPdf({ pageIds: ids, onProgress: (f, l) => b.set(f, l) });
    await app.deliver(bytes, app.outName("pdf", `(pages ${describePages(indexesOf(ids))})`));
    b.done(`Saved ${ids.length} page${ids.length === 1 ? "" : "s"} as a new PDF`);
  } catch (e) { b.fail(e); }
}

