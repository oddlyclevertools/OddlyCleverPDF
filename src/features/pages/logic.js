// Pure helpers for the Pages feature (no DOM, so they can be unit tested).

export const MM = 72 / 25.4;
export const mmToPt = (mm) => mm * MM;

/** Page ranges like "1-3, 5, 8-" -> arrays of zero-based indexes, one per comma term. */
export function parseRanges(text, total) {
  const parts = [];
  for (const raw of String(text || "").split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(raw) || /^(\d+)$/.exec(raw);
    if (!m) throw new Error(`I could not read "${raw}". Try something like 1-3, 5, 8-`);
    let a, b;
    if (m.length === 2) a = b = Number(m[1]);
    else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : total; }
    if (a < 1 || b < 1) throw new Error("Page numbers start at 1.");
    if (a > total) throw new Error(`This PDF only has ${total} page${total === 1 ? "" : "s"}.`);
    b = Math.min(b, total);
    if (b < a) throw new Error(`"${raw}" goes backwards. Write the smaller number first.`);
    parts.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  if (!parts.length) throw new Error("Type the pages you want, like 1-3, 5, 8-");
  return parts;
}

/** Flat, de-duplicated, sorted indexes from a range string. */
export const rangeIndexes = (text, total) => [...new Set(parseRanges(text, total).flat())].sort((a, b) => a - b);

/** Every n pages -> arrays of indexes. */
export function everyN(total, n) {
  n = Math.max(1, Math.floor(n) || 1);
  const out = [];
  for (let i = 0; i < total; i += n) out.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return out;
}

/** "1-3, 5" from indexes. */
export function describePages(idx) {
  const s = [...idx].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** Move the picked items (kept in their current order) so they sit before position `to` of the list without them. */
export function reorder(list, pickedIds, to) {
  const set = new Set(pickedIds);
  const moving = list.filter((x) => set.has(x.id));
  const rest = list.filter((x) => !set.has(x.id));
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Fill in {n} {total} {name} {date} in a header, footer or page-number format. */
export function fillFormat(fmt, vars) {
  return String(fmt || "").replace(/\{(n|total|name|date)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** Pages (zero-based indexes) that a "which pages" setting covers. */
export function scopeIndexes(scope, rangeText, total, { current = 0, picked = [] } = {}) {
  const all = Array.from({ length: total }, (_, i) => i);
  switch (scope) {
    case "odd": return all.filter((i) => i % 2 === 0);
    case "even": return all.filter((i) => i % 2 === 1);
    case "current": return [Math.min(current, total - 1)];
    case "picked": return picked.length ? [...picked] : [Math.min(current, total - 1)];
    case "range": try { return rangeIndexes(rangeText, total); } catch { return []; }
    default: return all;
  }
}

// ---- turning what the reader sees into page space ----------------------------------------------
// Page space is the unrotated page, y down. The page is shown turned `rotate` degrees clockwise.

const rot = (page) => ((page.rotate % 360) + 360) % 360;

/** A point as the reader sees it (relative to the shown page's top-left) -> page space. */
export function shownToPage(page, sx, sy) {
  const r = rot(page);
  if (r === 90) return { x: sy, y: page.h - sx };
  if (r === 180) return { x: page.w - sx, y: page.h - sy };
  if (r === 270) return { x: page.w - sy, y: sx };
  return { x: sx, y: sy };
}
/** A page-space point -> shown space. */
export function pageToShown(page, x, y) {
  const r = rot(page);
  if (r === 90) return { x: page.h - y, y: x };
  if (r === 180) return { x: page.w - x, y: page.h - y };
  if (r === 270) return { x: y, y: page.w - x };
  return { x, y };
}
/** Margins {l,t,r,b} as the reader sees them -> margins in page space. */
export function marginsToPage(m, rotate) {
  const r = ((rotate % 360) + 360) % 360;
  if (r === 90) return { l: m.t, t: m.r, r: m.b, b: m.l };
  if (r === 180) return { l: m.r, t: m.b, r: m.l, b: m.t };
  if (r === 270) return { l: m.b, t: m.l, r: m.t, b: m.r };
  return { ...m };
}

/** The part of a page that is kept after cropping, in page space. */
export function viewArea(page, crop) {
  const c = crop || { l: 0, t: 0, r: 0, b: 0 };
  return { x: c.l, y: c.t, w: Math.max(1, page.w - c.l - c.r), h: Math.max(1, page.h - c.t - c.b) };
}

/** Size of a page-space area as the reader sees it. */
export function shownArea(page, area) {
  const r = rot(page);
  return r === 90 || r === 270 ? { w: area.h, h: area.w } : { w: area.w, h: area.h };
}

/**
 * Where a piece of text or a picture goes. It is worked out as the reader sees the page (upright),
 * then turned into page space so it still reads upright on rotated pages.
 * `center` is in shown space relative to the (cropped) area; `angle` is degrees counter-clockwise.
 * Returns { ox, oy, angle }: the bottom-left corner of the item in page space (y down), and the
 * page-space angle.
 */
export function placeItem(page, area, center, w, h, angle) {
  const a = (angle * Math.PI) / 180;
  const u = [Math.cos(a), -Math.sin(a)];
  const up = [-Math.sin(a), -Math.cos(a)];
  const tl = pageToShown(page, area.x, area.y), br = pageToShown(page, area.x + area.w, area.y + area.h);
  const cx = Math.min(tl.x, br.x) + center.x, cy = Math.min(tl.y, br.y) + center.y;
  const sx = cx - (u[0] * w) / 2 - (up[0] * h) / 2;
  const sy = cy - (u[1] * w) / 2 - (up[1] * h) / 2;
  const p = shownToPage(page, sx, sy);
  return { ox: p.x, oy: p.y, angle: angle + rot(page) };
}

const NINE = {
  "top-left": [0, 0], "top-center": [0.5, 0], "top-right": [1, 0],
  "middle-left": [0, 0.5], "middle": [0.5, 0.5], "middle-right": [1, 0.5],
  "bottom-left": [0, 1], "bottom-center": [0.5, 1], "bottom-right": [1, 1],
};
/** Centre of an item w x h put at a named spot inside a shown area sw x sh, with a margin. */
export function spotCenter(spot, sw, sh, w, h, margin = 28) {
  const [fx, fy] = NINE[spot] || NINE.middle;
  return { x: margin + w / 2 + fx * Math.max(0, sw - 2 * margin - w), y: margin + h / 2 + fy * Math.max(0, sh - 2 * margin - h) };
}

/** Move every coordinate of an edit by (dx, dy). */
export function shiftObject(o, dx, dy) {
  for (const [kx, ky] of [["x", "y"], ["x1", "y1"], ["x2", "y2"]]) {
    if (typeof o[kx] === "number") o[kx] += dx;
    if (typeof o[ky] === "number") o[ky] += dy;
  }
  if (o.strokes) o.strokes = o.strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy]));
  if (o.rects) o.rects = o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  if (o.cover) o.cover = { ...o.cover, x: o.cover.x + dx, y: o.cover.y + dy };
  return o;
}

export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
