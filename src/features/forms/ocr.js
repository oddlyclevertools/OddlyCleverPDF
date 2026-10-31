// "Read scan": text recognition for pictures of pages, with tesseract.js (loaded only when used).
// The worker and the engine come from the npm packages bundled by Vite; only the language file is
// downloaded, and only after the user says yes.
import { el, icon, toast, confirmDialog } from "../../ui/kit.js";
import { PDFDocument } from "@cantoo/pdf-lib";
import { fontFile, fontBytes } from "../../core/fonts.js";
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import { LANGS, wordsFromResult, wordsToText, chooseFont, writeTextLayer } from "./ocr-core.js";

const abs = (u) => new URL(u, location.href).href;
const LANG_KEY = "ocpdf.ocr.langs";
const agreed = () => { try { return JSON.parse(localStorage.getItem(LANG_KEY) || "[]"); } catch { return []; } };
const markAgreed = (l) => { try { localStorage.setItem(LANG_KEY, JSON.stringify([...new Set([...agreed(), l])])); } catch { /* private mode */ } };

const unicodeFont = async (doc) => {
  doc.registerFontkit((await import("@pdf-lib/fontkit")).default);
  return doc.embedFont(await fontBytes(fontFile("sans", false, false)), { subset: false });
};

export function installOcr(app) {
  const { state, store } = app;
  const ocrMap = () => state.extras.forms?.ocr || {};

  // ---- which pages are pictures ----------------------------------------------------------------
  const hasText = async (id) => (await app.pageString(id)).trim().length >= 3;
  async function blankPages(limit = Infinity) {
    const out = [];
    for (const p of state.pages.slice(0, limit)) if (!ocrMap()[p.id] && !(await hasText(p.id))) out.push(p.id);
    return out;
  }
  async function looksScanned(pageId) {
    const p = store.pageById(pageId), f = state.files.get(p.src.fileId);
    const page = await f.pdf.getPage(p.src.index + 1);
    const ops = await page.getOperatorList();
    const O = app.pdf.pdfjs.OPS;
    const imageOps = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter((x) => x != null));
    return ops.fnArray.some((fn) => imageOps.has(fn));
  }

  // ---- the engine ---------------------------------------------------------------------------------
  async function makeWorker(lang, logger) {
    const T = await import("tesseract.js");
    const createWorker = T.createWorker || T.default?.createWorker;
    return createWorker(lang, 1, { workerPath: abs(workerUrl), corePath: abs(coreUrl), logger });
  }

  async function askToDownload(lang) {
    if (agreed().includes(lang)) return true;
    const name = LANGS.find((l) => l[0] === lang)?.[1] || lang;
    const ok = await confirmDialog("One small download", `Download ${name} text reading (about 10 MB, once)? It stays on this device. Your PDF never leaves it.`, "Download");
    if (ok) markAgreed(lang);
    return ok;
  }

  /**
   * Read pages and make them searchable.
   * @param {{ pageIds?: string[], lang?: string, dpi?: number, bake?: boolean }} o
   * @returns {Promise<number>} pages read
   */
  async function readScan({ pageIds, lang = "eng", dpi = 200, bake = true } = {}) {
    const ids = pageIds || (await blankPages());
    if (!ids.length) { toast("Every page already has text, so there's nothing to read."); return 0; }
    if (!(await askToDownload(lang))) return 0;
    const b = app.busy("Reading your scan");
    let worker = null;
    try {
      b.set(0.02, "Getting the reader ready");
      let i = 0;
      worker = await makeWorker(lang, (m) => {
        if (m.status === "recognizing text") b.set((i + m.progress) / ids.length, `Page ${i + 1} of ${ids.length}`);
        else if (/loading language/.test(m.status || "")) b.set(0.03, "Downloading the language (only once)");
      });
      const results = new Map();
      const scale = dpi / 72;
      for (; i < ids.length; i++) {
        if (b.signal.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
        b.set(i / ids.length, `Page ${i + 1} of ${ids.length}`);
        const p = store.pageById(ids[i]), f = state.files.get(p.src.fileId);
        const canvas = await app.pdf.pageToCanvas(f.pdf, p.src.index, { scale });
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        results.set(p.id, wordsFromResult(data, scale));
        canvas.width = canvas.height = 1; // free the memory now
      }
      b.set(0.97, "Making it searchable");
      await applyOcr(results, { lang, bake });
      const total = [...results.values()].reduce((s, w) => s + w.length, 0);
      b.done(total ? `Done. Found ${total} words.` : "Done, but no words were found.");
      return ids.length;
    } catch (e) { console.error("[ocr]", e); b.fail(e); return 0; }
    finally { try { await worker?.terminate(); } catch { /* already gone */ } }
  }

  /**
   * Keep the words in the document. With `bake` the source file is rewritten with an invisible text
   * layer, so Find, Edit text and the AI read it at once; otherwise Save writes it.
   */
  async function applyOcr(results, { lang = "eng", bake = true } = {}) {
    if (bake) {
      const byFile = new Map();
      for (const [pageId, words] of results) {
        const p = store.pageById(pageId);
        if (!byFile.has(p.src.fileId)) byFile.set(p.src.fileId, []);
        byFile.get(p.src.fileId).push({ index: p.src.index, words });
      }
      for (const [fileId, list] of byFile) {
        const rec = state.files.get(fileId);
        const doc = await PDFDocument.load(rec.bytes, { password: rec.password || undefined, updateMetadata: false });
        const pages = doc.getPages();
        const all = list.flatMap((x) => x.words);
        const font = await chooseFont(doc, all, unicodeFont);
        for (const { index, words } of list) {
          const pg = pages[index];
          const box = state.pages.find((q) => q.src.fileId === fileId && q.src.index === index)?.box || [0, 0, pg.getWidth(), pg.getHeight()];
          writeTextLayer(pg, box, words, font);
        }
        const bytes = await doc.save();
        const pdf = await app.pdf.openPdf(bytes);
        const old = rec.pdf;
        rec.bytes = bytes; rec.pdf = pdf; if (rec.password) rec.hadPassword = true; rec.password = "";
        old?.destroy?.();
      }
      app.clearTextCache();
    }
    store.change("Read scan", () => {
      const forms = { ...(state.extras.forms || {}) };
      forms.ocr = { ...(forms.ocr || {}) };
      for (const [pageId, words] of results) forms.ocr[pageId] = { lang, baked: bake, words: words.map((w) => ({ ...w, x: r1(w.x), y: r1(w.y), w: r1(w.w), h: r1(w.h) })) };
      state.extras.forms = forms;
    }, { pages: "all" });
    if (bake) app.viewer.rerender([...results.keys()]);
  }
  const r1 = (n) => Math.round(n * 10) / 10;

  // The Save step: words that were kept but not yet written into their file.
  app.registerExportStep({
    id: "ocr-text", label: "Adding the scan's text", order: 150,
    async run(ctx) {
      const map = ocrMap();
      const todo = ctx.pages.filter(({ page }) => map[page.id] && !map[page.id].baked && map[page.id].words?.length);
      if (!todo.length) return;
      const font = await chooseFont(ctx.doc, todo.flatMap(({ page }) => map[page.id].words), unicodeFont);
      for (const { page, pdfPage } of todo) writeTextLayer(pdfPage, page.box, map[page.id].words, font);
    },
  });

  // ---- text out -------------------------------------------------------------------------------
  async function allText({ read = true, lang, dpi } = {}) {
    if (read) {
      const blank = await blankPages();
      if (blank.length && (await looksScanned(blank[0]).catch(() => false))) await readScan({ pageIds: blank, lang, dpi });
    }
    const parts = [];
    for (const p of state.pages) parts.push((await app.pageString(p.id)).trim());
    return parts.filter(Boolean).join("\n\n");
  }
  app.fs.ocr = { readScan, applyOcr, blankPages, allText, wordsToText };

  // ---- the panel ---------------------------------------------------------------------------------
  const settings = { lang: "eng", dpi: 200 };
  app.registerPanel({
    id: "ocr", title: "Read scan", label: "Read scan", icon: "ScanText", order: 70, belt: false,
    render(box) {
      const status = el("p.fs-found", {}, icon("ScanText", 16), "Checking your pages…");
      const lang = el("select.sel", { "aria-label": "Language of the text", on: { change: () => { settings.lang = lang.value; } } },
        LANGS.map(([c, n]) => el("option", { value: c, selected: c === settings.lang }, n)));
      const dpi = el("select.sel", { "aria-label": "Reading quality", on: { change: () => { settings.dpi = Number(dpi.value); } } },
        el("option", { value: 200, selected: settings.dpi === 200 }, "Normal (fast)"), el("option", { value: 300, selected: settings.dpi === 300 }, "Sharper (slower)"));
      const out = (fn) => async () => { const t = await allText({ lang: settings.lang, dpi: settings.dpi }); if (!t) { toast("There's no text to use yet."); return; } await fn(t); };
      box.append(
        el("p.muted", {}, "Scans and photos are just pictures of words. This reads them, so you can search, select and copy the text. It all happens on your device."),
        status,
        el("label.fs-field", {}, el("span", {}, "Language of the page"), lang),
        el("label.fs-field", {}, el("span", {}, "Quality"), dpi),
        el("button.btn.primary.fs-wide", { type: "button", on: { click: async () => { const n = await readScan({ lang: settings.lang, dpi: settings.dpi }); if (n) refresh(); } } }, icon("ScanText", 18), "Make it searchable"),
        el("div.row", {},
          el("button.btn", { type: "button", on: { click: out(async (t) => { await navigator.clipboard.writeText(t); toast("Copied all the text."); }) } }, icon("Copy", 16), "Copy all text"),
          el("button.btn", { type: "button", on: { click: out(async (t) => { await app.deliver(new Blob([t], { type: "text/plain" }), app.outName("txt"), { type: "text/plain" }); }) } }, icon("FileText", 16), "Download .txt")));
      const refresh = async () => {
        const blank = await blankPages();
        status.replaceChildren(icon(blank.length ? "Info" : "BadgeCheck", 16), blank.length ? `${blank.length} of ${state.pages.length} page${state.pages.length > 1 ? "s are" : " is"} pictures with no text.` : "Every page has text you can search and copy.");
      };
      refresh();
    },
  });

  app.registerTask({ id: "ocr", title: "Make a scan searchable (OCR)", blurb: "Read the words in a scan or photo", icon: "ScanText", color: "cyan", group: "convert", order: 30, usesOpenDoc: true,
    run: async (a, files) => { if (files?.length && !(await a.open(files))) return; a.openPanel("ocr"); } });
  app.registerCommands(() => state.pages.length ? [{ id: "fs:ocr", label: "Find text in scans (OCR)", group: "Tools", icon: "ScanText", keywords: "read scan searchable ocr", run: () => app.openPanel("ocr") }] : []);

  // ---- a gentle offer when a scan is opened ---------------------------------------------------
  let offered = "";
  store.on(async (e) => {
    if (e.type !== "pages-built" || !state.pages.length) return;
    const key = [...state.files.keys()].join(",");
    if (offered === key) return;
    offered = key;
    try {
      const blank = await blankPages(3);
      if (!blank.length || !(await looksScanned(blank[0]))) return;
      toast(el("span.fs-offer", {}, "This looks like a scan, so its words can't be searched. ",
        el("button.btn.small.primary", { type: "button", on: { click: () => app.openPanel("ocr") } }, "Read it")), { ms: 9000 });
    } catch (err) { console.warn("[ocr] offer check", err); }
  });
}
