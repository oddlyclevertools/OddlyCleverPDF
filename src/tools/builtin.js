// The everyday tools: add text, edit the PDF's own text, draw, highlight, shapes, whiteout,
// redact, sticky notes and pictures.
import { state, pageById, begin, end, live, select, addObject, uid, putImage, emit, change } from "../core/store.js";
import { pageLines, blocksOf, charX, charAt, stemWidth } from "../core/text.js";
import { viewOf } from "../viewer/viewer.js";
import { registerTool, toolPrefs, useTool } from "./registry.js";
import { startTyping } from "./select.js";
import { toast } from "../ui/kit.js";
import { type3FontFor } from "../core/type3.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- add text ---------------------------------------------------------------------------------

export const TEXT_DEFAULTS = { font: "sans", size: 14, color: "#111111", bold: false, italic: false, align: "left" };

registerTool({
  id: "text", label: "Add text", icon: "Type", mode: "tap", order: 10, key: "t", group: "edit",
  hint: "Tap anywhere on a page to type.",
  tap: ({ pageId, pt }) => {
    const page = pageById(pageId);
    const pr = toolPrefs("text", TEXT_DEFAULTS);
    const w = clamp(page.w * 0.45, 120, page.w - pt.x - 8);
    const o = { id: uid(), type: "text", x: clamp(pt.x, 0, page.w - 40), y: clamp(pt.y - pr.size * 0.65, 0, page.h - pr.size), w: Math.max(40, w), h: pr.size * 1.25, text: "", ...pr };
    begin();
    page.objects.push(o);
    live([pageId]);
    useTool("select");
    // the undo step opened above closes when typing ends (an empty box leaves no step at all)
    requestAnimationFrame(() => startTyping(o.id, { fresh: true }));
  },
});

// ---- edit the PDF's own text --------------------------------------------------------------------

/** Average colour of a canvas strip (the paper behind the text), and its stroke width in points. */
function sampleColors(v, box) {
  const c = v.canvas;
  const g = c.getContext("2d", { willReadFrequently: true });
  const sx = c.width / v.page.w, sy = c.height / v.page.h;
  const x = Math.max(0, Math.floor(box.x * sx)), y = Math.max(0, Math.floor(box.y * sy));
  const w = Math.max(1, Math.min(c.width - x, Math.ceil(box.w * sx))), h = Math.max(1, Math.min(c.height - y, Math.ceil(box.h * sy)));
  let data;
  try { data = g.getImageData(x, y, w, h).data; } catch { return { bg: "#ffffff", ink: "#111111" }; }
  // the most common light-ish colour is the paper; the darkest far-from-paper pixel is the ink
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
  return { bg: hex(bg), ink: far > 90 ? hex(ink) : "#111111", stem: stemWidth(data, w, h, bg) / sy };
}

let type3Noted = false;

registerTool({
  id: "edittext", label: "Edit text", icon: "TextCursorInput", mode: "tap", order: 5, key: "e", group: "edit",
  hint: "Tap any words in the PDF to change them.",
  tap: async ({ pageId, pt }) => {
    const lines = await pageLines(pageId);
    const v = viewOf(pageId);
    let pick = null;
    for (const l of lines) {
      for (const b of blocksOf(l)) {
        const pad = Math.max(2, b.size * 0.25);
        if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) pick = { line: l, block: b };
      }
    }
    if (!pick) {
      toast(lines.length ? "No text right there. Tap on the words you want to change." : "This page has no editable text (it may be a scan). Use Add text, or turn on text recognition (OCR).", { ms: 4200 });
      return;
    }
    const b = pick.block;
    const page = pageById(pageId);
    const already = page.objects.find((o) => o.type === "text" && o.cover && Math.abs(o.cover.x - b.x) < 1 && Math.abs(o.cover.y - (b.y - 1)) < 1.5);
    if (already) { select([already.id]); startTyping(already.id); return; }
    const first = b.runs[0];
    const { bg, ink, stem = 0 } = v ? sampleColors(v, b) : { bg: "#ffffff", ink: "#111111" };
    const size = Math.round(first.size * 10) / 10;
    // Type3 text (Figma exports): rebuild the font from the PDF's own letters; if that fails, judge
    // bold by how thick the strokes are, since the font has no name or weight to read
    const own = first.type3 ? await type3FontFor(pageId, b).catch((e) => { console.warn("[type3]", e); return null; }) : null;
    const bold = own ? false : first.type3 ? stem / first.size > 0.13 : first.bold;
    if (first.type3 && !own && !type3Noted) { type3Noted = true; toast("This PDF's font can't be reused, so we matched it as closely as we could.", { ms: 5000 }); }
    const o = {
      id: uid(), type: "text", x: b.x, y: b.y - size * 0.12, w: b.w * 1.3 + size * 2, h: b.h + size * 0.2, text: b.text,
      font: own || first.family, bold, italic: first.italic, size, color: ink, align: "left", lineHeight: 1.2,
      cover: { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2, color: bg }, edited: true,
    };
    o.w = Math.min(o.w, page.w - o.x);
    change("Edit text", () => page.objects.push(o), { pages: [pageId] });
    select([o.id]);
    requestAnimationFrame(() => startTyping(o.id, { selectAll: false }));
  },
});

// ---- draw ------------------------------------------------------------------------------------

export const DRAW_DEFAULTS = { color: "#1f4fd8", width: 2.5, opacity: 1 };
let stroke = null;

/** Smooth a stroke a little (moving average) so finger lines aren't shaky. */
function smooth(pts) {
  if (pts.length < 4) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) out.push([(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4]);
  out.push(pts.at(-1));
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

registerTool({
  id: "draw", label: "Draw", icon: "PenLine", mode: "drag", order: 20, key: "d", group: "edit",
  hint: "Draw with your finger, pen or mouse.",
  down: ({ pageId, pt }) => {
    const pr = toolPrefs("draw", DRAW_DEFAULTS);
    begin();
    const page = pageById(pageId);
    // strokes drawn close together in time join one drawing (a signature, a word)
    const last = page.objects.at(-1);
    if (last?.type === "ink" && last._t && Date.now() - last._t < 1500 && last.color === pr.color && last.width === pr.width) {
      stroke = { pageId, obj: last, pts: [[pt.x, pt.y]] };
      last.strokes.push(stroke.pts);
    } else {
      const o = { id: uid(), type: "ink", strokes: [[[pt.x, pt.y]]], ...pr };
      page.objects.push(o);
      stroke = { pageId, obj: o, pts: o.strokes[0] };
    }
    live([pageId]);
  },
  move: ({ pt }) => {
    if (!stroke) return;
    const l = stroke.pts.at(-1);
    if (Math.hypot(pt.x - l[0], pt.y - l[1]) * state.zoom < 1.5) return;
    stroke.pts.push([pt.x, pt.y]);
    live([stroke.pageId]);
  },
  up: () => {
    if (!stroke) return;
    const s = stroke; stroke = null;
    const i = s.obj.strokes.indexOf(s.pts);
    s.obj.strokes[i] = smooth(s.pts);
    s.obj._t = Date.now();
    end("Draw", { pages: [s.pageId] });
  },
  cancel: () => {
    if (!stroke) return;
    const s = stroke; stroke = null;
    s.obj.strokes = s.obj.strokes.filter((x) => x !== s.pts);
    const page = pageById(s.pageId);
    if (!s.obj.strokes.length) page.objects = page.objects.filter((o) => o !== s.obj);
    end("Draw");
  },
});

// ---- highlight, underline, strike --------------------------------------------------------------

export const MARK_DEFAULTS = { color: "#ffd60a", style: "highlight" };
let mark = null;

/** Rectangles covering the text between two points, in reading order (like selecting text). */
export async function textRectsBetween(pageId, a, b) {
  const lines = await pageLines(pageId);
  if (!lines.length) return null;
  const idxOf = (p) => {
    let best = 0, bd = Infinity;
    lines.forEach((l, i) => { const d = p.y < l.y ? l.y - p.y : p.y > l.y + l.h ? p.y - l.y - l.h : 0; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  let i0 = idxOf(a), i1 = idxOf(b), s = a, e = b;
  if (i0 > i1 || (i0 === i1 && a.x > b.x)) { [i0, i1] = [i1, i0]; [s, e] = [e, s]; }
  const rects = [];
  for (let i = i0; i <= i1; i++) {
    const l = lines[i];
    const from = i === i0 ? s.x : -Infinity, to = i === i1 ? e.x : Infinity;
    let x0 = Infinity, x1 = -Infinity;
    for (const r of l.runs) {
      // whole letters whose middle lies between the two points
      let ks = -1, ke = -1;
      for (let k = 0; k < r.str.length; k++) {
        const mid = (charX(r, k) + charX(r, k + 1)) / 2;
        if (mid >= from && mid <= to) { if (ks < 0) ks = k; ke = k; }
      }
      if (ks < 0) continue;
      x0 = Math.min(x0, charX(r, ks)); x1 = Math.max(x1, charX(r, ke + 1));
    }
    if (x1 > x0) rects.push({ x: x0, y: l.y, w: x1 - x0, h: l.h });
  }
  return rects;
}

registerTool({
  id: "highlight", label: "Highlight", icon: "Highlighter", mode: "drag", order: 15, key: "h", group: "edit",
  hint: "Drag across the words to mark them.",
  down: ({ pageId, pt }) => {
    const pr = toolPrefs("highlight", MARK_DEFAULTS);
    begin();
    const o = { id: uid(), type: "highlight", rects: [], color: pr.color, style: pr.style, opacity: pr.style === "highlight" ? 0.45 : 1 };
    pageById(pageId).objects.push(o);
    mark = { pageId, obj: o, start: pt, seq: 0, free: false };
  },
  move: async ({ pt }) => {
    if (!mark) return;
    const m = mark, seq = ++m.seq;
    const rects = await textRectsBetween(m.pageId, m.start, pt);
    if (m !== mark || seq !== m.seq) return;
    if (rects == null) { // a scan with no text: a marker box instead
      m.free = true;
      m.obj.rects = [{ x: Math.min(m.start.x, pt.x), y: Math.min(m.start.y, pt.y), w: Math.abs(pt.x - m.start.x), h: Math.max(6, Math.abs(pt.y - m.start.y)) }];
    } else m.obj.rects = rects;
    live([m.pageId]);
  },
  up: async ({ pt, moved }) => {
    if (!mark) return;
    const m = mark;
    if (!moved) { // a tap marks the word under the finger
      const lines = await pageLines(m.pageId);
      for (const l of lines) for (const r of l.runs) {
        if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) {
          const k = charAt(r, pt.x);
          let s = k, e = k;
          while (s > 0 && /\S/.test(r.str[s - 1])) s--;
          while (e < r.str.length - 1 && /\S/.test(r.str[e + 1])) e++;
          m.obj.rects = [{ x: charX(r, s), y: l.y, w: charX(r, e + 1) - charX(r, s), h: l.h }];
        }
      }
    } else {
      const rects = await textRectsBetween(m.pageId, m.start, pt);
      if (rects) m.obj.rects = rects;
    }
    mark = null;
    const page = pageById(m.pageId);
    if (!m.obj.rects.length || m.obj.rects.every((r) => r.w < 1)) page.objects = page.objects.filter((o) => o !== m.obj);
    end(m.obj.style === "highlight" ? "Highlight" : m.obj.style === "underline" ? "Underline" : "Strike through", { pages: [m.pageId] });
  },
  cancel: () => { if (!mark) return; const m = mark; mark = null; const p = pageById(m.pageId); p.objects = p.objects.filter((o) => o !== m.obj); end("Highlight"); },
});

// ---- boxes and lines (rect, ellipse, whiteout, redact, line, arrow) ----------------------------

export const SHAPE_DEFAULTS = { stroke: "#d81f3c", fill: "none", width: 2, opacity: 1 };
let shape = null;

function boxTool(id, label, icon, order, make, { key, hint, group = "edit" } = {}) {
  registerTool({
    id, label, icon, mode: "drag", order, key, hint, group,
    down: ({ pageId, pt }) => {
      begin();
      const o = { id: uid(), ...make(), x: pt.x, y: pt.y, w: 0, h: 0 };
      pageById(pageId).objects.push(o);
      shape = { pageId, obj: o, start: pt };
      live([pageId]);
    },
    move: ({ pt, e }) => {
      if (!shape) return;
      const s = shape.start;
      let w = pt.x - s.x, h = pt.y - s.y;
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      Object.assign(shape.obj, { x: Math.min(s.x, s.x + w), y: Math.min(s.y, s.y + h), w: Math.abs(w), h: Math.abs(h) });
      live([shape.pageId]);
    },
    up: ({ moved }) => {
      if (!shape) return;
      const s = shape; shape = null;
      if (!moved || s.obj.w < 3 || s.obj.h < 3) { // a tap: a sensible default size
        const d = s.obj.type === "redact" || s.obj.type === "whiteout" ? [120, 18] : [90, 60];
        Object.assign(s.obj, { x: s.start.x - d[0] / 2, y: s.start.y - d[1] / 2, w: d[0], h: d[1] });
      }
      end(label, { pages: [s.pageId] });
      select([s.obj.id]);
    },
    cancel: () => { if (!shape) return; const s = shape; shape = null; const p = pageById(s.pageId); p.objects = p.objects.filter((o) => o !== s.obj); end(label); },
  });
}

boxTool("rect", "Box", "Square", 30, () => ({ type: "rect", ...toolPrefs("shapes", SHAPE_DEFAULTS) }), { group: "shapes" });
boxTool("ellipse", "Circle", "Circle", 31, () => ({ type: "ellipse", ...toolPrefs("shapes", SHAPE_DEFAULTS) }), { group: "shapes" });
boxTool("whiteout", "Whiteout", "Eraser", 40, () => ({ type: "whiteout", color: toolPrefs("whiteout", { color: "#ffffff" }).color }),
  { key: "w", hint: "Drag over anything to cover it with white (or any colour)." });
boxTool("redact", "Black out", "SquareDashed", 45, () => ({ type: "redact" }),
  { key: "r", hint: "Drag over private details. When you save, they are removed for good, not just covered." });

function lineTool(id, label, icon, order) {
  registerTool({
    id, label, icon, mode: "drag", order, group: "shapes",
    down: ({ pageId, pt }) => {
      begin();
      const pr = toolPrefs("shapes", SHAPE_DEFAULTS);
      const o = { id: uid(), type: id, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, stroke: pr.stroke, width: pr.width, opacity: pr.opacity };
      pageById(pageId).objects.push(o);
      shape = { pageId, obj: o, start: pt };
    },
    move: ({ pt, e }) => {
      if (!shape) return;
      let { x, y } = pt;
      if (e.shiftKey) { // snap to 45 degrees
        const a = Math.round(Math.atan2(y - shape.start.y, x - shape.start.x) / (Math.PI / 4)) * (Math.PI / 4);
        const d = Math.hypot(x - shape.start.x, y - shape.start.y);
        x = shape.start.x + Math.cos(a) * d; y = shape.start.y + Math.sin(a) * d;
      }
      Object.assign(shape.obj, { x2: x, y2: y });
      live([shape.pageId]);
    },
    up: ({ moved }) => {
      if (!shape) return;
      const s = shape; shape = null;
      if (!moved) Object.assign(s.obj, { x2: s.start.x + 80, y2: s.start.y });
      end(label, { pages: [s.pageId] });
      select([s.obj.id]);
    },
    cancel: () => { if (!shape) return; const s = shape; shape = null; const p = pageById(s.pageId); p.objects = p.objects.filter((o) => o !== s.obj); end(label); },
  });
}
lineTool("line", "Line", "Minus", 32);
lineTool("arrow", "Arrow", "MoveUpRight", 33);

// ---- sticky notes ----------------------------------------------------------------------------

registerTool({
  id: "note", label: "Note", icon: "StickyNote", mode: "tap", order: 50, key: "n", group: "edit",
  hint: "Tap to stick a note on the page. Other PDF readers show it as a comment.",
  tap: ({ pageId, pt }) => {
    const o = addObject(pageId, { type: "note", x: pt.x - 10, y: pt.y - 10, text: "", color: toolPrefs("note", { color: "#ffd60a" }).color }, "Add note");
    select([o.id]);
    useTool("select");
    emit("edit-note", { id: o.id });
  },
});

// ---- pictures --------------------------------------------------------------------------------

/** Read a picture file as a PNG or JPEG data URL (other formats are redrawn as PNG). */
export async function pictureDataUrl(file, { maxSide = 2400 } = {}) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const jpg = file.type === "image/jpeg";
  return { url: c.toDataURL(jpg ? "image/jpeg" : "image/png", 0.9), w: c.width, h: c.height };
}

/** Put a picture on a page, centred on a point, at most `maxFrac` of the page width. */
export function addPicture(pageId, { url, w, h }, at, { maxFrac = 0.4, label = "Add picture" } = {}) {
  const page = pageById(pageId);
  const k = Math.min(1, (page.w * maxFrac) / w, (page.h * 0.6) / h);
  const W = w * k, H = h * k;
  const p = at || { x: page.w / 2, y: page.h / 2 };
  const o = addObject(pageId, { type: "image", imageId: putImage(url), x: clamp(p.x - W / 2, 0, page.w - W), y: clamp(p.y - H / 2, 0, page.h - H), w: W, h: H }, label);
  select([o.id]);
  return o;
}

function pickPicture() {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

registerTool({
  id: "image", label: "Picture", icon: "ImagePlus", mode: "tap", order: 55, key: "i", group: "edit",
  hint: "Tap where the picture should go.",
  tap: async ({ pageId, pt }) => {
    const f = await pickPicture();
    if (!f) return;
    try { addPicture(pageId, await pictureDataUrl(f), pt); } catch { toast("Couldn't read that picture.", { error: true }); }
    useTool("select");
  },
});

// Paste a picture from the clipboard onto the page you're looking at.
export function installPaste(currentPageId) {
  document.addEventListener("paste", async (e) => {
    if (e.target.closest?.("input, textarea, [contenteditable=true]")) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item || !state.pages.length) return;
    e.preventDefault();
    try { addPicture(currentPageId(), await pictureDataUrl(item.getAsFile())); } catch { toast("Couldn't paste that picture.", { error: true }); }
  });
}
