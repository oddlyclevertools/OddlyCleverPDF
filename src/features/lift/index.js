// Move pictures and shapes (CSS prefix .lf-): pick up the page's own pictures and drawn shapes
// (icons, logos, lines, boxes) and turn them into edits the Select tool can move. Finding and
// cutting them out of the page is core/lift.js; saving them back is export.js (drawLifted).
import "./lift.css";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { findItems, cutItem, only, setContent } from "../../core/lift.js";
import { el, toast } from "../../ui/kit.js";
import { bbox } from "../../viewer/objects.js";

export function install(app) {
  const { state, store } = app;
  const docs = new Map(); // fileId -> Promise<PDFDocument> (read only)
  const found = new Map(); // "fileId:index" -> Promise<findItems result | null>
  const ready = new Map(); // the same, once read
  const layers = new Map(); // pageId -> outline layer
  const shownSrc = new Map(); // pageId -> "fileId:index" the page was last drawn from
  let drag = null, hot = null;

  const keyOf = (page) => `${page.src.fileId}:${page.src.index}`;
  const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const readDoc = (f) => { if (!docs.has(f.id)) docs.set(f.id, load(f.bytes)); return docs.get(f.id); };

  /** The pictures and shapes on a page; null when its file is locked or can't be read. */
  function itemsOf(page) {
    const key = keyOf(page);
    if (!found.has(key)) {
      const f = state.files.get(page.src.fileId);
      found.set(key, (async () => {
        if (!f || f.password) return null;
        const doc = await readDoc(f);
        if (doc.isEncrypted) return null;
        const res = findItems(doc, page.src.index);
        ready.set(key, res);
        return res;
      })().catch((e) => { console.warn("[lift]", e); return null; }));
    }
    return found.get(key);
  }

  // a 1 pt margin keeps hairlines pickable and gives them a real box
  const padded = (b) => [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1];
  const pageBox = (page, b) => ({ x: b[0] - page.box[0], y: page.box[3] - b[3], w: b[2] - b[0], h: b[3] - b[1] });

  /** The smallest item under a point (page space), from what's already read. */
  function hit(page, pt) {
    const res = ready.get(keyOf(page));
    let best = null, area = Infinity;
    for (const it of res?.items || []) {
      const r = pageBox(page, padded(it.box));
      const pad = 3;
      if (pt.x < r.x - pad || pt.x > r.x + r.w + pad || pt.y < r.y - pad || pt.y > r.y + r.h + pad) continue;
      if (r.w * r.h < area) { best = it; area = r.w * r.h; }
    }
    return best;
  }

  // ---- outlines --------------------------------------------------------------------------------

  async function outline(page) {
    const layer = layers.get(page.id);
    if (!layer) return;
    if (state.tool !== "lift") { layer.replaceChildren(); return; }
    const res = await itemsOf(page);
    if (state.tool !== "lift" || layers.get(page.id) !== layer) return;
    layer.nodes = new Map();
    layer.replaceChildren(...(res?.items || []).map((it) => {
      const r = pageBox(page, padded(it.box));
      const n = el("div.lf-item", { style: { left: `${(r.x / page.w) * 100}%`, top: `${(r.y / page.h) * 100}%`, width: `${(r.w / page.w) * 100}%`, height: `${(r.h / page.h) * 100}%` } });
      layer.nodes.set(it, n);
      return n;
    }));
  }
  const outlineAll = () => { for (const p of state.pages) if (layers.has(p.id)) outline(p); };
  const nodeOf = (pageId, it) => layers.get(pageId)?.nodes?.get(it);

  app.registerLayer((page) => {
    const layer = el("div.lf-layer", { "aria-hidden": "true" });
    layers.set(page.id, layer);
    queueMicrotask(() => outline(page));
    return layer;
  });

  // ---- picking up --------------------------------------------------------------------------------

  /** A sharp transparent picture of just this item, rendered from the page itself. */
  async function picture(f, index, res, item, box) {
    const tmp = await PDFDocument.create();
    const [pg] = await tmp.copyPages(await readDoc(f), [index]);
    tmp.addPage(pg);
    setContent(tmp, 0, only(res.src, res.ops, item.units).text);
    pg.setRotation(degrees(0));
    pg.setMediaBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    pg.setCropBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    const pdf = await app.pdf.openPdf(await tmp.save());
    try {
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: Math.min(6, 2400 / Math.max(box[2] - box[0], box[3] - box[1])) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width)); canvas.height = Math.max(1, Math.ceil(vp.height));
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp, background: "rgba(0,0,0,0)" }).promise;
      return canvas.toDataURL("image/png");
    } finally { pdf.loadingTask.destroy(); }
  }

  /**
   * Take an item off its page and put it back as an edit, moved by (dx, dy). The file gets a copy
   * without the item and the pages point at it, so the screen and Save both lose the old one.
   */
  async function liftItem(pageId, item, dx = 0, dy = 0) {
    const page = store.pageById(pageId);
    const f = page && state.files.get(page.src.fileId);
    const res = page && ready.get(keyOf(page));
    if (!res?.items.includes(item)) return null;
    const box = padded(item.box);
    const doc = await load(f.bytes);
    cutItem(doc, page.src.index, res, item);
    const [bytes, url] = await Promise.all([doc.save(), picture(f, page.src.index, res, item, box)]);
    const rec = await app.addPdfBytes(bytes, f.name);
    const r = pageBox(page, box);
    const obj = { id: store.uid(), type: "image", x: r.x + dx, y: r.y + dy, w: r.w, h: r.h, imageId: store.putImage(url), opacity: 1,
      lift: { fileId: f.id, index: page.src.index, units: item.units, box } };
    // shortcut: every pick-up keeps a full copy of the file (memory and autosave); fine for normal
    // PDFs, drop unused copies if people lift dozens of things from very big files
    store.change(item.kind === "picture" ? "Pick up picture" : "Pick up shape", () => {
      for (const p of state.pages) if (p.src.fileId === f.id) p.src = { ...p.src, fileId: rec.id };
      store.pageById(pageId).objects.push(obj);
    });
    return obj;
  }

  /** For other tools: pick up whatever is at a point (page space). Resolves the new edit or null. */
  app.liftAt = async (pageId, pt, move = { x: 0, y: 0 }) => {
    const page = store.pageById(pageId);
    if (!page) return null;
    await itemsOf(page);
    const it = hit(page, pt);
    return it ? liftItem(pageId, it, move.x, move.y) : null;
  };

  // ---- the tool ----------------------------------------------------------------------------------

  /**
   * A press on an edit or on the PDF's words (not a picture or shape): Select moves those, so
   * switch to it and replay the press for it, and the same drag carries on there.
   */
  function handToSelect(page, pt, e) {
    const pad = 4 / state.zoom;
    const onEdit = page.objects.some((o) => {
      if (o.hidden || o.locked) return false;
      const b = bbox(o);
      return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
    });
    const word = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches?.(".textLayer span"));
    if (!onEdit && !word) return false;
    e.stopImmediatePropagation(); // Select would see this press on the tool layer and miss the words
    app.useTool("select");
    (word || e.target).dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType,
      isPrimary: e.isPrimary, button: 0, buttons: 1, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    }));
    return true;
  }
  let handed = false;

  const setHot = (pageId, it) => {
    if (hot) nodeOf(hot.pageId, hot.it)?.classList.remove("lf-hot");
    hot = it ? { pageId, it } : null;
    if (hot) nodeOf(pageId, it)?.classList.add("lf-hot");
  };

  app.registerTool({
    id: "lift", label: "Move pictures and shapes", icon: "Move", mode: "drag", order: 6, key: "m", group: "edit",
    hint: "Drag a picture or shape (dashed outline), words or an edit to move it.",
    enter: () => {
      outlineAll();
      for (const p of state.pages) itemsOf(p).then((res) => { if (res === null && store.pageById(p.id)) toast("This PDF is locked, so its pictures and shapes can't be picked up."); });
    },
    leave: () => setHot(null),
    hover: (h) => { const page = h && store.pageById(h.pageId); setHot(h?.pageId, page && hit(page, h.pt)); },
    down: ({ pageId, pt, e }) => {
      const page = store.pageById(pageId);
      const it = page && hit(page, pt);
      handed = !it && !!page && handToSelect(page, pt, e);
      drag = it ? { pageId, it, start: pt, node: nodeOf(pageId, it) } : null;
      drag?.node?.classList.add("lf-drag");
    },
    move: ({ pt }) => {
      if (!drag?.node) return;
      drag.node.style.transform = `translate(${(pt.x - drag.start.x) * state.zoom}px, ${(pt.y - drag.start.y) * state.zoom}px)`;
    },
    up: async ({ pt }) => {
      const d = drag;
      drag = null;
      if (handed) { handed = false; return; } // Select finished it
      if (!d) { toast("Nothing to move there. Pictures and shapes have a dashed outline; words and edits move too."); return; }
      d.node?.classList.add("lf-busy");
      try {
        const obj = await liftItem(d.pageId, d.it, pt.x - d.start.x, pt.y - d.start.y);
        if (!obj) throw new Error("That picture changed while you were moving it. Try again.");
        store.select([obj.id]);
        app.useTool("select");
      } catch (e) {
        console.error("[lift]", e);
        toast(e?.message?.startsWith("That") ? e.message : "Sorry, that one couldn't be picked up.", { error: true });
        d.node?.classList.remove("lf-drag", "lf-busy");
        if (d.node) d.node.style.transform = "";
      }
    },
    cancel: () => { if (drag?.node) { drag.node.classList.remove("lf-drag"); drag.node.style.transform = ""; } drag = null; },
  });

  // ---- keeping the screen in step ----------------------------------------------------------------

  const stale = new Set();
  let redrawTimer = 0;
  store.on((e) => {
    if (e.type === "doc") { found.clear(); ready.clear(); docs.clear(); shownSrc.clear(); }
    if (e.type === "tool") outlineAll();
    if (e.type !== "change" && e.type !== "doc" && e.type !== "pages-built") return;
    // a pick-up (or its undo) points pages at another copy of the file: draw them again
    for (const p of state.pages) {
      if (shownSrc.has(p.id) && shownSrc.get(p.id) !== keyOf(p)) stale.add(p.id);
      shownSrc.set(p.id, keyOf(p));
    }
    // one redraw after a burst of undos: the viewer keeps whichever of two overlapping renders ends last
    clearTimeout(redrawTimer);
    if (stale.size) redrawTimer = setTimeout(() => { app.viewer.rerender([...stale]); stale.clear(); if (state.tool === "lift") outlineAll(); }, 120);
  });
}
