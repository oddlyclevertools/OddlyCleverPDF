// "Anything to PDF": every importer makes real PDF bytes, with selectable text where the source has text.
import { PDFDocument } from "@cantoo/pdf-lib";
import { fontFile, fontBytes } from "../../core/fonts.js";
import { csvParse, xlsxToSheets, sheetsToBlocks, rtfToBlocks } from "./readers.js";

let appRef = null;
const note = (m) => appRef?.toast(m, { ms: 6000 });
const A4 = { w: 595.28, h: 841.89 };

export const IMAGE_PAGE_KEY = "oc.convert.imagePage";
export const imagePageMode = () => { try { return localStorage.getItem(IMAGE_PAGE_KEY) || "picture"; } catch { return "picture"; } };

const loadFont = (family, bold, italic) => fontBytes(fontFile(family, bold, italic));

async function render(blocks, o = {}) {
  const { blocksToPdf } = await import("./layout-pdf.js");
  const r = await blocksToPdf(blocks, { loadFont, ...o });
  for (const n of r.notes) note(n);
  return r.bytes;
}

const pdfToBlob = (bytes, type) => new Blob([bytes], { type });

/** Decode any picture the browser knows into PNG/JPEG bytes plus its pixel size. */
export async function loadImage(data, mime) {
  if (mime === "image/svg+xml") return svgBytesToPng(data);
  const blob = new Blob([data], { type: mime });
  const bmp = await createImageBitmap(blob);
  try {
    if (mime === "image/png" || mime === "image/jpeg") return { data, mime, w: bmp.width, h: bmp.height };
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    return { data: await canvasPng(c), mime: "image/png", w: bmp.width, h: bmp.height };
  } finally { bmp.close?.(); }
}
const canvasPng = (c) => new Promise((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("Couldn't read the picture."))), "image/png"));

async function svgBytesToPng(data) {
  const text = new TextDecoder().decode(data);
  let w = parseFloat((/<svg[^>]*\swidth="([\d.]+)/.exec(text) || [])[1]), h = parseFloat((/<svg[^>]*\sheight="([\d.]+)/.exec(text) || [])[1]);
  const vb = /viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(text);
  if ((!w || !h) && vb) { w = Number(vb[1]); h = Number(vb[2]); }
  w = w || 800; h = h || 600;
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error("I couldn't draw that SVG picture."); });
    const k = Math.min(2, 4096 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { data: await canvasPng(c), mime: "image/png", w, h };
  } finally { URL.revokeObjectURL(url); }
}

const readText = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); } catch { return new TextDecoder("windows-1252").decode(buf); }
};

const htmlBlocks = async (html, notes) => (await import("./html-ir.js")).htmlToBlocks(html, { loadImage, notes });
const withNotes = async (fn) => { const notes = []; const out = await fn(notes); [...new Set(notes)].forEach(note); return out; };

// ---- the importers ------------------------------------------------------------------------
const codeExts = ["txt", "text", "log", "json", "xml", "yml", "yaml", "ini", "toml", "js", "mjs", "ts", "tsx", "jsx", "py", "css", "scss", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "rb", "php", "sh", "bat", "sql", "swift", "kt", "lua", "vue", "srt", "conf", "cfg", "env"];

async function textToPdf(file) {
  let text = await readText(file);
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as it is */ } }
  return render([{ type: "code", text }], { title: file.name });
}
async function csvToPdf(file) {
  const rows = csvParse(await readText(file), /\.tsv$/i.test(file.name) ? "\t" : undefined);
  return render(sheetsToBlocks([{ name: file.name.replace(/\.[^.]+$/, ""), rows }]), { title: file.name, margin: 40, size: 10 });
}
async function markdownToPdf(file) {
  const { markdownToHtml } = await import("./md.js");
  return withNotes(async (notes) => render(await htmlBlocks(markdownToHtml(await readText(file)), notes), { title: file.name }));
}
async function htmlToPdf(file) {
  return withNotes(async (notes) => render(await htmlBlocks(await readText(file), notes), { title: file.name }));
}
async function docxToPdf(file) {
  const mammoth = (await import("mammoth")).default || (await import("mammoth"));
  const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
    convertImage: mammoth.images.imgElement(async (image) => ({ src: `data:${image.contentType};base64,${await image.read("base64")}` })),
  });
  return withNotes(async (notes) => render(await htmlBlocks(res.value, notes), { title: file.name }));
}
async function xlsxToPdf(file) {
  const sheets = xlsxToSheets(new Uint8Array(await file.arrayBuffer()));
  if (!sheets.length) throw new Error("That spreadsheet has no sheets I can read.");
  return render(sheetsToBlocks(sheets), { title: file.name, margin: 40, size: 10 });
}
async function odsToPdf(file) {
  const { odsToSheets } = await import("./office-readers.js");
  return render(sheetsToBlocks(odsToSheets(new Uint8Array(await file.arrayBuffer()))), { title: file.name, margin: 40, size: 10 });
}
async function pptxToPdf(file) {
  const { pptxToBlocks } = await import("./office-readers.js");
  return withNotes(async (notes) => {
    const { blocks } = await pptxToBlocks(new Uint8Array(await file.arrayBuffer()), { loadImage, notes });
    return render(blocks, { title: file.name, margin: 36, size: 15 });
  });
}
async function odtToPdf(file) {
  const { odtToHtml } = await import("./office-readers.js");
  return withNotes(async (notes) => render(await htmlBlocks(odtToHtml(new Uint8Array(await file.arrayBuffer())), notes), { title: file.name }));
}
async function rtfToPdf(file) {
  return render(rtfToBlocks(await readText(file)), { title: file.name });
}
async function svgToPdf(file) {
  const img = await svgBytesToPng(new Uint8Array(await file.arrayBuffer()));
  const k = Math.min(0.75, 842 / Math.max(img.w, img.h));
  return render([{ type: "pagebreak", w: img.w * k, h: img.h * k }, { type: "image", data: img.data, mime: img.mime, w: img.w * k, h: img.h * k }], { margin: 0, title: file.name });
}
async function heicToPdf(file) {
  try { return await pictureToPdf(file); } catch {
    throw new Error("This browser can't open HEIC pictures yet. Open it on an iPhone, Mac or in Safari, or save it as a JPG first.");
  }
}

/** One picture, one page. Size: the picture's own (default) or A4 with the picture fitted inside. */
async function pictureToPdf(file) {
  const bmp = await createImageBitmap(file); // honours the photo's rotation
  const ow = bmp.width, oh = bmp.height;
  const cap = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const pw = Math.max(1, Math.round(bmp.width * cap)), ph = Math.max(1, Math.round(bmp.height * cap));
  const c = document.createElement("canvas");
  c.width = pw; c.height = ph;
  const g = c.getContext("2d");
  const photo = file.type === "image/jpeg" || /\.(jpe?g|heic|heif|avif)$/i.test(file.name);
  if (photo) { g.fillStyle = "#fff"; g.fillRect(0, 0, pw, ph); }
  g.drawImage(bmp, 0, 0, pw, ph);
  bmp.close?.();
  const bytes = await new Promise((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("Couldn't read that picture."))), photo ? "image/jpeg" : "image/png", 0.92));
  const doc = await PDFDocument.create();
  const img = photo ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  let W, H, x, y, w, h;
  if (imagePageMode() === "a4") {
    const land = pw > ph;
    W = land ? A4.h : A4.w; H = land ? A4.w : A4.h;
    const k = Math.min((W - 56) / pw, (H - 56) / ph);
    w = pw * k; h = ph * k; x = (W - w) / 2; y = (H - h) / 2;
  } else {
    const k = Math.min(0.75, 842 / Math.max(ow, oh));
    W = w = ow * k; H = h = oh * k; x = 0; y = 0;
  }
  doc.addPage([W, H]).drawImage(img, { x, y, width: w, height: h });
  return doc.save();
}

export const IMPORTERS = [
  // first, so the more specific importers below win the "image/*" match (later registrations win)
  { id: "image-basic", label: "Pictures", exts: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"], mimes: ["image/*"], toPdf: pictureToPdf },
  { id: "cv-docx", label: "Word documents", exts: ["docx"], mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], toPdf: docxToPdf },
  { id: "cv-text", label: "Text and code", exts: codeExts, toPdf: textToPdf },
  { id: "cv-csv", label: "Tables (CSV)", exts: ["csv", "tsv"], mimes: ["text/csv"], toPdf: csvToPdf },
  { id: "cv-md", label: "Markdown", exts: ["md", "markdown"], mimes: ["text/markdown"], toPdf: markdownToPdf },
  { id: "cv-html", label: "Web pages", exts: ["html", "htm", "xhtml"], mimes: ["text/html"], toPdf: htmlToPdf },
  { id: "cv-xlsx", label: "Excel", exts: ["xlsx", "xlsm"], mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], toPdf: xlsxToPdf },
  { id: "cv-ods", label: "OpenDocument spreadsheets", exts: ["ods"], toPdf: odsToPdf },
  { id: "cv-pptx", label: "PowerPoint", exts: ["pptx"], mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], toPdf: pptxToPdf },
  { id: "cv-odt", label: "OpenDocument text", exts: ["odt"], toPdf: odtToPdf },
  { id: "cv-rtf", label: "Rich text", exts: ["rtf"], mimes: ["application/rtf", "text/rtf"], toPdf: rtfToPdf },
  { id: "cv-svg", label: "SVG pictures", exts: ["svg"], mimes: ["image/svg+xml"], toPdf: svgToPdf },
  { id: "cv-heic", label: "HEIC photos", exts: ["heic", "heif"], mimes: ["image/heic", "image/heif"], toPdf: heicToPdf },
];

export function registerImporters(app) {
  appRef = app;
  for (const imp of IMPORTERS) app.registerImporter(imp);
}
export { pdfToBlob };
