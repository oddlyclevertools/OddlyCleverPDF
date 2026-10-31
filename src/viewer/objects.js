// Draw a page's edits on screen. Each object gets one element, kept by id, so redraws are cheap
// and an object being typed into is never replaced. The layer never takes pointer events: the
// tools hit-test with bbox() instead.
import { state } from "../core/store.js";
import { cssFamily } from "../core/fonts.js";

const SVGNS = "http://www.w3.org/2000/svg";
export const NOTE_SIZE = 20;

/** The box an object covers, in page space. */
export function bbox(o) {
  switch (o.type) {
    case "line": case "arrow": {
      const pad = (o.width ?? 2) / 2 + 2;
      return { x: Math.min(o.x1, o.x2) - pad, y: Math.min(o.y1, o.y2) - pad, w: Math.abs(o.x2 - o.x1) + pad * 2, h: Math.abs(o.y2 - o.y1) + pad * 2 };
    }
    case "ink": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of o.strokes || []) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = (o.width ?? 2) / 2;
      return isFinite(x0) ? { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 } : { x: 0, y: 0, w: 0, h: 0 };
    }
    case "highlight": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of o.rects || []) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
      return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
    }
    case "note": return { x: o.x, y: o.y, w: NOTE_SIZE, h: NOTE_SIZE };
    default: return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

/** Objects that can be resized with corner handles (lines use their end points). */
export const resizable = (o) => ["text", "image", "rect", "ellipse", "whiteout", "redact", "ink"].includes(o.type);

const px = (n) => `${n}px`;

function svgFor(o, page) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${page.w} ${page.h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("obj-svg");
  return svg;
}
const node = (name, attrs) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

function paintSvg(svg, o) {
  svg.replaceChildren();
  const op = o.opacity ?? 1;
  switch (o.type) {
    case "ink":
      for (const s of o.strokes || []) {
        if (s.length === 1) { svg.append(node("circle", { cx: s[0][0], cy: s[0][1], r: (o.width ?? 2) / 2, fill: o.color, opacity: op })); continue; }
        svg.append(node("path", { d: s.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(""), fill: "none", stroke: o.color, "stroke-width": o.width ?? 2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: op }));
      }
      break;
    case "rect":
      svg.append(node("rect", { x: o.x, y: o.y, width: Math.max(0, o.w), height: Math.max(0, o.h), fill: o.fill && o.fill !== "none" ? o.fill : "none", stroke: o.stroke && o.stroke !== "none" ? o.stroke : "none", "stroke-width": o.width ?? 2, opacity: op }));
      break;
    case "ellipse":
      svg.append(node("ellipse", { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.abs(o.w / 2), ry: Math.abs(o.h / 2), fill: o.fill && o.fill !== "none" ? o.fill : "none", stroke: o.stroke && o.stroke !== "none" ? o.stroke : "none", "stroke-width": o.width ?? 2, opacity: op }));
      break;
    case "line": case "arrow": {
      const w = o.width ?? 2;
      svg.append(node("line", { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: o.stroke || "#111", "stroke-width": w, "stroke-linecap": "round", opacity: op }));
      if (o.type === "arrow") {
        const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), L = Math.max(8, w * 4);
        const p1 = [o.x2 - L * Math.cos(a - 0.45), o.y2 - L * Math.sin(a - 0.45)];
        const p2 = [o.x2 - L * Math.cos(a + 0.45), o.y2 - L * Math.sin(a + 0.45)];
        svg.append(node("path", { d: `M${o.x2} ${o.y2}L${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}Z`, fill: o.stroke || "#111", opacity: op }));
      }
      break;
    }
    case "highlight":
      for (const r of o.rects || []) {
        if (o.style === "underline" || o.style === "strike") {
          const y = o.style === "underline" ? r.y + r.h * 0.95 : r.y + r.h * 0.55;
          svg.append(node("line", { x1: r.x, y1: y, x2: r.x + r.w, y2: y, stroke: o.color, "stroke-width": Math.max(0.8, r.h * 0.07), opacity: op }));
        } else svg.append(node("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: o.color || "#ffd60a", opacity: o.opacity ?? 0.45, style: "mix-blend-mode:multiply" }));
      }
      break;
  }
}

function paintHtml(n, o, z, editing) {
  const s = n.style;
  s.left = px(o.x * z); s.top = px(o.y * z);
  if (o.type !== "note") { s.width = px(o.w * z); s.height = px(o.h * z); }
  s.opacity = o.opacity ?? 1;
  switch (o.type) {
    case "text": {
      s.fontFamily = cssFamily(o.font);
      s.fontSize = px((o.size || 14) * z);
      s.lineHeight = String(o.lineHeight || 1.25);
      s.fontWeight = o.bold ? "700" : "400";
      s.fontStyle = o.italic ? "italic" : "normal";
      s.textDecoration = o.underline ? "underline" : "none";
      s.color = o.color || "#111";
      s.textAlign = o.align || "left";
      s.background = o.bg || "transparent";
      s.height = "auto"; s.minHeight = px(o.h * z);
      let cover = n.querySelector(":scope > .cover");
      if (o.cover) {
        if (!cover) { cover = document.createElement("div"); cover.className = "cover"; n.prepend(cover); }
        Object.assign(cover.style, { left: px((o.cover.x - o.x) * z), top: px((o.cover.y - o.y) * z), width: px(o.cover.w * z), height: px(o.cover.h * z), background: o.cover.color || "#fff" });
      } else cover?.remove();
      let t = n.querySelector(":scope > .txt");
      if (!t) { t = document.createElement("div"); t.className = "txt"; n.append(t); }
      if (!editing && t.textContent !== (o.text || "")) t.textContent = o.text || "";
      t.classList.toggle("placeholder", !o.text);
      t.dataset.ph = o.placeholder || "Type here";
      break;
    }
    case "image": {
      let img = n.querySelector("img");
      if (!img) { img = document.createElement("img"); img.draggable = false; img.alt = ""; n.append(img); }
      const src = state.images.get(o.imageId) || "";
      if (img.getAttribute("src") !== src) img.src = src;
      break;
    }
    case "whiteout": s.background = o.color || "#fff"; break;
    case "redact": break;
    case "note": s.setProperty("--c", o.color || "#ffd60a"); s.width = px(NOTE_SIZE * z); s.height = px(NOTE_SIZE * z); n.title = o.text || "Note"; break;
  }
}

const SVG_TYPES = new Set(["ink", "rect", "ellipse", "line", "arrow", "highlight"]);

/** Bring the page's object layer in line with the model. */
export function drawObjects(v) {
  const p = v.page;
  const z = state.zoom;
  const layer = v.objects;
  const seen = new Set();
  const editingId = layer.querySelector("[contenteditable=true]")?.closest(".obj")?.dataset.id;
  let prev = null;
  for (const o of p.objects) {
    seen.add(o.id);
    let n = layer.querySelector(`:scope > [data-id="${o.id}"]`);
    const isSvg = SVG_TYPES.has(o.type);
    if (n && n.dataset.type !== o.type) { n.remove(); n = null; }
    if (!n) {
      n = isSvg ? svgFor(o, p) : document.createElement("div");
      n.classList.add("obj", `obj-${o.type}`);
      n.dataset.id = o.id; n.dataset.type = o.type;
      n.classList.add("pop");
    }
    if (isSvg) paintSvg(n, o); else paintHtml(n, o, z, editingId === o.id);
    n.classList.toggle("selected", state.selection.includes(o.id));
    // keep z-order: each object right after the previous one
    if (prev ? prev.nextSibling !== n : layer.firstChild !== n) prev ? prev.after(n) : layer.prepend(n);
    prev = n;
  }
  for (const n of [...layer.children]) if (n.dataset.id && !seen.has(n.dataset.id)) n.remove();
  drawSelection(v);
}

/** The selection frame and handles (shown for one selected object on this page). */
function drawSelection(v) {
  const z = state.zoom;
  let frame = v.objects.querySelector(":scope > .sel-frame");
  const sel = state.selection.map((id) => v.page.objects.find((o) => o.id === id)).filter(Boolean);
  if (!sel.length) { frame?.remove(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of sel) { const b = bbox(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  if (!frame) {
    frame = document.createElement("div");
    frame.className = "sel-frame";
    for (const h of ["nw", "ne", "sw", "se"]) { const d = document.createElement("i"); d.className = `h h-${h}`; frame.append(d); }
  }
  v.objects.append(frame);
  const one = sel.length === 1 ? sel[0] : null;
  frame.classList.toggle("no-handles", !one || !resizable(one));
  frame.classList.toggle("line-ends", !!one && (one.type === "line" || one.type === "arrow"));
  // the frame follows the actual text height on screen
  let h = (y1 - y0) * z;
  if (one?.type === "text") { const n = v.objects.querySelector(`[data-id="${one.id}"]`); if (n) h = Math.max(h, n.offsetHeight); }
  Object.assign(frame.style, { left: px(x0 * z), top: px(y0 * z), width: px((x1 - x0) * z), height: px(h) });
}
