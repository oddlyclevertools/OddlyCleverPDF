// "Convert to…" targets: each reads the finished document (app.outputPdf) and returns { blob, filename }.
import { zipSync } from "fflate";
import { analyzeDocument, pageGrid } from "./analyze.js";
import { toTxt, toMarkdown, toHtml, toRtf } from "./write-text.js";
import { buildXlsx, buildCsv } from "./write-xlsx.js";
import { buildOdt, buildEpub } from "./write-zipdocs.js";
import { baseName, runsText } from "./ir.js";
import { abortIf, pickPages, loadPages, loadText, renderPage, canvasBytes, pageSize } from "./pagedata.js";

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", epub: "application/epub+zip", zip: "application/zip",
  csv: "text/csv;charset=utf-8", txt: "text/plain;charset=utf-8", md: "text/markdown;charset=utf-8", html: "text/html;charset=utf-8",
  rtf: "application/rtf", json: "application/json", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp",
};
const blobOf = (data, ext) => new Blob([data], { type: MIME[ext] });
const nameOf = (app, ext, suffix = "") => app.outName(ext, suffix);

/** Shared setup: the saved document, the chosen pages. */
async function prepare(app, ctx) {
  const { pdf } = await app.outputPdf({ onProgress: (f, l) => ctx.progress?.(f * 0.1, l) });
  const indexes = pickPages(app, ctx, pdf.numPages);
  return { pdf, indexes };
}
const opt = (ctx, key, dflt) => ctx?.options?.[key] ?? dflt;

const medianOf = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// ---- Word ---------------------------------------------------------------------------------
async function runDocx(app, ctx) {
  const { pdf, indexes } = await prepare(app, ctx);
  const { buildDocx, buildDocxExact } = await import("./write-docx.js");
  const title = baseName(app.state.name);
  if (opt(ctx, "mode", "editable") === "exact") {
    const pages = [];
    for (const [k, i] of indexes.entries()) {
      abortIf(ctx.signal);
      ctx.progress?.(0.1 + (k / indexes.length) * 0.8, `Picturing page ${i + 1}`);
      const { w, h } = await pageSize(pdf, i);
      const canvas = await renderPage(app, pdf, i, 150);
      const text = (await app.pdf.pagePlainText(pdf, i)) || "";
      pages.push({ w, h, png: await canvasBytes(canvas, "image/png"), text });
    }
    ctx.progress?.(0.95, "Building the Word file");
    return { blob: blobOf(await buildDocxExact(pages, { title }), "docx"), filename: nameOf(app, "docx") };
  }
  const data = await loadPages(app, pdf, indexes, { signal: ctx.signal, progress: (f, l) => ctx.progress?.(0.1 + f * 0.7, l) });
  const { perPage, body } = analyzeDocument(data);
  const pages = data.map((p, k) => {
    const xs = p.lines.map((l) => l.x);
    const margin = xs.length ? Math.max(36, Math.min(90, Math.round(medianOf(xs)))) : 54;
    return { w: p.w, h: p.h, margin, blocks: perPage[k] };
  });
  ctx.progress?.(0.9, "Building the Word file");
  return { blob: blobOf(await buildDocx(pages, { title, body }), "docx"), filename: nameOf(app, "docx") };
}

// ---- Excel / CSV --------------------------------------------------------------------------
async function gridPages(app, ctx) {
  const { pdf, indexes } = await prepare(app, ctx);
  const pages = await loadText(app, pdf, indexes, { signal: ctx.signal, progress: (f, l) => ctx.progress?.(0.1 + f * 0.7, l) });
  return pages.map((p) => ({ index: p.index, ...pageGrid(p) }));
}
async function runXlsx(app, ctx) {
  const grids = await gridPages(app, ctx);
  let sheets;
  if (opt(ctx, "split", "page") === "table") {
    sheets = grids.flatMap((g) => g.tables.map((t, k) => ({ name: `Page ${g.index + 1} table ${k + 1}`, rows: t.map((r, ri) => (ri === 0 ? r.map((v) => ({ v, bold: true })) : r)) })));
    if (!sheets.length) { app.toast("I couldn't find a table, so each page is one sheet instead."); }
  }
  if (!sheets?.length) sheets = grids.map((g) => ({ name: `Page ${g.index + 1}`, rows: g.rows }));
  return { blob: blobOf(buildXlsx(sheets), "xlsx"), filename: nameOf(app, "xlsx") };
}
async function runCsv(app, ctx) {
  const grids = await gridPages(app, ctx);
  const rows = [];
  grids.forEach((g, i) => { if (i) rows.push([]); rows.push(...g.rows); });
  return { blob: blobOf(buildCsv(rows), "csv"), filename: nameOf(app, "csv") };
}

// ---- PowerPoint ---------------------------------------------------------------------------
const FACE = { sans: "Arial", serif: "Times New Roman", mono: "Courier New", hand: "Comic Sans MS", script: "Brush Script MT" };
const hex2 = (n) => n.toString(16).padStart(2, "0");

/** Paint over the page's text with the colour next to it, and say what colour each line was. */
function eraseText(canvas, lines, k) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const colours = [];
  for (const l of lines) {
    const x = Math.max(0, Math.floor(l.x * k) - 1), y = Math.max(0, Math.floor(l.y * k)), w = Math.min(canvas.width - x, Math.ceil(l.w * k) + 2), h = Math.min(canvas.height - y, Math.ceil(l.h * k) + 1);
    if (w < 2 || h < 2) { colours.push("000000"); continue; }
    const px = ctx.getImageData(x, y, w, h).data;
    let best = 999, dark = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { const lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11; if (lum < best) { best = lum; dark = [px[i], px[i + 1], px[i + 2]]; } }
    const bg = ctx.getImageData(Math.max(0, x - 2), y + (h >> 1), 1, 1).data;
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(x, y, w, h);
    colours.push(hex2(dark[0]) + hex2(dark[1]) + hex2(dark[2]));
  }
  return colours;
}
async function runPptx(app, ctx) {
  const { pdf, indexes } = await prepare(app, ctx);
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default || mod;
  const pptx = new PptxGenJS();
  const { w: w0, h: h0 } = await pageSize(pdf, indexes[0]);
  pptx.defineLayout({ name: "PDFPAGE", width: w0 / 72, height: h0 / 72 });
  pptx.layout = "PDFPAGE";
  pptx.title = baseName(app.state.name);
  const picOnly = opt(ctx, "mode", "text") === "picture";
  const text = picOnly ? [] : await loadText(app, pdf, indexes, { signal: ctx.signal });
  for (const [n, i] of indexes.entries()) {
    abortIf(ctx.signal);
    ctx.progress?.(0.1 + (n / indexes.length) * 0.85, `Building slide ${n + 1} of ${indexes.length}`);
    const { w, h } = await pageSize(pdf, i);
    const canvas = await renderPage(app, pdf, i, Math.min(150, 1800 / (w / 72)));
    const k = canvas.width / w;
    const lines = picOnly ? [] : text[n].lines.filter((l) => l.runs.length && l.text.trim());
    const colours = picOnly ? [] : eraseText(canvas, lines, k);
    const jpg = await canvasBytes(canvas, "image/jpeg", 0.85);
    const slide = pptx.addSlide();
    slide.background = { data: "image/jpeg;base64," + btoa(Array.from(jpg, (c) => String.fromCharCode(c)).join("")) };
    lines.forEach((l, li) => {
      const runs = [...l.runs].sort((a, b) => a.x - b.x);
      const parts = [];
      let prevEnd = null;
      for (const r of runs) {
        const gap = prevEnd != null && r.x - prevEnd > r.size * 0.18 && !/\s$/.test(parts[parts.length - 1]?.text || "") && !/^\s/.test(r.str);
        parts.push({ text: (gap ? " " : "") + r.str, options: { bold: r.bold, italic: r.italic, fontSize: Math.round(r.size * 10) / 10, fontFace: FACE[r.family] || "Arial", color: colours[li] } });
        prevEnd = r.x + r.w;
      }
      const pad = l.size * 0.6;
      slide.addText(parts, { x: l.x / 72, y: (l.y + l.h / 2 - l.size * 0.7) / 72, w: (l.w + pad) / 72, h: (l.size * 1.4) / 72, margin: 0, valign: "middle", wrap: false, fit: "none" });
    });
  }
  ctx.progress?.(0.97, "Saving the slides");
  const out = await pptx.write({ outputType: "uint8array" });
  return { blob: blobOf(out, "pptx"), filename: nameOf(app, "pptx") };
}

// ---- Pictures -----------------------------------------------------------------------------
const imgType = { png: ["image/png", 1], jpg: ["image/jpeg", 0.92], webp: ["image/webp", 0.92] };
function pictureExporter(ext) {
  return async (app, ctx) => {
    const { pdf, indexes } = await prepare(app, ctx);
    const dpi = Number(opt(ctx, "dpi", 150));
    const [mime, q] = imgType[ext];
    const files = {};
    for (const [n, i] of indexes.entries()) {
      abortIf(ctx.signal);
      ctx.progress?.(0.1 + (n / indexes.length) * 0.85, `Picturing page ${i + 1} of ${pdf.numPages}`);
      const canvas = await renderPage(app, pdf, i, dpi);
      files[app.outName(ext, `page ${i + 1}`)] = [await canvasBytes(canvas, mime, q), { level: 0 }];
    }
    const names = Object.keys(files);
    if (names.length === 1) return { blob: new Blob([files[names[0]][0]], { type: mime }), filename: names[0] };
    return { blob: blobOf(zipSync(files), "zip"), filename: nameOf(app, "zip", `${ext.toUpperCase()} pictures`) };
  };
}

// ---- Text & web ---------------------------------------------------------------------------
async function textBlocks(app, ctx, { pictures = false } = {}) {
  const { pdf, indexes } = await prepare(app, ctx);
  const data = await loadPages(app, pdf, indexes, { pictures, signal: ctx.signal, progress: (f, l) => ctx.progress?.(0.1 + f * 0.8, l) });
  return { ...analyzeDocument(data), data };
}
const simple = (ext, make, pictures = false) => async (app, ctx) => {
  const { blocks } = await textBlocks(app, ctx, { pictures });
  const out = make(blocks, { title: baseName(app.state.name) });
  return { blob: blobOf(out, ext), filename: nameOf(app, ext) };
};
async function runJson(app, ctx) {
  const { pdf, indexes } = await prepare(app, ctx);
  const data = await loadText(app, pdf, indexes, { signal: ctx.signal, progress: (f, l) => ctx.progress?.(0.1 + f * 0.8, l) });
  const r1 = (n) => Math.round(n * 10) / 10;
  const doc = {
    title: baseName(app.state.name), pageCount: data.length, units: "points, from the top-left corner of the page",
    pages: data.map((p) => ({
      number: p.index + 1, width: r1(p.w), height: r1(p.h),
      lines: p.lines.map((l) => ({
        text: l.text, x: r1(l.x), y: r1(l.y), width: r1(l.w), height: r1(l.h), size: r1(l.size),
        runs: l.runs.map((r) => ({ text: r.str, x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), size: r1(r.size), font: r.family, bold: !!r.bold, italic: !!r.italic })),
      })),
    })),
  };
  return { blob: blobOf(JSON.stringify(doc, null, 2), "json"), filename: nameOf(app, "json") };
}
async function runEpub(app, ctx) {
  const { perPage } = await textBlocks(app, ctx, { pictures: true });
  return { blob: blobOf(buildEpub(perPage, { title: baseName(app.state.name) }), "epub"), filename: nameOf(app, "epub") };
}

// ---- PDF types ----------------------------------------------------------------------------
function pdfFromPages(kind) {
  return async (app, ctx) => {
    const { pdf, indexes } = await prepare(app, ctx);
    const dpi = Number(opt(ctx, "dpi", 150));
    const doc = await app.pdfLib.PDFDocument.create();
    doc.setTitle(baseName(app.state.name));
    for (const [n, i] of indexes.entries()) {
      abortIf(ctx.signal);
      ctx.progress?.(0.1 + (n / indexes.length) * 0.85, `Flattening page ${i + 1}`);
      const { w, h } = await pageSize(pdf, i);
      const canvas = await renderPage(app, pdf, i, dpi);
      if (kind === "grey") greyscale(canvas);
      const img = await doc.embedJpg(await canvasBytes(canvas, "image/jpeg", 0.88));
      doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    const bytes = await doc.save();
    return { blob: blobOf(bytes, "pdf"), filename: nameOf(app, "pdf", kind === "grey" ? "(greyscale)" : "(print)") };
  };
}
export function greyscale(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(im, 0, 0);
}

// ---- registration -------------------------------------------------------------------------
const DPI = { key: "dpi", label: "Sharpness", choices: [{ value: 72, label: "Small (72 dpi)" }, { value: 150, label: "Good (150 dpi)" }, { value: 300, label: "Print (300 dpi)" }], value: 150 };

export const EXPORTERS = [
  { id: "cv-docx", label: "Word", ext: "docx", icon: "FileText", group: "Documents", badge: "DOCX", order: 10, blurb: "Real paragraphs, headings, lists, tables and pictures you can edit.", run: runDocx,
    options: [{ key: "mode", label: "Look", choices: [{ value: "editable", label: "Easy to edit" }, { value: "exact", label: "Exact look" }], value: "editable" }] },
  { id: "cv-odt", label: "OpenDocument", ext: "odt", icon: "FileType", group: "Documents", badge: "ODT", order: 12, blurb: "For LibreOffice and free office apps.", run: simple("odt", buildOdt, true) },
  { id: "cv-xlsx", label: "Excel", ext: "xlsx", icon: "Table", group: "Spreadsheets", badge: "XLSX", order: 20, blurb: "Tables become real cells, with numbers as numbers.", run: runXlsx,
    options: [{ key: "split", label: "Sheets", choices: [{ value: "page", label: "One per page" }, { value: "table", label: "One per table" }], value: "page" }] },
  { id: "cv-csv", label: "CSV", ext: "csv", icon: "Sheet", group: "Spreadsheets", badge: "CSV", order: 22, blurb: "Plain rows and columns for any spreadsheet or database.", run: runCsv },
  { id: "cv-pptx", label: "PowerPoint", ext: "pptx", icon: "Presentation", group: "Slides", badge: "PPTX", order: 30, blurb: "One slide per page, with text boxes you can change.", run: runPptx,
    options: [{ key: "mode", label: "Slides", choices: [{ value: "text", label: "With editable text" }, { value: "picture", label: "Pictures only" }], value: "text" }] },
  { id: "cv-png", label: "PNG pictures", ext: "png", icon: "Image", group: "Images", badge: "PNG", order: 40, blurb: "Sharp pictures, one per page.", run: pictureExporter("png"), options: [DPI] },
  { id: "cv-jpg", label: "JPG pictures", ext: "jpg", icon: "Image", group: "Images", badge: "JPG", order: 41, blurb: "Smaller pictures that suit photos.", run: pictureExporter("jpg"), options: [DPI] },
  { id: "cv-webp", label: "WebP pictures", ext: "webp", icon: "Image", group: "Images", badge: "WEBP", order: 42, blurb: "Small pictures for websites.", run: pictureExporter("webp"), options: [DPI] },
  { id: "cv-txt", label: "Plain text", ext: "txt", icon: "AlignLeft", group: "Text & web", badge: "TXT", order: 50, blurb: "Just the words.", run: simple("txt", toTxt) },
  { id: "cv-md", label: "Markdown", ext: "md", icon: "Hash", group: "Text & web", badge: "MD", order: 51, blurb: "Headings, lists and tables in simple marks.", run: simple("md", toMarkdown) },
  { id: "cv-html", label: "Web page", ext: "html", icon: "Globe", group: "Text & web", badge: "HTML", order: 52, blurb: "A tidy web page with pictures inside.", run: simple("html", toHtml, true) },
  { id: "cv-rtf", label: "Rich text", ext: "rtf", icon: "FileText", group: "Text & web", badge: "RTF", order: 53, blurb: "Opens in almost any word processor.", run: simple("rtf", toRtf) },
  { id: "cv-epub", label: "E-book", ext: "epub", icon: "BookOpen", group: "Text & web", badge: "EPUB", order: 54, blurb: "Reads well on a phone or e-reader.", run: runEpub },
  { id: "cv-json", label: "Data (JSON)", ext: "json", icon: "Braces", group: "Text & web", badge: "JSON", order: 55, blurb: "Every line and word with its position, for programmers.", run: runJson },
  { id: "cv-pdf-print", label: "PDF for printing", ext: "pdf", icon: "Printer", group: "PDF", badge: "PDF", order: 60, blurb: "Everything flattened into pictures, so it prints the same everywhere.", run: pdfFromPages("print"), options: [DPI] },
  { id: "cv-pdf-grey", label: "Black and white PDF", ext: "pdf", icon: "Contrast", group: "PDF", badge: "PDF", order: 61, blurb: "Greyscale pages, great for saving ink.", run: pdfFromPages("grey"), options: [{ ...DPI }] },
];

export function registerExporters(app) {
  for (const e of EXPORTERS) {
    app.registerExporter({
      ...e,
      run: (a, ctx = {}) => {
        const options = { ...Object.fromEntries((e.options || []).map((o) => [o.key, o.value])), ...(ctx.options || {}) };
        return e.run(a, { ...ctx, options });
      },
    });
  }
}
export { runsText };
