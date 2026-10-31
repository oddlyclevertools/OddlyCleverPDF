// Layout analysis: pdf.js lines (page space, points) -> paragraphs, headings, lists, tables, pictures.
// Pure functions, so they can be tested without a browser.
import { mergeRuns, runsText } from "./ir.js";

const BULLET = /^\s*([•·▪◦‣●○■□–—*-]|\d{1,3}[.)]|[a-zA-Z][.)]|\(\d{1,3}\))\s+(?=\S)/;
const SYMBOL = /^[•·▪◦‣●○■□–—*-]$/;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const r05 = (n) => Math.round(n * 2) / 2;

/** Cut runs whose text hides a column gap ("Item     Qty") into separate pieces. */
export function explodeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const s = r.str;
    if (!/\S(\s{2,}|\t)\S/.test(s)) { out.push({ ...r, brk: false }); continue; }
    const cw = r.w / Math.max(1, s.length);
    const re = /(\s{2,}|\t)/g;
    let last = 0, m, first = true;
    const push = (from, to) => {
      const piece = s.slice(from, to);
      if (!piece.trim()) return;
      const lead = piece.length - piece.trimStart().length;
      const txt = piece.trim();
      out.push({ ...r, str: txt, x: r.x + (from + lead) * cw, w: txt.length * cw, brk: !first });
      first = false;
    };
    while ((m = re.exec(s))) { push(last, m.index); last = m.index + m[0].length; }
    push(last, s.length);
  }
  return out;
}

/** The cells of a line: groups of runs with no big gap between them. */
export function cellsOf(line) {
  const runs = explodeRuns(line.runs.filter((r) => r.str.trim())).sort((a, b) => a.x - b.x);
  const cells = [];
  let cur = null;
  for (const r of runs) {
    const gap = cur ? r.x - cur.x1 : 0;
    if (cur && !r.brk && gap <= Math.max(r.size * 0.95, 5)) {
      if (gap > r.size * 0.18 && !cur.text.endsWith(" ") && !r.str.startsWith(" ")) { cur.text += " "; cur.runs.push({ ...r, str: " " }); }
      cur.runs.push(r); cur.text += r.str; cur.x1 = Math.max(cur.x1, r.x + r.w);
    } else {
      cur = { x: r.x, x1: r.x + r.w, text: r.str, runs: [r], size: r.size };
      cells.push(cur);
    }
  }
  return cells;
}

/** Find tables among a page's lines. Returns [{ y, bottom, x, x1, rows: [[runs]], lines: Set }]. */
export function findTables(lines) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = sorted.map((l) => ({ line: l, cells: cellsOf(l) }));
  const tables = [];
  let group = [];
  const flush = () => {
    if (group.length >= 2) { const t = buildTable(group); if (t) tables.push(t); }
    group = [];
  };
  for (const r of rows) {
    if (r.cells.length >= 2) {
      const prev = group[group.length - 1];
      if (prev && (r.line.y + r.line.h / 2) - (prev.line.y + prev.line.h / 2) > Math.max(prev.line.size, r.line.size) * 2.6) flush();
      group.push(r);
    } else flush();
  }
  flush();
  return tables;
}

function buildTable(group) {
  const size = median(group.map((g) => g.line.size)) || 10;
  const all = group.flatMap((g) => g.cells);
  const x0 = Math.min(...all.map((c) => c.x)), x1 = Math.max(...all.map((c) => c.x1));
  // Columns are runs of cells whose spans overlap, row after row. That keeps left-aligned words
  // and right-aligned money in their own columns even when headers and values differ in width.
  // Very wide cells (a title across the table) don't get to join two columns together.
  const pad = size * 0.25;
  const spans = all.filter((c) => c.x1 - c.x < (x1 - x0) * 0.45).map((c) => [c.x - pad, c.x1 + pad]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of spans) {
    const last = cols[cols.length - 1];
    if (last && a <= last.b) { last.b = Math.max(last.b, b); last.n++; } else cols.push({ a, b, n: 1 });
  }
  if (cols.length < 2) return null;
  if (cols.filter((c) => c.n >= 2).length < 2) return null; // two lines with a gap are not a table
  const colOf = (c) => {
    let bi = 0, best = -Infinity;
    cols.forEach((col, i) => {
      const overlap = Math.min(col.b, c.x1) - Math.max(col.a, c.x);
      const score = overlap > 0 ? overlap : -Math.min(Math.abs(col.a - c.x), Math.abs(col.b - c.x1));
      if (score > best) { best = score; bi = i; }
    });
    return bi;
  };
  const out = group.map((g) => {
    const row = Array.from({ length: cols.length }, () => []);
    for (const c of g.cells) {
      const i = colOf(c);
      if (row[i].length) row[i].push({ str: " ", size: c.size });
      row[i].push(...c.runs);
    }
    return row;
  });
  return {
    y: group[0].line.y, bottom: Math.max(...group.map((g) => g.line.y + g.line.h)),
    x: Math.min(...group.map((g) => g.line.x)), x1: Math.max(...group.map((g) => g.line.x + g.line.w)),
    rows: out, lines: new Set(group.map((g) => g.line)),
  };
}

const toRun = (r) => ({ t: r.str, b: !!r.bold, i: !!r.italic, sz: r05(r.size), fam: r.family });
const cellRuns = (runs) => mergeRuns(runs.filter((r) => r.str !== "").map(toRun));

function lineRuns(line) {
  const out = [];
  let prevEnd = null;
  for (const r of [...line.runs].sort((a, b) => a.x - b.x)) {
    if (prevEnd != null && r.x - prevEnd > r.size * 0.18 && !/\s$/.test(out[out.length - 1]?.t || "") && !/^\s/.test(r.str)) out.push({ ...toRun(r), t: " " });
    out.push(toRun(r));
    prevEnd = r.x + r.w;
  }
  return out;
}

function bodySizeOf(pages) {
  const w = new Map();
  for (const p of pages) for (const l of p.lines) for (const r of l.runs) { const k = r05(r.size); w.set(k, (w.get(k) || 0) + r.str.length); }
  let best = 11, n = 0;
  for (const [k, v] of w) if (v > n) { best = k; n = v; }
  return best;
}

/** One page -> blocks. ctx = { body } */
export function analyzePage(page, ctx = {}) {
  const body = ctx.body || bodySizeOf([page]);
  const lines = page.lines.filter((l) => l.runs.length);
  const tables = findTables(lines);
  const inTable = new Set(); for (const t of tables) for (const l of t.lines) inTable.add(l);
  const flow = lines.filter((l) => !inTable.has(l));
  const items = [
    ...flow.map((l) => ({ k: "line", y: l.y, line: l })),
    ...tables.map((t) => ({ k: "table", y: t.y, t })),
    ...(page.images || []).map((im) => ({ k: "image", y: im.y, im })),
  ].sort((a, b) => a.y - b.y);

  const leads = [];
  for (let i = 1; i < flow.length; i++) if (Math.abs(flow[i].size - flow[i - 1].size) < 0.6) leads.push((flow[i].y + flow[i].h / 2) - (flow[i - 1].y + flow[i - 1].h / 2));
  const lead = median(leads.filter((d) => d > 0)) || body * 1.3;
  const baseX = flow.length ? median(flow.map((l) => l.x)) : 0;
  const textRight = flow.length ? Math.max(...flow.map((l) => l.x + l.w)) : 0;
  const textW = Math.max(1, textRight - baseX);

  const blocks = [];
  let para = null;
  const flushPara = () => { if (para) { blocks.push(finishPara(para, { body, page, baseX })); para = null; } };

  for (const it of items) {
    if (it.k === "table") {
      flushPara();
      blocks.push({ type: "table", rows: it.t.rows.map((r) => r.map(cellRuns)), header: it.t.rows[0].every((c) => c.length && c.every((r) => r.bold)), y: it.t.y });
    } else if (it.k === "image") {
      flushPara();
      blocks.push({ type: "image", data: it.im.data, mime: it.im.mime, w: it.im.w, h: it.im.h, y: it.y });
    } else {
      const l = it.line;
      const text = lineRuns(l).map((r) => r.t).join("");
      if (!text.trim()) continue;
      const mk = BULLET.test(text) && text.trim().length > 2;
      const prev = para?.lines[para.lines.length - 1];
      let split = !para || mk;
      if (para && !split) {
        const dy = (l.y + l.h / 2) - (prev.y + prev.h / 2);
        const sizeJump = Math.abs(r05(l.size) - r05(prev.size)) >= 1.5;
        const indented = l.x - prev.x > l.size * 1.2 && !para.list;
        const shortEnd = prev.x + prev.w < textRight - textW * 0.12 && /[.!?:]["')\]]?\s*$/.test(para.lastText);
        const outdent = para.list && l.x <= para.firstX + 2;
        split = dy > lead * 1.35 + 1 || sizeJump || indented || shortEnd || outdent || dy < -2 * l.size;
      }
      if (split) { flushPara(); para = { lines: [], list: mk ? BULLET.exec(text)[1] : null, firstX: l.x, lastText: "" }; }
      para.lines.push(l);
      para.lastText = text;
    }
  }
  flushPara();
  return groupLists(blocks);
}

function finishPara(p, { body, page, baseX }) {
  let runs = [];
  p.lines.forEach((l, idx) => {
    const lr = lineRuns(l);
    if (idx > 0) {
      const last = runs[runs.length - 1];
      const first = lr[0];
      if (last && /\w-$/.test(last.t) && first && /^[a-z]/.test(first.t)) last.t = last.t.slice(0, -1);
      else if (last && !/\s$/.test(last.t)) runs.push({ ...last, t: " " });
    }
    runs.push(...lr);
  });
  runs = mergeRuns(runs);
  let marker = null;
  if (p.list && runs.length) {
    const m = BULLET.exec(runs[0].t);
    if (m) { marker = m[1]; runs[0].t = runs[0].t.slice(m[0].length); }
    runs = runs.filter((r) => r.t !== "");
  }
  if (runs.length) { runs[0].t = runs[0].t.replace(/^\s+/, ""); runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, ""); }
  const first = p.lines[0];
  const size = median(p.lines.map((l) => l.size));
  const text = runsText(runs);
  if (p.list) return { type: "li", ordered: !SYMBOL.test(marker || "-"), runs, y: first.y };
  const allBold = runs.length > 0 && runs.every((r) => r.b);
  const big = size >= body * 1.15 && p.lines.length <= 4;
  const boldHead = allBold && p.lines.length === 1 && text.length < 90 && size >= body * 0.98 && !/[.,;]$/.test(text);
  if (big || boldHead) {
    const ratio = size / body;
    const level = !big ? 3 : ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : 3;
    return { type: "heading", level, runs, y: first.y, align: alignOf(p, page, baseX) };
  }
  return { type: "p", runs, y: first.y, align: alignOf(p, page, baseX) };
}

function alignOf(p, page, baseX) {
  const first = p.lines[0];
  const cx = first.x + first.w / 2;
  if (p.lines.length <= 3 && Math.abs(cx - page.w / 2) < page.w * 0.025 && first.x > baseX + page.w * 0.06) return "center";
  return undefined;
}

function groupLists(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "li") {
      const last = out[out.length - 1];
      if (last?.type === "list" && last.ordered === b.ordered) last.items.push(b.runs);
      else out.push({ type: "list", ordered: b.ordered, items: [b.runs], y: b.y });
    } else out.push(b);
  }
  return out;
}

/** Whole document -> blocks with a pagebreak between pages. pages: [{w,h,lines,images?}] */
export function analyzeDocument(pages) {
  const body = bodySizeOf(pages);
  const perPage = pages.map((p) => analyzePage(p, { body }));
  const blocks = [];
  perPage.forEach((b, i) => { if (i) blocks.push({ type: "pagebreak" }); blocks.push(...b); });
  return { blocks, perPage, body };
}

/** Rows of cells for a spreadsheet page: tables in place and loose lines in the first column. */
export function pageGrid(page) {
  const lines = page.lines.filter((l) => l.runs.length);
  const tables = findTables(lines);
  const inTable = new Set(); for (const t of tables) for (const l of t.lines) inTable.add(l);
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const text = (runs) => clean(runs.map((r) => r.str).join(""));
  const items = [
    ...lines.filter((l) => !inTable.has(l)).map((l) => ({ y: l.y, row: [clean(lineRuns(l).map((r) => r.t).join(""))] })),
    ...tables.map((t) => ({ y: t.y, table: t.rows.map((r) => r.map(text)) })),
  ].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const it of items) { if (it.table) rows.push(...it.table); else if (it.row[0]) rows.push(it.row); }
  return { rows, tables: tables.map((t) => t.rows.map((r) => r.map(text))) };
}
