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

/** A block made of some runs of a line (box and text). */
export function spanOf(runs) {
  const x = Math.min(...runs.map((r) => r.x)), y = Math.min(...runs.map((r) => r.y));
  return {
    runs, x, y, size: runs[0].size, text: joinRuns(runs),
    w: Math.max(...runs.map((r) => r.x + r.w)) - x, h: Math.max(...runs.map((r) => r.y + r.h)) - y,
  };
}

export function clearTextCache() { cache.clear(); }

// ---- finding text near a tap (Edit text) --------------------------------------------------------

/**
 * The phrase under a tap, or else the nearest one on the same row when the tap is close: a gap
 * between words or columns, a little past a line's end, just above or below a line. `hit` says
 * the tap was on the words themselves. Null when nothing is near.
 */
export function blockNear(lines, pt) {
  let best = null, bd = Infinity;
  for (const line of lines) for (const block of blocksOf(line)) {
    const s = block.size;
    const dx = Math.max(0, block.x - pt.x, pt.x - block.x - block.w) / s;
    const dy = Math.max(0, block.y - pt.y, pt.y - block.y - block.h) / s;
    if (dx > 4 || dy > 0.5) continue;
    const d = dx + dy * 4; // another row is much further away than the same row
    if (d < bd) { bd = d; best = { line, block, hit: dx <= 0.25 && dy <= 0.25 }; }
  }
  return best;
}

const styleOf = (b) => { const r = b.runs[0]; return `${r.family}|${r.bold}|${r.italic}|${r.type3}`; };

/** Width of a block's first word. */
function firstWordW(b) {
  const r = b.runs.find((r) => r.str.trim());
  const m = /^\s*\S+/.exec(r.str);
  return charX(r, m[0].length) - charX(r, 0);
}

/**
 * The lines of the paragraph a block sits in, top to bottom (just [block] when it's alone).
 * A line joins when it has the same style, size and left edge, even spacing, and the line above
 * really wrapped (the next first word would not have fit). Table cells and short rows stay apart.
 */
export function paragraphOf(lines, block) {
  const s = block.size, key = styleOf(block), para = [block];
  const right = (bs) => Math.max(...bs.map((b) => b.x + b.w));
  // the phrase in this column on the next line up (dir -1) or down (+1), if it is one of ours
  const next = (from, dir) => {
    const x1 = right(para);
    const below = lines.filter((l) => dir * (l.y - from.y) > s * 0.5).sort((a, b) => dir * (a.y - b.y));
    for (const l of below) {
      const c = blocksOf(l).find((c) => c.x < x1 && c.x + c.w > block.x);
      if (!c) continue;
      const same = styleOf(c) === key && Math.abs(c.size - s) < s * 0.05 && Math.abs(c.x - block.x) < s * 0.5;
      return same && Math.abs(c.y - from.y) < s * 2.2 ? c : null;
    }
    return null;
  };
  let lead = 0;
  for (const dir of [1, -1]) {
    for (;;) {
      const edge = dir > 0 ? para.at(-1) : para[0];
      const c = next(edge, dir);
      if (!c) break;
      const gap = Math.abs(c.y - edge.y);
      if (lead && Math.abs(gap - lead) > lead * 0.15) break;
      const r = right([...para, c]);
      if (r - block.x < s * 20) break; // too narrow to be wrapping prose (a table column)
      const [a, b] = dir > 0 ? [edge, c] : [c, edge];
      // the line above ended early, or with a real line break (Figma keeps the "\n"): a new paragraph
      if (/\n\s*$/.test(a.text) || a.x + a.w + s * 0.3 + firstWordW(b) < r - s * 0.1) break;
      lead ||= gap;
      if (dir > 0) para.push(c); else para.unshift(c);
    }
  }
  return para;
}

/**
 * Where the caret goes for a tap at (x, y): `rects` are the screen boxes of each letter in order.
 * It picks the nearest row, then the nearest letter edge on it (past a line's end = end of line).
 */
export function caretIndexAt(rects, x, y) {
  if (!rects.length) return 0;
  const dy = (r) => Math.max(0, r.top - y, y - r.bottom);
  const row = Math.min(...rects.map(dy));
  let k = 0, bd = Infinity;
  rects.forEach((r, i) => {
    if (dy(r) > row + 0.5) return;
    const before = x < (r.left + r.right) / 2, d = Math.abs(x - (before ? r.left : r.right));
    if (d < bd) { bd = d; k = before ? i : i + 1; }
  });
  return k;
}

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
