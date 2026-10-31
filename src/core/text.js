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
  for (const b of out) b.text = joinRuns(b.runs);
  return out;
}

export function clearTextCache() { cache.clear(); }
