// The page view: a scrolling column of pages. Each page is a "sheet" in its own unrotated space
// (canvas + selectable text + edits + tool layer), turned on screen by CSS. Pages render lazily
// when they come near the screen and re-render sharply after a zoom. Pinch, Ctrl+wheel and the
// zoom buttons all zoom around the pointer.
import { state, on, emit, shownSize, pageById } from "../core/store.js";
import { renderPage, pdfjs } from "../core/pdf.js";
import { el } from "../ui/kit.js";
import { drawObjects } from "./objects.js";

const GAP = 18;
const views = new Map(); // pageId -> { outer, sheet, canvas, text, objects, forms, tool, renderedAt, task, textDone }
let root, column, io, current = 0, renderQueue = [], rendering = 0;
const MAX_PARALLEL = 2;
const layerMakers = []; // features that add a layer to every sheet: fn(sheet, page) -> node

/** Add a layer to every page sheet (forms, search hits…). fn(page, view) returns a node or null. */
export function registerLayer(fn) { layerMakers.push(fn); }

export const viewOf = (id) => views.get(id);
export const scroller = () => root;
export const currentIndex = () => current;

export function mount(host) {
  root = el("div.viewport", { tabindex: "0", "aria-label": "Pages" });
  column = el("div.pages");
  root.append(column);
  host.append(root);
  io = new IntersectionObserver(onSeen, { root, rootMargin: "120% 0px" });
  root.addEventListener("scroll", trackCurrent, { passive: true });
  wireZoomGestures();
  on((e) => {
    if (e.type === "doc") build(e.keepView);
    else if (e.type === "change" || e.type === "live") {
      if (e.undo || pagesChanged()) { build(true); return; }
      redrawObjects(e.pages);
    } else if (e.type === "select") redrawObjects("all");
  });
  new ResizeObserver(() => { if (state.fit) fitWidth(); }).observe(root);
  return root;
}

// The page list (ids, rotations, sizes) as last built; a different list means a rebuild.
let builtKey = "";
const keyOf = () => state.pages.map((p) => `${p.id}:${p.rotate}`).join("|");
const pagesChanged = () => keyOf() !== builtKey;

function build(keepView) {
  const keepTop = keepView ? root.scrollTop : 0;
  for (const v of views.values()) { v.task?.cancel?.(); io.unobserve(v.outer); }
  const old = new Map(views);
  views.clear();
  column.replaceChildren();
  builtKey = keyOf();
  if (!state.pages.length) { emit("pages-built"); return; }
  if (!keepView) state.fit = true; // a new document starts fitted to the width (and refits when the view appears)
  if (state.fit) state.zoom = fitZoom();
  state.pages.forEach((p, i) => {
    const prev = old.get(p.id);
    const v = makeView(p, i, prev);
    views.set(p.id, v);
    column.append(v.outer);
    io.observe(v.outer);
  });
  layout();
  root.scrollTop = keepTop;
  if (!keepView) column.classList.add("arrive"), setTimeout(() => column.classList.remove("arrive"), 900);
  emit("pages-built");
}

function makeView(p, i, prev) {
  const outer = el("div.page", { dataset: { id: p.id }, style: { "--i": String(Math.min(i, 8)) } });
  const sheet = el("div.sheet");
  const canvas = prev?.canvas || el("canvas.layer-canvas");
  const text = el("div.textLayer.layer-text");
  const objects = el("div.layer-objects");
  const tool = el("div.layer-tool", { dataset: { page: p.id } });
  const badge = el("div.page-badge", {}, String(i + 1));
  sheet.append(canvas, text, objects);
  const v = { outer, sheet, canvas, text, objects, tool, page: p, renderedAt: prev?.renderedAt || 0, textDone: false, extra: [] };
  for (const make of layerMakers) {
    try { const n = make(p, v); if (n) { sheet.append(n); v.extra.push(n); } } catch (e) { console.error("[viewer] layer failed", e); }
  }
  sheet.append(tool);
  outer.append(sheet, badge);
  drawObjects(v);
  return v;
}

/** Size every page for the current zoom (cheap: CSS only); sharp re-render follows. */
function layout() {
  const z = state.zoom;
  for (const v of views.values()) {
    const p = v.page;
    const s = shownSize(p);
    v.outer.style.width = `${s.w * z}px`;
    v.outer.style.height = `${s.h * z}px`;
    v.sheet.style.width = `${p.w * z}px`;
    v.sheet.style.height = `${p.h * z}px`;
    v.sheet.style.setProperty("--total-scale-factor", String(z));
    v.sheet.style.setProperty("--z", String(z));
    const r = ((p.rotate % 360) + 360) % 360;
    v.sheet.style.transform = `translate(-50%, -50%) rotate(${r}deg)`;
    drawObjects(v);
  }
  column.style.gap = `${GAP}px`;
  emit("zoom", { zoom: z });
}

function onSeen(entries) {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const v = views.get(en.target.dataset.id);
    if (v && v.renderedAt !== state.zoom) queue(v);
  }
}

function queue(v) {
  if (!renderQueue.includes(v)) renderQueue.push(v);
  pump();
}

async function pump() {
  while (rendering < MAX_PARALLEL && renderQueue.length) {
    const v = renderQueue.shift();
    if (!views.has(v.page.id) || v.renderedAt === state.zoom) continue;
    rendering++;
    renderOne(v).finally(() => { rendering--; pump(); });
  }
}

async function renderOne(v) {
  const p = v.page;
  const file = state.files.get(p.src.fileId);
  if (!file?.pdf) return;
  const z = state.zoom;
  const fresh = el("canvas.layer-canvas");
  try {
    v.task?.cancel?.();
    // Very large zoom: cap the canvas so phones don't run out of memory.
    const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, 4096 / (p.w * z)));
    v.task = await renderPage(file.pdf, p.src.index, fresh, { scale: z, dpr });
    await v.task.promise;
    fresh.style.width = "100%"; fresh.style.height = "100%";
    v.canvas.replaceWith(fresh);
    v.canvas = fresh;
    v.renderedAt = z;
    v.outer.classList.add("ready");
    await renderText(v, file, z);
  } catch (e) {
    if (e?.name !== "RenderingCancelledException") console.error("[viewer] render failed", e);
  }
}

async function renderText(v, file, z) {
  const page = await file.pdf.getPage(v.page.src.index + 1);
  const viewport = page.getViewport({ scale: z, rotation: 0 });
  const text = el("div.textLayer.layer-text");
  const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true }), container: text, viewport });
  await tl.render();
  v.text.replaceWith(text);
  v.text = text;
  v.textDone = true;
}

export function redrawObjects(pages) {
  const ids = pages === "all" || !pages ? [...views.keys()] : pages;
  for (const id of ids) { const v = views.get(id); if (v) drawObjects(v); }
}

/** Throw away a page's picture (its source changed) and draw it again. */
export function rerender(ids) {
  for (const id of ids || views.keys()) { const v = views.get(id); if (v) { v.renderedAt = 0; queue(v); } }
}

function trackCurrent() {
  const mid = root.scrollTop + root.clientHeight / 3;
  let best = 0;
  for (const [i, p] of state.pages.entries()) {
    const v = views.get(p.id);
    if (v && v.outer.offsetTop <= mid) best = i;
  }
  if (best !== current) { current = best; emit("page", { index: current }); }
}

export function scrollToPage(i, { smooth = true } = {}) {
  const p = state.pages[i];
  const v = p && views.get(p.id);
  if (!v) return;
  root.scrollTo({ top: v.outer.offsetTop - 12, behavior: smooth ? "smooth" : "auto" });
  v.outer.classList.remove("flash"); void v.outer.offsetWidth; v.outer.classList.add("flash");
}

// ---- zoom ------------------------------------------------------------------------------------

function fitZoom() {
  if (!root?.clientWidth) return state.zoom || 1; // not on screen yet: the resize observer fits it later
  const w = root.clientWidth - (window.innerWidth < 700 ? 16 : 64);
  const widest = Math.max(...state.pages.map((p) => shownSize(p).w), 1);
  return Math.max(0.2, Math.min(w / widest, 2.2));
}

export function fitWidth() { state.fit = true; setZoom(fitZoom(), { fit: true }); }

let sharpTimer = 0;
/**
 * Zoom to z (CSS pixels per point), keeping the point under (cx, cy) where it is.
 * @param {number} z
 * @param {{ cx?: number, cy?: number, fit?: boolean }} [o] client coordinates of the anchor
 */
export function setZoom(z, o = {}) {
  z = Math.max(0.15, Math.min(6, z));
  if (!o.fit) state.fit = false;
  const old = state.zoom;
  if (Math.abs(z - old) < 1e-4) return;
  const rect = root.getBoundingClientRect();
  const ax = (o.cx ?? rect.left + rect.width / 2) - rect.left;
  const ay = (o.cy ?? rect.top + (o.fit ? 0 : rect.height / 3)) - rect.top; // fitting keeps the top edge still
  const docX = root.scrollLeft + ax, docY = root.scrollTop + ay;
  state.zoom = z;
  layout();
  const k = z / old;
  root.scrollLeft = docX * k - ax;
  root.scrollTop = docY * k - ay;
  clearTimeout(sharpTimer);
  sharpTimer = setTimeout(() => {
    for (const v of views.values()) {
      const r = v.outer.getBoundingClientRect();
      if (r.bottom > -rect.height && r.top < rect.height * 2) queue(v);
      else v.renderedAt = -1; // stale: renders when it comes into view
    }
    for (const v of views.values()) if (v.renderedAt === -1) { io.unobserve(v.outer); io.observe(v.outer); }
  }, 160);
}

export const zoomBy = (f, o) => setZoom(state.zoom * f, o);

function wireZoomGestures() {
  root.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0022), { cx: e.clientX, cy: e.clientY });
  }, { passive: false });
  // Two-finger pinch (touch). One finger scrolls natively, or draws when a tool owns the page.
  const pts = new Map();
  let startDist = 0, startZoom = 1;
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y); startZoom = state.zoom;
      emit("pinch-start");
    }
  });
  root.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && startDist) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(startZoom * (d / startDist), { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) startDist = 0; };
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  // Safari's own pinch events: stop the page zooming, zoom the document instead.
  root.addEventListener("gesturestart", (e) => { e.preventDefault(); startZoom = state.zoom; });
  root.addEventListener("gesturechange", (e) => { e.preventDefault(); setZoom(startZoom * e.scale, { cx: e.clientX, cy: e.clientY }); });
}

// ---- coordinates ----------------------------------------------------------------------------

/** Client (screen) point -> page space (points, unrotated, top-left origin). */
export function toPage(pageId, clientX, clientY) {
  const v = views.get(pageId);
  const p = pageById(pageId);
  if (!v || !p) return { x: 0, y: 0 };
  const r = v.outer.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = clientX - cx, dy = clientY - cy;
  const rot = ((-(p.rotate % 360) + 360) % 360) * Math.PI / 180;
  const ux = dx * Math.cos(rot) - dy * Math.sin(rot);
  const uy = dx * Math.sin(rot) + dy * Math.cos(rot);
  const z = state.zoom;
  return { x: ux / z + p.w / 2, y: uy / z + p.h / 2 };
}

/** The page under a client point, or null. */
export function pageAt(clientX, clientY) {
  const n = document.elementFromPoint(clientX, clientY)?.closest?.(".page");
  return n ? n.dataset.id : null;
}
