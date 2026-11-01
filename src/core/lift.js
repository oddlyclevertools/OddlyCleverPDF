// Lifting the page's own pictures and shapes into edits you can move. findItems lists every
// picture and drawn shape on a page with its box (the parts of one icon count as one item);
// without() writes the page's drawing instructions with items cut out, only() with nothing else.
// Boxes are [x0, y0, x1, y1] in PDF user space. Item `units` are [from, to] operator indices.
import { PDFArray, PDFDict, PDFName, PDFRef } from "@cantoo/pdf-lib";
import { contentOps, readPage, pageSource, streamText, mul, apply, boxOf } from "./type3.js";

// contentOps doesn't say where an operator ends, but it slices the operator's own token last
// before yielding it, so this string remembers where the last slice ended.
// shortcut: relies on contentOps's slicing; upgrade when contentOps yields positions itself.
class Tracked extends String { slice(a, b) { this.end = b; return super.slice(a, b); } }

/** The page's content (all parts joined) and its operators with their [start, end) in it. */
export function pageOps(doc, index) {
  const src = pageSource(doc, index);
  const t = new Tracked(src), ops = [];
  let prev = 0;
  for (const { op, args } of contentOps(t)) {
    // an inline image (BI … EI) that contentOps skipped stays outside every range
    const bi = op === "BT" || /^T/.test(op) ? -1 : src.slice(prev, t.end).search(/(^|\s)BI\s/);
    const start = bi < 0 ? prev : src.indexOf("EI", prev + bi) + 2;
    ops.push({ op, args, start, end: t.end });
    prev = t.end;
  }
  return { src, ops };
}

const corners = (m, x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(m, x, y));
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const gap = (a, b) => Math.max(a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3], 0);

const PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);
const BUILD = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const MARKS = new Set(["BMC", "BDC", "EMC", "MP", "DP"]);
const TEXT_STATE = new Set(["Tf", "Tc", "Tw", "Tz", "TL", "Ts", "Tr"]);
const ICON = 72; // touching shapes join into one item while it stays under an inch

/**
 * The drawing units of a page (paths, text blocks, pictures, forms, shadings), in order.
 * @returns {Array<{ kind: "path"|"text"|"image"|"form"|"shade", from, to, box?, subs?, clip?, paint? }>}
 */
function readUnits(doc, index, ops) {
  const res = doc.getPage(index).node.Resources();
  const xobjs = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const units = [];
  let ctm = [1, 0, 0, 1, 0, 0], lw = 1, from = -1, subs = [], sub = null, clip = false, textFrom = -1, cur = [0, 0];
  const stack = [];
  const pt = (x, y) => apply(ctm, x, y);
  ops.forEach(({ op, args: a }, i) => {
    if (BUILD.has(op) && from < 0) from = i;
    switch (op) {
      case "q": stack.push([ctm, lw]); break;
      case "Q": [ctm, lw] = stack.pop() || [[1, 0, 0, 1, 0, 0], 1]; break;
      case "cm": if (a.length >= 6) ctm = mul(a, ctm); break;
      case "w": lw = a[0] ?? 1; break;
      case "m": sub = [pt(a[0], a[1])]; subs.push(sub); cur = [a[0], a[1]]; break;
      case "l": sub?.push(pt(a[0], a[1])); cur = [a[0], a[1]]; break;
      case "c": sub?.push(pt(a[0], a[1]), pt(a[2], a[3]), pt(a[4], a[5])); cur = [a[4], a[5]]; break;
      case "v": sub?.push(pt(...cur), pt(a[0], a[1]), pt(a[2], a[3])); cur = [a[2], a[3]]; break;
      case "y": sub?.push(pt(a[0], a[1]), pt(a[2], a[3])); cur = [a[2], a[3]]; break;
      case "re": subs.push(corners(ctm, a[0], a[1], a[0] + a[2], a[1] + a[3])); sub = null; break;
      case "W": case "W*": clip = true; break;
      case "BT": textFrom = i; break;
      case "ET": if (textFrom >= 0) units.push({ kind: "text", from: textFrom, to: i }); textFrom = -1; break;
      case "sh": units.push({ kind: "shade", from: i, to: i }); break;
      case "Do": {
        const x = xobjs && doc.context.lookup(xobjs.get(PDFName.of(a[0]?.name)));
        const type = x?.dict?.get(PDFName.of("Subtype"))?.toString();
        if (type === "/Image") units.push({ kind: "image", from: i, to: i, box: boxOf(corners(ctm, 0, 0, 1, 1)) });
        else if (type === "/Form") {
          const bb = x.dict.lookupMaybe(PDFName.of("BBox"), PDFArray)?.asArray().map((n) => n.asNumber?.() ?? 0) || [0, 0, 0, 0];
          const fm = x.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray)?.asArray().map((n) => n.asNumber?.() ?? 0);
          const text = /(^|\s)BT\s/.test(streamText(x)); // forms with words in them stay put
          units.push({ kind: "form", from: i, to: i, text, box: boxOf(corners(fm?.length === 6 ? mul(fm, ctm) : ctm, ...bb)) });
        }
        break;
      }
    }
    if (PAINT.has(op) && from >= 0) {
      const pts = subs.flat();
      if (pts.length) {
        let box = boxOf(pts);
        const stroke = /^[SsBb]/.test(op);
        if (stroke) { const p = (Math.max(lw, 1) * Math.hypot(ctm[0], ctm[1])) / 2; box = [box[0] - p, box[1] - p, box[2] + p, box[3] + p]; }
        units.push({ kind: "path", from, to: i, clip, paint: op !== "n", box, subs: subs.map(boxOf) });
      }
      from = -1; subs = []; sub = null; clip = false;
    }
  });
  return units;
}

/** Text lines drawn as shapes (Figma's letters), as boxes, so their shapes aren't taken for pictures. */
function letterBoxes(doc, index) {
  try {
    return readPage(doc, index).shows.map((s) => [s.x0, s.base - s.size * 0.35, s.x1, s.base + s.size * 1.05]);
  } catch { return []; }
}
const inside = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/**
 * Every picture and shape on a page that can be picked up.
 * @returns {{ src: string, ops: Array, items: Array<{ kind: "picture"|"shape", units: number[][], box: number[] }> }}
 */
export function findItems(doc, index, parsed = pageOps(doc, index)) {
  const page = doc.getPage(index);
  const { x, y, width, height } = page.getCropBox();
  const letters = letterBoxes(doc, index);
  const items = [];
  let group = null; // the shape item still taking touching parts
  for (const u of readUnits(doc, index, parsed.ops)) {
    if (u.kind === "path" && !u.paint) continue; // clipping only
    const b = u.box;
    const liftable = b && b[2] - b[0] + b[3] - b[1] > 0.5 && !(u.kind === "form" && u.text) &&
      !(b[2] - b[0] >= width * 0.9 && b[3] - b[1] >= height * 0.9) && // the page background
      b[2] > x && b[0] < x + width && b[3] > y && b[1] < y + height;
    const letter = u.kind === "path" && letters.length &&
      u.subs.filter((s) => letters.some((l) => inside(l, (s[0] + s[2]) / 2, (s[1] + s[3]) / 2))).length * 2 > u.subs.length;
    if (!liftable || letter || u.kind === "text" || u.kind === "shade") { group = null; continue; }
    if (u.kind === "path" && group) {
      const all = union(group.box, b);
      if (gap(group.box, b) <= 1.5 && all[2] - all[0] <= ICON && all[3] - all[1] <= ICON) {
        group.units.push([u.from, u.to]);
        group.box = all;
        continue;
      }
    }
    // the same shape drawn twice (a fill, then its outline) is one thing
    const twin = u.kind === "path" && items.find((it) => it.kind === "shape" && it.box.every((v, k) => Math.abs(v - b[k]) < 0.5));
    if (twin) { twin.units.push([u.from, u.to]); group = twin; continue; }
    const item = { kind: u.kind === "image" ? "picture" : "shape", units: [[u.from, u.to]], box: b };
    items.push(item);
    group = u.kind === "path" ? item : null;
  }
  return { ...parsed, items };
}

const inUnits = (units) => {
  const set = new Set();
  for (const [a, b] of units) for (let i = a; i <= b; i++) set.add(i);
  return set;
};

/** The content with the given units' operators cut out. */
export function without(src, ops, units) {
  const cut = inUnits(units);
  let out = "", at = 0;
  ops.forEach((o, i) => {
    if (!cut.has(i)) return;
    out += src.slice(at, o.start);
    at = o.end;
  });
  return out + src.slice(at);
}

/**
 * The content with only the given units drawn: colours, transforms and clipping stay; other
 * paths, text, pictures and marked-content tags go. Also lists the resource names it still uses.
 * @returns {{ text: string, names: Record<string, Set<string>> }}
 */
export function only(src, ops, units) {
  const keep = inUnits(units);
  const names = { ExtGState: new Set(), ColorSpace: new Set(), Pattern: new Set(), XObject: new Set(), Shading: new Set() };
  const out = [];
  let path = [], inText = false;
  ops.forEach((o, i) => {
    const { op, args: a } = o;
    const take = () => {
      out.push(src.slice(o.start, o.end));
      if (op === "gs") names.ExtGState.add(a[0]?.name);
      else if ((op === "cs" || op === "CS") && a[0]?.name) names.ColorSpace.add(a[0].name);
      else if ((op === "scn" || op === "SCN") && a.at(-1)?.name) names.Pattern.add(a.at(-1).name);
      else if (op === "Do") names.XObject.add(a[0]?.name);
      else if (op === "sh") names.Shading.add(a[0]?.name);
    };
    if (keep.has(i)) { inText = false; return take(); }
    if (op === "BT") inText = true;
    if (inText || op === "ET") { if (op === "ET") inText = false; return; }
    if (BUILD.has(op) || op === "W" || op === "W*") { path.push(i); return; }
    if (PAINT.has(op)) {
      // someone else's path: keep it only as clipping
      if (path.some((k) => ops[k].op[0] === "W")) { for (const k of path) out.push(src.slice(ops[k].start, ops[k].end)); out.push(" n"); }
      path = [];
      return;
    }
    if (op === "Do" || op === "sh" || MARKS.has(op) || TEXT_STATE.has(op)) return;
    take();
  });
  for (const k of Object.keys(names)) names[k].delete(undefined);
  return { text: out.join("\n"), names };
}

/** A resources dict (in doc's context) holding only the given names from the page's resources. */
export function pickResources(doc, index, names) {
  const res = doc.getPage(index).node.Resources();
  const out = doc.context.obj({});
  for (const [cat, set] of Object.entries(names)) {
    const from = res?.lookupMaybe(PDFName.of(cat), PDFDict);
    if (!from || !set.size) continue;
    const sub = doc.context.obj({});
    for (const n of set) { const v = from.get(PDFName.of(n)); if (v) sub.set(PDFName.of(n), v); }
    out.set(PDFName.of(cat), sub);
  }
  return out;
}

/** Replace a page's content with new text (one stream). */
export function setContent(doc, index, text) {
  doc.getPage(index).node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(text)));
}

/**
 * Take an item off a page for good: cut its operators, and when it was a picture (or form) that
 * nothing else draws, remove that from the file too, so no unused copy hides in it.
 */
export function cutItem(doc, index, { src, ops }, item) {
  setContent(doc, index, without(src, ops, item.units));
  const cut = inUnits(item.units);
  const names = new Set([...cut].filter((i) => ops[i].op === "Do").map((i) => ops[i].args[0]?.name));
  for (const i of ops.keys()) if (!cut.has(i) && ops[i].op === "Do") names.delete(ops[i].args[0]?.name);
  const dictOf = (p) => p.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const mine = dictOf(doc.getPage(index));
  const others = doc.getPages().filter((_, k) => k !== index).map(dictOf).filter(Boolean);
  for (const name of names) {
    const ref = mine?.get(PDFName.of(name));
    if (!ref || others.some((d) => d === mine || [...d.values()].includes(ref))) continue; // shared with another page
    mine.delete(PDFName.of(name));
    // shortcut: also drops the picture's own masks, not deeper objects (a form's inner pictures stay)
    const dict = doc.context.lookup(ref)?.dict;
    for (const k of ["SMask", "Mask"]) { const r = dict?.get(PDFName.of(k)); if (r instanceof PDFRef) doc.context.delete(r); }
    doc.context.delete(ref);
  }
}
