// Reading the finished document for conversion: text lines, picture positions, page renders.
import { groupLines } from "../../core/text.js";

export const abortIf = (signal) => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };

/** Which page numbers (0-based) to convert, from ctx.pages / ctx.pageIds / "all". */
export function pickPages(app, ctx, total) {
  if (Array.isArray(ctx?.pages) && ctx.pages.length) return [...new Set(ctx.pages)].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  if (Array.isArray(ctx?.pageIds) && ctx.pageIds.length) {
    const idx = app.state.pages.map((p, i) => (ctx.pageIds.includes(p.id) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) return idx;
  }
  return Array.from({ length: total }, (_, i) => i);
}

/** "1-3, 5" -> [0,1,2,4]. Returns null when the text isn't a valid range. */
export function parseRange(text, total) {
  const out = new Set();
  for (const part of String(text).split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > total) return null;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

export function canvasBytes(canvas, type = "image/png", q = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error("Couldn't make the picture."))), type, q));
}

/** Render a page; the pixel count is capped so a 300 dpi poster doesn't run out of memory. */
export async function renderPage(app, pdf, index, dpi = 150) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const scale = Math.min(dpi / 72, Math.sqrt(40e6 / (vp.width * vp.height)));
  return app.pdf.pageToCanvas(pdf, index, { scale });
}

export async function pageSize(pdf, index) {
  const vp = (await pdf.getPage(index + 1)).getViewport({ scale: 1, rotation: 0 });
  return { w: vp.width, h: vp.height };
}

/** Text lines for pages, with sizes. [{ index, w, h, lines }] */
export async function loadText(app, pdf, indexes, { signal, progress } = {}) {
  const out = [];
  for (const [k, i] of indexes.entries()) {
    abortIf(signal);
    progress?.(k / indexes.length, `Reading page ${i + 1}`);
    const { w, h } = await pageSize(pdf, i);
    const runs = await app.pdf.pageText(pdf, i);
    out.push({ index: i, w, h, lines: groupLines(runs) });
  }
  return out;
}

/** Rectangles (page space) where pictures are painted on a page. */
export async function pictureRects(app, pdf, index) {
  const { pdfjs } = app.pdf;
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const { OPS, Util } = pdfjs;
  const list = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const rects = [];
  for (let k = 0; k < list.fnArray.length; k++) {
    const fn = list.fnArray[k], a = list.argsArray[k];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = Util.transform(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const m = Util.transform(vp.transform, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      if (x1 - x0 >= 24 && y1 - y0 >= 24 && fn !== OPS.paintImageMaskXObject) rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  // drop duplicates
  return rects.filter((r, i) => !rects.slice(0, i).some((q) => Math.abs(q.x - r.x) < 2 && Math.abs(q.y - r.y) < 2 && Math.abs(q.w - r.w) < 2 && Math.abs(q.h - r.h) < 2));
}

/** Crop the pictures on a page out of a render. [{ x, y, w, h, data, mime }] */
export async function cropPictures(app, pdf, index, { dpi = 150 } = {}) {
  let rects = [];
  try { rects = await pictureRects(app, pdf, index); } catch (e) { console.warn("[convert] pictures", e); }
  if (!rects.length) return [];
  const canvas = await renderPage(app, pdf, index, dpi);
  const { w: pw } = await pageSize(pdf, index);
  const k = canvas.width / pw;
  const out = [];
  for (const r of rects.slice(0, 40)) {
    const sx = Math.max(0, Math.floor(r.x * k)), sy = Math.max(0, Math.floor(r.y * k));
    const sw = Math.min(canvas.width - sx, Math.ceil(r.w * k)), sh = Math.min(canvas.height - sy, Math.ceil(r.h * k));
    if (sw < 8 || sh < 8) continue;
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    c.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h, mime: "image/png", data: await canvasBytes(c, "image/png") });
  }
  return out;
}

/** Everything the analysers need: lines + cropped pictures per page. */
export async function loadPages(app, pdf, indexes, { pictures = true, signal, progress } = {}) {
  const pages = await loadText(app, pdf, indexes, { signal, progress: (f, l) => progress?.(f * 0.5, l) });
  for (const [k, p] of pages.entries()) {
    abortIf(signal);
    progress?.(0.5 + (k / pages.length) * 0.4, `Looking for pictures on page ${p.index + 1}`);
    p.images = pictures ? await cropPictures(app, pdf, p.index) : [];
  }
  return pages;
}
