// Build the finished PDF from the model with pdf-lib: assemble the pages (keeping the original
// file's forms, links and outline when it can), rotate them, draw every edit as real PDF content
// (text stays text), then run the export steps features register (forms, watermark, redaction,
// password…). Returns the bytes.
import { PDFDocument, PDFName, PDFString, PDFHexString, rgb, degrees, BlendMode, LineCapStyle } from "@cantoo/pdf-lib";
import { state } from "./store.js";
import { fontFile, fontBytes, cssFamily } from "./fonts.js";
import { ownLetters } from "./type3.js";

export const lib = { PDFDocument, PDFName, PDFString, PDFHexString, rgb, degrees, BlendMode, LineCapStyle };

const steps = [];
/**
 * Add a step to every export. run(ctx) may change ctx.doc (a pdf-lib PDFDocument) or replace it.
 * Orders: 100 forms, 200 page content (watermark, numbers), 500 redaction, 900 security.
 * @param {{ id: string, order?: number, run: (ctx: ExportCtx) => Promise<void>|void }} step
 */
export function registerExportStep(step) {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i >= 0) steps.splice(i, 1);
  steps.push({ order: 500, ...step });
  steps.sort((a, b) => a.order - b.order);
}

export function hexToRgb(hex, fallback = [0, 0, 0]) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return rgb(...fallback);
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const dataUrlBytes = (url) => {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Load every source file into pdf-lib once. */
async function loadSources() {
  const docs = new Map();
  for (const f of state.files.values()) {
    docs.set(f.id, await PDFDocument.load(f.bytes, { password: f.password || undefined, updateMetadata: false, ignoreEncryption: false }));
  }
  return docs;
}

/** Put the pages in the model's order, in one pdf-lib document. Keeps the main file's extras. */
async function assemble(docs) {
  const order = state.pages;
  const baseId = order[0]?.src.fileId;
  const base = docs.get(baseId) || (await PDFDocument.create());
  const basePages = base.getPages();
  const used = new Set();
  const list = [];
  for (const p of order) {
    const src = docs.get(p.src.fileId);
    if (src === base && !used.has(p.src.index)) {
      used.add(p.src.index);
      list.push(basePages[p.src.index]);
    } else {
      const [copy] = await base.copyPages(src, [p.src.index]);
      list.push(copy);
    }
  }
  const identity = list.length === basePages.length && list.every((pg, i) => pg === basePages[i]);
  if (!identity) {
    for (let i = base.getPageCount() - 1; i >= 0; i--) base.removePage(i);
    for (const pg of list) base.addPage(pg);
  }
  return { doc: base, pdfPages: list };
}

function metrics(font) {
  const fk = font?.embedder?.font;
  if (fk?.unitsPerEm) return { asc: fk.ascent / fk.unitsPerEm, desc: Math.abs(fk.descent) / fk.unitsPerEm };
  return { asc: 0.8, desc: 0.2 };
}

/** Break text into lines that fit `width` with pdf-lib's own measurements (newlines kept). */
export function wrapText(text, font, size, width) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    if (!width || width <= 0) { lines.push(para); continue; }
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (line.trim() && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
      // a single word longer than the box: break it by letters
      while (line && font.widthOfTextAtSize(line.trimEnd(), size) > width) {
        let k = line.length;
        while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Fonts are embedded once per document. */
function fontLoader(doc) {
  const map = new Map();
  let kit = null; // fontkit loads the first time a document needs one of our fonts
  return (family, bold, italic) => {
    const file = fontFile(family, bold, italic);
    if (!map.has(file)) {
      map.set(file, fontBytes(file).then(async (bytes) => {
        kit ||= import("@pdf-lib/fontkit").then((m) => doc.registerFontkit(m.default));
        await kit;
        // Whole fonts: fontkit's subsetter fails on these TTFs at save time (about 100-300 KB each).
        return doc.embedFont(bytes, { subset: false });
      }));
    }
    return map.get(file);
  };
}

/** Text the font can't draw (Arabic, CJK, emoji…) becomes a crisp picture made by the browser. */
async function textAsPicture(o) {
  const scale = 4;
  const c = document.createElement("canvas");
  c.width = Math.ceil(o.w * scale); c.height = Math.ceil(o.h * scale);
  const g = c.getContext("2d");
  g.scale(scale, scale);
  const size = o.size || 14, lh = size * (o.lineHeight || 1.25);
  g.font = `${o.italic ? "italic " : ""}${o.bold ? "700 " : "400 "}${size}px ${cssFamily(o.font)}`;
  g.fillStyle = o.color || "#111";
  g.textBaseline = "middle";
  g.direction = "inherit";
  const lines = [];
  for (const para of String(o.text || "").split("\n")) {
    let line = "";
    for (const w of para.split(/(\s+)/)) {
      if (line && g.measureText((line + w).trimEnd()).width > o.w) { lines.push(line.trimEnd()); line = w.trimStart(); } else line += w;
    }
    lines.push(line);
  }
  lines.forEach((ln, i) => {
    const tw = g.measureText(ln).width;
    const x = o.align === "center" ? (o.w - tw) / 2 : o.align === "right" ? o.w - tw : 0;
    g.fillText(ln, x, i * lh + lh / 2);
  });
  return c.toDataURL("image/png");
}

const canDraw = (font, text) => {
  const set = font.getCharacterSet?.();
  if (!set) return true;
  const has = new Set(set);
  for (const ch of String(text)) { const cp = ch.codePointAt(0); if (cp > 32 && !has.has(cp)) return false; }
  return true;
};

const BORROWED = "Some letters you typed aren't in this PDF's own font, so we matched them as closely as we could.";

async function drawObject(ctx, page, pdfPage, o) {
  const [bx0, , , by1] = page.box;
  const X = (x) => bx0 + x;
  const Y = (y) => by1 - y;
  const op = o.opacity ?? 1;
  switch (o.type) {
    case "whiteout":
    case "redact":
      pdfPage.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.type === "redact" ? "#000000" : o.color || "#ffffff") });
      if (o.type === "redact") ctx.redactions.push({ pageId: page.id, rect: { x: o.x, y: o.y, w: o.w, h: o.h } });
      return;
    case "rect":
      pdfPage.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h,
        color: o.fill && o.fill !== "none" ? hexToRgb(o.fill) : undefined, opacity: op,
        borderColor: o.stroke && o.stroke !== "none" ? hexToRgb(o.stroke) : undefined, borderWidth: o.stroke && o.stroke !== "none" ? o.width ?? 2 : 0, borderOpacity: op });
      return;
    case "ellipse":
      pdfPage.drawEllipse({ x: X(o.x + o.w / 2), y: Y(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2,
        color: o.fill && o.fill !== "none" ? hexToRgb(o.fill) : undefined, opacity: op,
        borderColor: o.stroke && o.stroke !== "none" ? hexToRgb(o.stroke) : undefined, borderWidth: o.stroke && o.stroke !== "none" ? o.width ?? 2 : 0, borderOpacity: op });
      return;
    case "line":
    case "arrow": {
      const col = hexToRgb(o.stroke || "#111");
      const w = o.width ?? 2;
      pdfPage.drawLine({ start: { x: X(o.x1), y: Y(o.y1) }, end: { x: X(o.x2), y: Y(o.y2) }, thickness: w, color: col, opacity: op, lineCap: LineCapStyle.Round });
      if (o.type === "arrow") {
        const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), L = Math.max(8, w * 4);
        const p1 = [o.x2 - L * Math.cos(a - 0.45), o.y2 - L * Math.sin(a - 0.45)];
        const p2 = [o.x2 - L * Math.cos(a + 0.45), o.y2 - L * Math.sin(a + 0.45)];
        pdfPage.drawSvgPath(`M${o.x2} ${o.y2} L${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} Z`, { x: bx0, y: by1, color: col, opacity: op, borderWidth: 0 });
      }
      return;
    }
    case "ink": {
      for (const s of o.strokes || []) {
        if (s.length < 2) {
          if (s.length === 1) pdfPage.drawCircle({ x: X(s[0][0]), y: Y(s[0][1]), size: (o.width ?? 2) / 2, color: hexToRgb(o.color), opacity: op });
          continue;
        }
        const d = s.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
        pdfPage.drawSvgPath(d, { x: bx0, y: by1, borderColor: hexToRgb(o.color), borderWidth: o.width ?? 2, borderOpacity: op, borderLineCap: LineCapStyle.Round });
      }
      return;
    }
    case "highlight": {
      const col = hexToRgb(o.color || "#ffd60a");
      for (const r of o.rects || []) {
        if (o.style === "underline" || o.style === "strike") {
          const yy = o.style === "underline" ? r.y + r.h * 0.95 : r.y + r.h * 0.55;
          pdfPage.drawLine({ start: { x: X(r.x), y: Y(yy) }, end: { x: X(r.x + r.w), y: Y(yy) }, thickness: Math.max(0.8, r.h * 0.07), color: col, opacity: op });
        } else {
          pdfPage.drawRectangle({ x: X(r.x), y: Y(r.y + r.h), width: r.w, height: r.h, color: col, opacity: o.opacity ?? 0.45, blendMode: BlendMode.Multiply });
        }
      }
      return;
    }
    case "image": {
      const url = state.images.get(o.imageId);
      if (!url) return;
      const bytes = dataUrlBytes(url);
      const img = url.startsWith("data:image/jpeg") ? await ctx.doc.embedJpg(bytes) : await ctx.doc.embedPng(bytes);
      pdfPage.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, opacity: op });
      return;
    }
    case "note": {
      drawNoteIcon(pdfPage, X(o.x), Y(o.y), o.color || "#ffd60a");
      addTextAnnot(ctx.doc, pdfPage, { x: X(o.x), y: Y(o.y + 20), w: 20, h: 20 }, o.text || "", o.color || "#ffd60a", o.author);
      return;
    }
    case "text": {
      if (o.cover) {
        const c = o.cover;
        pdfPage.drawRectangle({ x: X(c.x), y: Y(c.y + c.h), width: c.w, height: c.h, color: hexToRgb(c.color || "#ffffff") });
      }
      if (o.bg) pdfPage.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.bg), opacity: op });
      if (!String(o.text || "").trim()) return;
      const font = await ctx.font(o.font || "sans", !!o.bold, !!o.italic);
      if (!canDraw(font, o.text)) {
        const url = await textAsPicture(o);
        const img = await ctx.doc.embedPng(dataUrlBytes(url));
        pdfPage.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, opacity: op });
        return;
      }
      const own = ownLetters(o.font);
      if (own && [...o.text].some((ch) => ch.trim() && !own.has(ch)) && !ctx.notes.includes(BORROWED)) ctx.notes.push(BORROWED);
      const size = o.size || 14;
      const lh = size * (o.lineHeight || 1.25);
      const { asc, desc } = metrics(font);
      const baseOff = (lh - (asc + desc) * size) / 2 + asc * size;
      const lines = wrapText(o.text, font, size, o.w + 0.5);
      const color = hexToRgb(o.color || "#111111");
      lines.forEach((ln, i) => {
        const tw = font.widthOfTextAtSize(ln, size);
        const dx = o.align === "center" ? (o.w - tw) / 2 : o.align === "right" ? o.w - tw : 0;
        pdfPage.drawText(ln, { x: X(o.x + dx), y: Y(o.y + i * lh + baseOff), size, font, color, opacity: op });
        if (o.underline) pdfPage.drawLine({ start: { x: X(o.x + dx), y: Y(o.y + i * lh + baseOff + size * 0.12) }, end: { x: X(o.x + dx + tw), y: Y(o.y + i * lh + baseOff + size * 0.12) }, thickness: size / 14, color, opacity: op });
      });
      return;
    }
    default:
      ctx.unknown.push(o.type);
  }
}

function drawNoteIcon(pdfPage, x, y, hex) {
  pdfPage.drawRectangle({ x, y: y - 20, width: 20, height: 20, color: hexToRgb(hex), borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1 });
  for (let i = 0; i < 3; i++) pdfPage.drawLine({ start: { x: x + 4, y: y - 6 - i * 4 }, end: { x: x + 16 - (i === 2 ? 5 : 0), y: y - 6 - i * 4 }, thickness: 1, color: rgb(0.1, 0.1, 0.1) });
}

/** A real PDF comment (a "Text" annotation) so other readers show the note too. */
export function addTextAnnot(doc, pdfPage, r, text, hex, author = "") {
  const c = hexToRgb(hex);
  const annot = doc.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [r.x, r.y, r.x + r.w, r.y + r.h],
    Contents: PDFHexString.fromText(text), Name: "Comment", C: [c.red, c.green, c.blue], Open: false, F: 4,
    ...(author ? { T: PDFHexString.fromText(author) } : {}),
  });
  const ref = doc.context.register(annot);
  const annots = pdfPage.node.lookup(PDFName.of("Annots"));
  if (annots) annots.push(ref); else pdfPage.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

/**
 * @typedef {{ doc: PDFDocument, pages: Array<{ page: object, pdfPage: any }>, font: Function, lib: typeof lib,
 *   opts: object, redactions: Array, unknown: string[], notes: string[] }} ExportCtx
 */

/**
 * Make the finished PDF.
 * @param {{ pageIds?: string[], skipSteps?: string[], onProgress?: (f: number, label: string) => void }} [opts]
 *   pageIds limits the output to those pages (extract/split); skipSteps leaves steps out.
 * @returns {Promise<{ bytes: Uint8Array, notes: string[] }>}
 */
export async function buildPdf(opts = {}) {
  if (!state.pages.length) throw new Error("There are no pages to save.");
  const prog = opts.onProgress || (() => {});
  prog(0.05, "Reading your files");
  const docs = await loadSources();
  const saved = state.pages;
  const only = opts.pageIds ? new Set(opts.pageIds) : null;
  if (only) state.pages = saved.filter((p) => only.has(p.id));
  try {
    prog(0.2, "Putting pages in order");
    const { doc, pdfPages } = await assemble(docs);
    const ctx = { doc, pages: state.pages.map((page, i) => ({ page, pdfPage: pdfPages[i] })), font: fontLoader(doc), lib, opts, redactions: [], unknown: [], notes: [] };
    prog(0.35, "Drawing your edits");
    for (const { page, pdfPage } of ctx.pages) {
      pdfPage.setRotation(degrees(((page.rotate % 360) + 360) % 360));
      for (const o of page.objects) await drawObject(ctx, page, pdfPage, o);
    }
    if (state.meta.title) doc.setTitle(state.meta.title);
    if (state.meta.author) doc.setAuthor(state.meta.author);
    if (state.meta.subject) doc.setSubject(state.meta.subject);
    if (state.meta.keywords) doc.setKeywords(String(state.meta.keywords).split(/,\s*/));
    doc.setProducer("OddlyClever PDF");
    doc.setModificationDate(new Date());
    const skip = new Set(opts.skipSteps || []);
    let k = 0;
    for (const s of steps) {
      if (skip.has(s.id)) continue;
      prog(0.5 + (0.4 * k++) / Math.max(1, steps.length), s.label || "Finishing");
      await s.run(ctx);
    }
    prog(0.92, "Saving");
    const bytes = await ctx.doc.save({ useObjectStreams: true });
    prog(1, "Done");
    return { bytes, notes: ctx.notes };
  } finally {
    state.pages = saved;
  }
}

/** Save bytes to the user's device (download, or the share sheet on phones when asked). */
export async function deliver(bytes, filename, { type = "application/pdf", share = false } = {}) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  if (share && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type || type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return "shared"; } catch (e) { if (e?.name === "AbortError") return "cancelled"; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}

/** "report.pdf" -> "report (edited).pdf"; a new extension when given. */
export function outName(ext = "pdf", suffix = "") {
  const base = (state.name || "document").replace(/\.[a-z0-9]{1,5}$/i, "");
  return `${base}${suffix ? ` ${suffix}` : ""}.${ext}`;
}
