// OCR: the pure parts. Turn tesseract's result into word boxes in page points, and write them
// into a PDF page as an invisible text layer (so Find, Copy and Edit text see the scan's words).
import { StandardFonts } from "@cantoo/pdf-lib";

/** The common languages in the picker (tesseract codes). */
export const LANGS = [
  ["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"],
  ["nld", "Dutch"], ["pol", "Polish"], ["tur", "Turkish"], ["rus", "Russian"], ["ukr", "Ukrainian"], ["ara", "Arabic"],
  ["hin", "Hindi"], ["jpn", "Japanese"], ["chi_sim", "Chinese (simple)"], ["kor", "Korean"],
];

/**
 * Words from a tesseract result (v6/7 nests them in blocks; older ones have data.words).
 * `scale` is canvas pixels per point. Returns words in page space with a line number.
 * @returns {Array<{ t: string, x: number, y: number, w: number, h: number, line: number, conf: number }>}
 */
export function wordsFromResult(data, scale = 1) {
  const out = [];
  const add = (w, line) => {
    const t = String(w?.text ?? "").trim();
    const b = w?.bbox;
    if (!t || !b) return;
    out.push({ t, x: b.x0 / scale, y: b.y0 / scale, w: (b.x1 - b.x0) / scale, h: (b.y1 - b.y0) / scale, line, conf: w.confidence ?? 100 });
  };
  let line = 0;
  if (Array.isArray(data?.blocks) && data.blocks.length) {
    for (const bl of data.blocks) for (const pa of bl.paragraphs || []) for (const ln of pa.lines || []) { for (const w of ln.words || []) add(w, line); line++; }
  } else if (Array.isArray(data?.lines) && data.lines.length) {
    for (const ln of data.lines) { for (const w of ln.words || []) add(w, line); line++; }
  } else for (const w of data?.words || []) add(w, 0);
  return out.filter((w) => w.w > 0 && w.h > 0);
}

/** The words as plain text, a line per line. */
export function wordsToText(words) {
  const lines = new Map();
  for (const w of words) lines.set(w.line, [...(lines.get(w.line) || []), w.t]);
  return [...lines.values()].map((l) => l.join(" ")).join("\n");
}

/** Helvetica when it can draw every letter, otherwise the app's own Unicode font (`unicodeFont()`). */
export async function chooseFont(doc, words, unicodeFont) {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const have = new Set(helv.getCharacterSet());
  const ok = words.every((w) => [...w.t].every((ch) => have.has(ch.codePointAt(0))));
  if (ok || !unicodeFont) return helv;
  try { return await unicodeFont(doc); } catch (e) { console.warn("[ocr] unicode font failed", e); return helv; }
}

/**
 * Draw words as invisible text on a pdf-lib page. `box` is the page's view box; words are in page
 * space (top-left origin). Each word is sized to fit its box; a space follows every word but the
 * last one on a line, so copied text keeps its spaces.
 * @returns {number} how many words were written
 */
export function writeTextLayer(pdfPage, box, words, font) {
  const have = new Set(font.getCharacterSet?.() || []);
  let n = 0;
  const last = new Map();
  words.forEach((w, i) => last.set(w.line, i));
  words.forEach((w, i) => {
    const clean = have.size ? [...w.t].filter((ch) => have.has(ch.codePointAt(0))).join("") : w.t;
    if (!clean) return;
    let size = Math.max(3, Math.min(w.h * 0.92, 96));
    const width = font.widthOfTextAtSize(clean, size);
    if (width > w.w && width > 0) size = Math.max(2, size * (w.w / width));
    const baseline = box[3] - (w.y + w.h * 0.8);
    pdfPage.drawText(last.get(w.line) === i ? clean : `${clean} `, { x: box[0] + w.x, y: baseline, size, font, opacity: 0 });
    n++;
  });
  return n;
}
