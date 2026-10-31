// Opening files: PDFs go straight in (asking for a password when needed); anything else goes
// through an importer that turns it into PDF bytes first. Features register more importers.
import { PDFDocument } from "@cantoo/pdf-lib";
import { state, uid, makePage, reset, emit, change, clearHistory } from "./store.js";
import { openPdf, pageInfo, NeedPassword } from "./pdf.js";
import { el, modal, toast } from "../ui/kit.js";

const importers = [];
/**
 * Teach the app to open another kind of file.
 * @param {{ id: string, label: string, exts: string[], mimes?: string[], toPdf: (file: File, ctx: {progress}) => Promise<Uint8Array> }} imp
 */
export function registerImporter(imp) {
  const i = importers.findIndex((x) => x.id === imp.id);
  if (i >= 0) importers.splice(i, 1);
  importers.unshift(imp); // later registrations win over the built-in fallbacks
}
export const listImporters = () => [...importers];

/** The `accept` string for file pickers. */
export function acceptList() {
  const exts = new Set([".pdf"]);
  for (const imp of importers) for (const e of imp.exts) exts.add(e.startsWith(".") ? e : `.${e}`);
  return [...exts].join(",");
}

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
const isPdf = (file, bytes) => file.type === "application/pdf" || extOf(file.name) === "pdf" ||
  (bytes && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

export function findImporter(file) {
  const ext = extOf(file.name);
  return importers.find((imp) => imp.exts.map((e) => e.replace(/^\./, "")).includes(ext) || imp.mimes?.some((m) => m.endsWith("/*") ? file.type.startsWith(m.slice(0, -1)) : m === file.type));
}

/** Ask for a PDF's password. Resolves the text, or null if the user gives up. */
function askPassword(name, wrong) {
  return new Promise((resolve) => {
    let done = false;
    const input = el("input.input", { type: "password", autocomplete: "off", placeholder: "Password" });
    const m = modal("This PDF is locked", (close) => {
      const go = () => { done = true; resolve(input.value); close(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      return el("div.stack", {},
        el("p", {}, wrong ? el("b.bad", {}, "That password didn't work. Try again.") : `“${name}” needs a password to open.`),
        input,
        el("p.muted.small", {}, "The password stays on this device."),
        el("div.row.end", {}, el("button.btn", { type: "button", on: { click: () => { done = true; resolve(null); close(); } } }, "Cancel"),
          el("button.btn.primary", { type: "button", on: { click: go } }, "Unlock")));
    }, { onClose: () => { if (!done) resolve(null); } });
    setTimeout(() => input.focus(), 50);
    return m;
  });
}

/** Add PDF bytes as a source file (asks for the password if needed). Returns the file record or null. */
export async function addPdfBytes(bytes, name) {
  let password, pdf, wrong = false;
  for (;;) {
    try { pdf = await openPdf(bytes, { password }); break; } catch (e) {
      if (!(e instanceof NeedPassword)) throw e;
      password = await askPassword(name, wrong || e.wrong);
      if (password == null) return null;
      wrong = true;
    }
  }
  const rec = { id: uid("f"), name, bytes, password: password || "", pdf };
  state.files.set(rec.id, rec);
  return rec;
}

/** Pages for every page of a source file. */
export async function pagesOf(rec) {
  const out = [];
  for (let i = 0; i < rec.pdf.numPages; i++) out.push(makePage(rec.id, i, await pageInfo(rec.pdf, i)));
  return out;
}

/** One picture -> a one-page PDF the size of the picture (longest side up to an A4 height). */
export async function imageToPdf(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  const jpg = file.type === "image/jpeg";
  const blob = await new Promise((r) => c.toBlob(r, jpg ? "image/jpeg" : "image/png", 0.92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await PDFDocument.create();
  const img = jpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  // 96 dpi (0.75 pt per pixel), with the longest side at most an A4 height.
  const k = Math.min(0.75, 842 / Math.max(bmp.width, bmp.height));
  const w = bmp.width * k, h = bmp.height * k;
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc.save();
}

registerImporter({ id: "image-basic", label: "Pictures", exts: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"], mimes: ["image/*"], toPdf: imageToPdf });

/** Turn any supported file into PDF bytes. */
export async function fileToPdfBytes(file, progress = () => {}) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (isPdf(file, head)) return new Uint8Array(await file.arrayBuffer());
  const imp = findImporter(file);
  if (!imp) throw new Error(`I can't open “${file.name}” yet.`);
  return new Uint8Array(await imp.toPdf(file, { progress }));
}

/**
 * Open files. mode "replace" starts a new document; "append" adds the pages at the end;
 * a number inserts them before that page index.
 * @returns {Promise<number>} pages added
 */
export async function openFiles(files, { mode = "replace", progress } = {}) {
  files = [...files].filter(Boolean);
  if (!files.length) return 0;
  const recs = [];
  for (const [i, f] of files.entries()) {
    progress?.(i / files.length, `Opening ${f.name}`);
    try {
      const bytes = await fileToPdfBytes(f, (x, label) => progress?.((i + x) / files.length, label || `Opening ${f.name}`));
      if (mode === "replace" && !recs.length) reset(f.name);
      const rec = await addPdfBytes(bytes, f.name);
      if (rec) recs.push(rec);
    } catch (e) {
      console.error("[open]", e);
      toast(e.message || `Couldn't open ${f.name}.`, { error: true, ms: 5000 });
    }
  }
  if (!recs.length) return 0;
  const newPages = [];
  for (const r of recs) newPages.push(...(await pagesOf(r)));
  if (mode === "replace") {
    state.pages = newPages;
    state.name = recs.length > 1 ? "Merged.pdf" : recs[0].name.replace(/\.[a-z0-9]+$/i, ".pdf");
    clearHistory();
    state.dirty = false;
    emit("doc");
  } else {
    const at = typeof mode === "number" ? mode : state.pages.length;
    change(`Add ${newPages.length} page${newPages.length === 1 ? "" : "s"}`, () => state.pages.splice(at, 0, ...newPages));
    emit("doc", { keepView: true });
  }
  progress?.(1, "Ready");
  return newPages.length;
}

/** Bring a saved session back (autosave). */
export async function restoreSession(data) {
  reset(data.name);
  for (const f of data.files) {
    const pdf = await openPdf(f.bytes, { password: f.password || undefined });
    state.files.set(f.id, { ...f, pdf });
  }
  state.pages = data.pages;
  state.form = data.form || {};
  state.meta = data.meta || {};
  state.extras = data.extras || {};
  state.images = new Map(data.images || []);
  state.name = data.name;
  emit("doc");
}
