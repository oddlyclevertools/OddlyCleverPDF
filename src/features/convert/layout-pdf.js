// A small document layout engine: blocks (see ir.js) -> a PDF with real, selectable text.
// pdf-lib + fontkit with whole (not subset) fonts, because subsetting crashes at save.
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const A4 = { w: 595.28, h: 841.89 };
const HEAD_SCALE = [1, 2.0, 1.6, 1.3, 1.15, 1.05, 1];
const LINK = rgb(0.1, 0.25, 0.8);
const INK = rgb(0.09, 0.07, 0.11);
const GRID = rgb(0.55, 0.55, 0.58);
const HEADBG = rgb(0.95, 0.93, 0.9);

const faceKey = (code, b, i) => (code ? (b ? "mb" : "m") : `s${b ? "b" : ""}${i ? "i" : ""}`);
const FACES = { s: ["sans", false, false], sb: ["sans", true, false], si: ["sans", false, true], sbi: ["sans", true, true], m: ["mono", false, false], mb: ["mono", true, false] };

function neededFaces(blocks) {
  const need = new Set(["s"]);
  const runs = (rs) => { for (const r of rs || []) need.add(faceKey(r.code, r.b, r.i)); };
  for (const b of blocks) {
    if (b.type === "heading") need.add("sb");
    if (b.type === "code") need.add("m");
    if (b.runs) runs(b.runs);
    if (b.items) b.items.forEach(runs);
    if (b.rows) { if (b.header) need.add("sb"); b.rows.forEach((r) => r.forEach((c) => runs(c))); }
  }
  return need;
}

/**
 * @param {Array} blocks
 * @param {{ loadFont: (family, bold, italic) => Promise<ArrayBuffer|Uint8Array>, page?: {w,h}, margin?: number,
 *           size?: number, rasterize?: (img) => Promise<Uint8Array|null>, title?: string, mono?: boolean }} o
 * @returns {Promise<{ bytes: Uint8Array, skipped: number, notes: string[] }>}
 */
export async function blocksToPdf(blocks, o = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (o.title) doc.setTitle(o.title);
  doc.setCreator("OddlyClever PDF");
  let W = o.page?.w || A4.w, H = o.page?.h || A4.h;
  const margin = o.margin ?? 56;
  const base = o.size ?? 11;
  const notes = [];
  let skipped = 0;

  const fonts = {};
  for (const k of neededFaces(blocks)) {
    const [fam, b, i] = FACES[k];
    const f = await doc.embedFont(await o.loadFont(fam, b, i), { subset: false });
    fonts[k] = { f, set: new Set(f.getCharacterSet()) };
  }
  const fontOf = (code, b, i) => fonts[faceKey(code, b, i)] || fonts[faceKey(code, b, false)] || fonts[faceKey(code, false, false)] || fonts.s;

  /** Make text drawable: swap look-alikes, drop what the font has no shape for. */
  const clean = (text, fo) => {
    let out = "";
    for (const ch of String(text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
      const cp = ch.codePointAt(0);
      if (ch === "\n") { out += ch; continue; }
      if (cp === 0xa0 || cp === 0x2009 || cp === 0x202f || cp === 0x2002 || cp === 0x2003) { out += " "; continue; }
      if (cp < 32 || cp === 0x200b || cp === 0xfeff || (cp >= 0x200c && cp <= 0x200f)) continue;
      if (fo.set.has(cp)) { out += ch; continue; }
      const alt = { 0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"', 0x2013: "-", 0x2014: "-", 0x2022: "*", 0x2026: "..." }[cp];
      if (alt && [...alt].every((c) => fo.set.has(c.codePointAt(0)))) { out += alt; continue; }
      skipped++;
    }
    return out;
  };

  let page = null, y = 0;
  const newPage = () => { page = doc.addPage([W, H]); y = margin; };
  const ensure = (h) => { if (!page) newPage(); else if (y + h > H - margin && y > margin + 1) newPage(); };
  const textW = () => W - 2 * margin;

  /** Break runs into drawable lines no wider than `width`. */
  function makeLines(runs, width, size, { bold = false, color = INK } = {}) {
    const toks = [];
    for (const r of runs) {
      const fo = fontOf(r.code, r.b || bold, r.i);
      const text = clean(r.t, fo);
      for (const part of text.split(/(\n| +)/)) {
        if (part === "") continue;
        const style = { fo, color: r.href ? LINK : r.color || color, href: r.href };
        if (part === "\n") toks.push({ br: true });
        else if (part[0] === " ") toks.push({ sp: true, text: " ", width: fo.f.widthOfTextAtSize(" ", size), ...style });
        else toks.push({ text: part, width: fo.f.widthOfTextAtSize(part, size), ...style });
      }
    }
    const lines = [];
    let cur = { items: [], w: 0 };
    const push = () => { while (cur.items.length && cur.items[cur.items.length - 1].sp) cur.w -= cur.items.pop().width; lines.push(cur); cur = { items: [], w: 0 }; };
    for (const t of toks) {
      if (t.br) { push(); continue; }
      if (t.sp) { if (cur.items.length) { cur.items.push(t); cur.w += t.width; } continue; }
      if (cur.w + t.width > width + 0.01 && cur.items.length) push();
      if (t.width > width) { // a word wider than the line: cut it by letters
        let piece = "";
        for (const ch of t.text) {
          const w2 = t.fo.f.widthOfTextAtSize(piece + ch, size);
          if (w2 > width && piece) { cur.items.push({ ...t, text: piece, width: t.fo.f.widthOfTextAtSize(piece, size) }); cur.w += t.fo.f.widthOfTextAtSize(piece, size); push(); piece = ch; } else piece += ch;
        }
        if (piece) { const pw = t.fo.f.widthOfTextAtSize(piece, size); cur.items.push({ ...t, text: piece, width: pw }); cur.w += pw; }
        continue;
      }
      cur.items.push(t); cur.w += t.width;
    }
    if (cur.items.length || !lines.length) push();
    return lines;
  }

  /** Draw one line of items with its top at `top`. */
  function drawLine(line, x, top, size, lh, { align = "left", width = textW() } = {}) {
    let cx = x + (align === "center" ? (width - line.w) / 2 : align === "right" ? width - line.w : 0);
    const base = H - (top + (lh - size) / 2 + size * 0.82);
    let i = 0;
    while (i < line.items.length) { // merge neighbours with the same look into one draw call
      const a = line.items[i];
      let text = a.text, w = a.width, j = i + 1;
      while (j < line.items.length && line.items[j].fo === a.fo && line.items[j].color === a.color && line.items[j].href === a.href) { text += line.items[j].text; w += line.items[j].width; j++; }
      if (text.trim()) page.drawText(text, { x: cx, y: base, size, font: a.fo.f, color: a.color });
      if (a.href && text.trim()) page.drawLine({ start: { x: cx, y: base - 1.5 }, end: { x: cx + w, y: base - 1.5 }, thickness: 0.6, color: a.color });
      cx += w; i = j;
    }
  }

  function flow(runs, { x = margin, width = textW(), size = base, lhK = 1.38, align, bold, gapBefore = 0, gapAfter = size * 0.55, hang = 0, marker, keep = 0 }) {
    const lines = makeLines(runs, width - hang, size, { bold });
    const lh = size * lhK;
    ensure(gapBefore + lh * Math.min(lines.length, 2) + keep);
    if (y > margin + 0.5) y += gapBefore;
    lines.forEach((ln, idx) => {
      ensure(lh);
      if (idx === 0 && marker) {
        const mf = fontOf(false, false, false);
        const m = clean(marker, mf);
        page.drawText(m, { x: x + hang - mf.f.widthOfTextAtSize(m + " ", size), y: H - (y + (lh - size) / 2 + size * 0.82), size, font: mf.f, color: INK });
      }
      drawLine(ln, x + hang, y, size, lh, { align, width: width - hang });
      y += lh;
    });
    y += gapAfter;
  }

  function drawTable(b) {
    const size = base * 0.92, pad = 4, lh = size * 1.3;
    const cols = Math.max(...b.rows.map((r) => r.length), 1);
    const maxW = Array(cols).fill(12), minW = Array(cols).fill(12);
    for (const [ri, r] of b.rows.entries()) {
      for (let c = 0; c < cols; c++) {
        const runs = r[c] || [];
        const bold = ri === 0 && b.header;
        const lines = makeLines(runs, 1e6, size, { bold });
        maxW[c] = Math.max(maxW[c], (lines[0] ? Math.max(...lines.map((l) => l.w)) : 0) + 2 * pad);
        const words = makeLines(runs, 1, size, { bold });
        minW[c] = Math.max(minW[c], Math.max(0, ...words.map((l) => l.w)) + 2 * pad);
      }
    }
    const avail = textW();
    let widths;
    const sumMax = maxW.reduce((a, c) => a + c, 0), sumMin = minW.reduce((a, c) => a + c, 0);
    if (sumMax <= avail) { const k = sumMax < avail * 0.7 ? 1 : avail / sumMax; widths = maxW.map((w) => w * k); }
    else if (sumMin >= avail) widths = minW.map((w) => (w * avail) / sumMin);
    else { const extra = avail - sumMin, want = sumMax - sumMin; widths = minW.map((w, c) => w + ((maxW[c] - minW[c]) / want) * extra); }
    const rowsLaid = b.rows.map((r, ri) => {
      const cells = Array.from({ length: cols }, (_, c) => makeLines(r[c] || [], widths[c] - 2 * pad, size, { bold: ri === 0 && b.header }));
      return { cells, h: Math.max(...cells.map((l) => l.length)) * lh + 2 * pad };
    });
    if (y > margin + 0.5) y += base * 0.3;
    const drawRow = (row, isHead) => {
      ensure(row.h);
      let cx = margin;
      row.cells.forEach((lines, c) => {
        page.drawRectangle({ x: cx, y: H - (y + row.h), width: widths[c], height: row.h, borderColor: GRID, borderWidth: 0.5, color: isHead ? HEADBG : undefined });
        lines.forEach((ln, li) => drawLine(ln, cx + pad, y + pad + li * lh, size, lh, { width: widths[c] - 2 * pad }));
        cx += widths[c];
      });
      y += row.h;
    };
    rowsLaid.forEach((row, ri) => {
      const before = doc.getPageCount();
      if (page && y + row.h > H - margin && y > margin + 1) { newPage(); if (ri > 0 && b.header) drawRow(rowsLaid[0], true); }
      drawRow(row, ri === 0 && !!b.header);
      void before;
    });
    y += base * 0.8;
  }

  async function drawImage(b) {
    let data = b.data, mime = b.mime;
    if (mime !== "image/png" && mime !== "image/jpeg") {
      data = o.rasterize ? await o.rasterize(b).catch(() => null) : null;
      mime = "image/png";
      if (!data) { notes.push("A picture was in a format I couldn't place, so I left it out."); return; }
    }
    let img;
    try { img = mime === "image/jpeg" ? await doc.embedJpg(data) : await doc.embedPng(data); } catch { notes.push("A picture couldn't be read, so I left it out."); return; }
    const maxW = textW(), maxH = H - 2 * margin;
    let w = b.w || img.width * 0.75, h = b.h || img.height * 0.75;
    const k = Math.min(1, maxW / w, maxH / h);
    w *= k; h *= k;
    ensure(h);
    page.drawImage(img, { x: margin, y: H - y - h, width: w, height: h });
    y += h + base * 0.7;
  }

  for (const b of blocks) {
    if (b.type === "heading") {
      const size = base * HEAD_SCALE[Math.min(6, b.level)];
      flow(b.runs, { size, bold: true, lhK: 1.25, gapBefore: size * 0.7, gapAfter: size * 0.35, align: b.align, keep: base * 2.8 });
    } else if (b.type === "p") flow(b.runs, { align: b.align });
    else if (b.type === "list") {
      const ind = 18 * ((b.level || 0) + 1) + 4;
      b.items.forEach((it, n) => flow(it, { x: margin, hang: ind, size: base, gapAfter: base * 0.25, marker: b.ordered ? `${(b.start || 1) + n}.` : "•" }));
      y += base * 0.35;
    } else if (b.type === "table") drawTable(b);
    else if (b.type === "image") await drawImage(b);
    else if (b.type === "code") {
      const size = base * 0.85;
      for (const line of String(b.text).replace(/\r\n?/g, "\n").split("\n")) {
        flow([{ t: line === "" ? " " : line, code: true }], { size, lhK: 1.3, gapAfter: 0 });
      }
      y += base * 0.6;
    } else if (b.type === "hr") {
      ensure(base);
      page.drawLine({ start: { x: margin, y: H - y - 4 }, end: { x: W - margin, y: H - y - 4 }, thickness: 0.7, color: GRID });
      y += base * 1.2;
    } else if (b.type === "pagebreak") {
      if (b.w && b.h) { W = b.w; H = b.h; }
      if (page && (y > margin + 1 || b.w)) page = null;
    }
  }
  if (!doc.getPageCount()) newPage();
  if (skipped) notes.push(`I left out ${skipped} character${skipped === 1 ? "" : "s"} the built-in fonts can't draw (emoji or other alphabets).`);
  return { bytes: await doc.save(), skipped, notes };
}
