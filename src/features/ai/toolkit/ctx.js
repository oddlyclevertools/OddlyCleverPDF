// Shared helpers for the PDF tools: finding pages, changing the document the undoable way,
// sampling the paper and ink colour, and keeping answers short.
import { parsePages, r1 } from "../textmatch.js";

/** While the AI runs, the controller opens ONE undo step; tools then change state directly. */
export const run = { active: false, snapshot: null };

export const clip = (s, n = 14000) => (s.length > n ? `${s.slice(0, n)}\n…(cut to ${n} characters; ask for fewer pages)` : s);
export const shorten = (s, n = 40) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

export function pageAt(app, n) {
  const p = app.state.pages[n - 1];
  if (!p) throw new Error(`Page ${n} doesn't exist. This document has ${app.state.pages.length} page${app.state.pages.length === 1 ? "" : "s"}.`);
  return p;
}

export function needDoc(app) {
  if (!app.state.pages.length) throw new Error("No PDF is open.");
}

/** 1-based page numbers from a spec such as "1-3, 5", "all" or "current". */
export function pagesFrom(app, spec) {
  needDoc(app);
  return parsePages(spec, app.state.pages.length, (app.currentPageIndex?.() ?? 0) + 1);
}

/** Change the document. Inside an AI run it is part of the run's single undo step. */
export function mutate(app, label, fn, pages = "all") {
  if (run.active) {
    fn();
    app.state.dirty = true;
    app.store.emit("change", { label: `AI: ${label}`, pages });
    return true;
  }
  return app.store.change(`AI: ${label}`, fn, { pages });
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Keep a box inside the page. Returns the box and whether anything moved. */
export function fitBox(page, b, { minW = 4, minH = 4 } = {}) {
  const w = clamp(b.w, minW, page.w), h = clamp(b.h, minH, page.h);
  const x = clamp(b.x, 0, page.w - w), y = clamp(b.y, 0, page.h - h);
  const moved = Math.abs(x - b.x) > 0.5 || Math.abs(y - b.y) > 0.5 || Math.abs(w - b.w) > 0.5 || Math.abs(h - b.h) > 0.5;
  return { x: r1(x), y: r1(y), w: r1(w), h: r1(h), moved };
}

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const color = (c, fallback) => (typeof c === "string" && HEX.test(c) ? c.toLowerCase() : fallback);

// ---- colours of the paper under some words ----------------------------------------------------

const canvases = new Map(); // "fileId:index" -> canvas (original page, no edits), cleared by newRun()
export function newRun() { canvases.clear(); }

async function sourceCanvas(app, page) {
  const key = `${page.src.fileId}:${page.src.index}`;
  if (!canvases.has(key)) {
    const f = app.state.files.get(page.src.fileId);
    canvases.set(key, app.pdf.pageToCanvas(f.pdf, page.src.index, { width: 900 }).catch(() => null));
  }
  return canvases.get(key);
}

/** The most common light colour (the paper) and the strongest far-from-paper colour (the ink). */
export async function sampleColors(app, page, box) {
  const fallback = { bg: "#ffffff", ink: "#111111" };
  const c = await sourceCanvas(app, page);
  if (!c) return fallback;
  const sx = c.width / page.w, sy = c.height / page.h;
  const x = Math.max(0, Math.floor(box.x * sx)), y = Math.max(0, Math.floor(box.y * sy));
  const w = Math.max(1, Math.min(c.width - x, Math.ceil(box.w * sx))), h = Math.max(1, Math.min(c.height - y, Math.ceil(box.h * sy)));
  let data;
  try { data = c.getContext("2d", { willReadFrequently: true }).getImageData(x, y, w, h).data; } catch { return fallback; }
  const counts = new Map();
  for (let i = 0; i < data.length; i += 16) {
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = 0, bk = 0xfff;
  for (const [k, n] of counts) if (n > best) { best = n; bk = k; }
  const bg = [((bk >> 8) & 15) * 17, ((bk >> 4) & 15) * 17, (bk & 15) * 17];
  let far = 0, ink = [17, 17, 17];
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > far) { far = d; ink = [data[i], data[i + 1], data[i + 2]]; }
  }
  const hex = (a) => `#${a.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return { bg: hex(bg), ink: far > 90 ? hex(ink) : "#111111" };
}

/** Lines that share a long word with the quote: helps the AI fix a quote that didn't match. */
export function nearLines(lines, quote) {
  const words = String(quote || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const hits = lines.filter((l) => words.some((w) => l.text.toLowerCase().includes(w))).slice(0, 3);
  return hits.length ? ` Lines with similar words: ${hits.map((l) => `“${shorten(l.text, 70)}”`).join("; ")}.` : "";
}
