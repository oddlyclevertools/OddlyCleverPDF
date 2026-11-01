// The PDF's own text per page, grouped into lines, cached. Used by Edit text, Highlight, search
// and the AI. Positions are in page space.
import { state, pageById } from "./store.js";
import { pageText, pagePlainText } from "./pdf.js";

const cache = new Map(); // "fileId:index" -> Promise<lines>

/** Runs on a page, grouped into lines (left to right), top to bottom. */
export function pageLines(pageId) {
  const p = pageById(pageId);
  if (!p) return Promise.resolve([]);
  const key = `${p.src.fileId}:${p.src.index}`;
  if (!cache.has(key)) {
    const f = state.files.get(p.src.fileId);
    cache.set(key, pageText(f.pdf, p.src.index).then(groupLines).catch((e) => { console.error("[text]", e); return []; }));
  }
  return cache.get(key);
}

/** Plain text of a page (for the AI, search and exports). */
export async function pageString(pageId) {
  const p = pageById(pageId);
  if (!p) return "";
  return pagePlainText(state.files.get(p.src.fileId).pdf, p.src.index);
}

export function groupLines(runs) {
  const rs = runs.filter((r) => r.str.trim() || r.str === " ").sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const lines = [];
  for (const r of rs) {
    const cy = r.y + r.h / 2;
    let line = lines.find((l) => Math.abs(l.cy - cy) < Math.max(l.h, r.h) * 0.45 && Math.abs(l.size - r.size) < Math.max(l.size, r.size) * 0.35);
    if (!line) { line = { runs: [], cy, h: r.h, size: r.size }; lines.push(line); }
    line.runs.push(r);
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    l.x = Math.min(...l.runs.map((r) => r.x));
    l.y = Math.min(...l.runs.map((r) => r.y));
    l.w = Math.max(...l.runs.map((r) => r.x + r.w)) - l.x;
    l.h = Math.max(...l.runs.map((r) => r.y + r.h)) - l.y;
    l.text = joinRuns(l.runs);
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Join runs with a space where there's a visible gap. */
export function joinRuns(runs) {
  let out = "", prevEnd = null;
  for (const r of runs) {
    if (prevEnd != null && r.x - prevEnd > r.size * 0.18 && !out.endsWith(" ") && !r.str.startsWith(" ")) out += " ";
    out += r.str;
    prevEnd = r.x + r.w;
  }
  return out;
}

/**
 * Split a line into "blocks" of runs with no big gaps (a table cell, a column), so Edit text
 * picks just the phrase you pressed, not a whole row of a table.
 */
export function blocksOf(line) {
  const out = [];
  let cur = null;
  for (const r of line.runs) {
    // pdf.js fills a column gap with a wide " " run; that's a break between cells, not a word space
    if (!r.str.trim() && r.w > r.size * 1.6) { cur = null; continue; }
    if (cur && r.x - (cur.x + cur.w) < r.size * 1.6) {
      cur.runs.push(r);
      cur.w = Math.max(cur.x + cur.w, r.x + r.w) - cur.x;
      cur.y = Math.min(cur.y, r.y);
      cur.h = Math.max(cur.h, r.y + r.h - cur.y);
    } else {
      cur = { runs: [r], x: r.x, y: r.y, w: r.w, h: r.h, size: r.size };
      out.push(cur);
    }
  }
  for (const b of out) {
    // trailing or leading spaces don't belong to the phrase
    while (b.runs.length > 1 && !b.runs.at(-1).str.trim()) b.runs.pop();
    while (b.runs.length > 1 && !b.runs[0].str.trim()) b.runs.shift();
    b.x = Math.min(...b.runs.map((r) => r.x));
    b.w = Math.max(...b.runs.map((r) => r.x + r.w)) - b.x;
    b.text = joinRuns(b.runs);
  }
  return out.filter((b) => b.text.trim());
}

export function clearTextCache() { cache.clear(); }

/**
 * Typical stroke thickness (pixels) of the ink in an RGBA strip: the median width of the dark runs
 * across each row, counting faint edge pixels in part. Edit text uses it to guess bold when the
 * PDF's font can't say (Type3 fonts from Figma).
 */
export function stemWidth(data, w, h, bg) {
  const dist = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
  let far = 0;
  for (let i = 0; i < data.length; i += 4) far = Math.max(far, dist(i));
  if (far < 90) return 0;
  const widths = [];
  for (let y = 0; y < h; y++) {
    let run = 0, solid = false;
    for (let x = 0; x <= w; x++) {
      const c = x < w ? Math.min(1, dist((y * w + x) * 4) / far) : 0;
      if (c > 0.15) { run += c; solid ||= c > 0.5; continue; }
      if (solid) widths.push(run);
      run = 0; solid = false;
    }
  }
  widths.sort((a, b) => a - b);
  return widths.length ? widths[widths.length >> 1] : 0;
}

// ---- where each letter sits ---------------------------------------------------------------------

const MEASURE_FONT = { sans: "Helvetica, Arial, sans-serif", serif: "'Times New Roman', Times, serif", mono: "'Courier New', monospace" };
let measurer = null;

/**
 * The x (page space) where character k of a run starts. pdf.js only gives a run's total width, so
 * the letters are measured in a similar font and scaled to fit (much closer than equal widths,
 * which drift on proportional fonts). Without a canvas (tests) it falls back to equal widths.
 */
export function charX(r, k) {
  const n = r.str.length;
  if (k <= 0) return r.x;
  if (k >= n) return r.x + r.w;
  if (!r._edges) {
    try {
      measurer ||= (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(8, 8) : document.createElement("canvas")).getContext("2d");
      measurer.font = `${r.italic ? "italic " : ""}${r.bold ? "700 " : ""}100px ${MEASURE_FONT[r.family] || MEASURE_FONT.sans}`;
      const edges = [0];
      for (let i = 1; i <= n; i++) edges.push(measurer.measureText(r.str.slice(0, i)).width);
      const k2 = r.w / (edges[n] || 1);
      r._edges = edges.map((e) => e * k2);
    } catch {
      r._edges = Array.from({ length: n + 1 }, (_, i) => (r.w * i) / n);
    }
  }
  return r.x + r._edges[k];
}

/** The character index in a run nearest to page x (for taps). */
export function charAt(r, x) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < r.str.length; k++) {
    const mid = (charX(r, k) + charX(r, k + 1)) / 2;
    const d = Math.abs(mid - x);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
