// pdf.js in one place: open bytes (asking for a password when needed), render a page to a canvas
// (unrotated: rotation is our job), and read its text with positions in our page space.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

const BASE = import.meta.env.BASE_URL;
const OPTS = {
  cMapUrl: `${BASE}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
  wasmUrl: `${BASE}pdfjs/wasm/`,
  iccUrl: `${BASE}pdfjs/iccs/`,
  isEvalSupported: false,
  fontExtraProperties: true, // real font names, serif and monospace flags (for Edit text's font match)
  enableXfa: false,
};

/**
 * How pdf.js paints annotations on the canvas. ENABLE paints form fields as they look in the file;
 * the forms feature switches to ENABLE_FORMS and draws live inputs over the page instead.
 */
export const renderOptions = { annotationMode: pdfjs.AnnotationMode.ENABLE, annotationStorage: null };

/** Thrown when a PDF needs a password (or the one given was wrong). */
export class NeedPassword extends Error {
  constructor(wrong) { super(wrong ? "That password didn't work." : "This PDF is locked with a password."); this.name = "NeedPassword"; this.wrong = wrong; }
}

/**
 * Open PDF bytes with pdf.js. pdf.js takes ownership of the buffer it gets, so it gets a copy.
 * @param {Uint8Array} bytes
 * @param {{ password?: string }} [o]
 */
export async function openPdf(bytes, { password } = {}) {
  const task = pdfjs.getDocument({ ...OPTS, data: bytes.slice(), password });
  try {
    return await task.promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new NeedPassword(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (e?.name === "InvalidPDFException") throw new Error("This file isn't a PDF, or it's damaged.");
    throw e;
  }
}

/** The view box and the page's own rotation, as pdf.js reports them. */
export async function pageInfo(pdf, index) {
  const page = await pdf.getPage(index + 1);
  return { box: [...page.view], rotate: page.rotate || 0 };
}

/**
 * Draw a page (unrotated) into a canvas at `scale` CSS pixels per point x devicePixelRatio.
 * Returns pdf.js's render task (cancel()-able) and a promise.
 */
export async function renderPage(pdf, index, canvas, { scale = 1, dpr = window.devicePixelRatio || 1, background } = {}) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: scale * dpr, rotation: 0 });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const task = page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false }), viewport: vp, background, annotationMode: renderOptions.annotationMode });
  return task;
}

/** Render a page to a new canvas at a given pixel width (thumbnails, AI pictures, exports). */
export async function pageToCanvas(pdf, index, { width = 300, scale } = {}) {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const s = scale || width / base.width;
  const canvas = document.createElement("canvas");
  const vp = page.getViewport({ scale: s, rotation: 0 });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  return canvas;
}

const FAMILY = (style, fontName, font) => {
  const f = `${style?.fontFamily || ""} ${fontName || ""} ${font?.name || ""}`.toLowerCase();
  if (font?.isMonospace || /mono|courier|consol/.test(f)) return "mono";
  if (/serif|times|georgia|garamond|minion|cambria|book|merriweather|lora|playfair|baskerville/.test(f) && !/sans/.test(f)) return "serif";
  if (font?.isSerifFont && !/sans|inter|arial|helvetica|roboto|calibri|segoe/.test(f)) return "serif";
  return "sans";
};

/**
 * pdf.js names a run's font by an internal id; the loaded font (with its real name and bold/italic
 * flags) appears in page.commonObjs once the page's operators have been read.
 */
async function loadedFonts(page, ids) {
  const out = new Map();
  const look = () => {
    for (const id of ids) {
      if (out.has(id) || !page.commonObjs.has(id)) continue;
      try { out.set(id, page.commonObjs.get(id)); } catch { /* not ready */ }
    }
  };
  look();
  if (out.size < ids.size) { try { await page.getOperatorList(); look(); } catch { /* fall back to names */ } }
  return out;
}

/**
 * The text on a page as runs with boxes in OUR page space (top-left, y down, points).
 * @returns {Promise<Array<{ str, x, y, w, h, size, family, bold, italic, dir }>>}
 */
export async function pageText(pdf, index) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const tc = await page.getTextContent({ includeMarkedContent: false });
  const out = [];
  const fonts = await loadedFonts(page, new Set(tc.items.map((it) => it.fontName).filter(Boolean)));
  for (const it of tc.items) {
    if (!("str" in it) || !it.str) continue;
    const tx = pdfjs.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]) || Math.abs(it.height) || 10;
    const style = tc.styles[it.fontName];
    const ascent = style?.ascent ?? 0.8;
    const x = tx[4];
    const y = tx[5] - size * ascent; // top of the glyph box
    const font = fonts.get(it.fontName);
    const name = `${it.fontName || ""} ${style?.fontFamily || ""} ${font?.name || ""}`;
    out.push({
      str: it.str, x, y, w: it.width * (vp.scale || 1), h: size, size,
      family: FAMILY(style, it.fontName, font),
      bold: Boolean(font?.bold || font?.black) || /bold|black|heavy|semibold/i.test(name),
      italic: Boolean(font?.italic) || /italic|oblique/i.test(name),
      dir: it.dir, eol: !!it.hasEOL,
    });
  }
  return out;
}

/** Plain text of a page, in reading order (lines joined by newlines). */
export async function pagePlainText(pdf, index) {
  const page = await pdf.getPage(index + 1);
  const tc = await page.getTextContent();
  return tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : "")).join("").replace(/[ \t]+\n/g, "\n").trim();
}
