// Select: press an edit to pick it, drag to move (snapping to the page, other edits and the text
// margins; Ctrl moves freely), pull a corner to resize, drag a line's ends, double-press text to type.
// Pressing the PDF's own words and dragging lifts that line into an edit and moves it (Alt-drag
// selects the words instead; double-click opens them for typing). Hidden and locked edits are
// skipped. Keyboard: Delete, Ctrl+D, Ctrl+C/V, arrows (Shift = 10), Ctrl+] / Ctrl+[ stacking, Esc.
import { state, findObject, begin, end, live, select, removeObjects, change, uid, pageById, emit } from "../core/store.js";
import { toPage, viewOf, currentIndex } from "../viewer/viewer.js";
import { bbox, resizable, setGuides } from "../viewer/objects.js";
import { pageLines } from "../core/text.js";
import { registerTool, toolById } from "./registry.js";
import { unionBox, snapTargets, snapBox, alignDeltas, distributeDeltas, restack } from "../features/layers/logic.js";

registerTool({ id: "select", label: "Select", icon: "MousePointer2", mode: "none", order: 0, key: "v", hint: "Drag anything to move it, even the PDF's own words. Hold Alt to select words instead." });

const HANDLE = 14; // px

/** An object's box, with a text box as tall as its words show on screen. */
function shownBox(pageId, o) {
  const b = bbox(o);
  const n = o.type === "text" && viewOf(pageId)?.objects.querySelector(`[data-id="${o.id}"]`);
  return n ? { ...b, h: Math.max(b.h, n.offsetHeight / state.zoom) } : b;
}

/** The topmost object at a page point, and which handle (if any). The Move tool asks it too. */
export function hit(pageId, pt, coarse) {
  const page = pageById(pageId);
  if (!page) return null;
  const z = state.zoom, tol = (coarse ? HANDLE : HANDLE * 0.6) / z; // a mouse is precise: keep handles off short text
  // handles of the current selection first
  if (state.selection.length === 1) {
    const f = findObject(state.selection[0]);
    if (f && f.page.id === pageId && !f.obj.locked) {
      const o = f.obj;
      if (o.type === "line" || o.type === "arrow") {
        if (Math.hypot(pt.x - o.x1, pt.y - o.y1) < tol) return { obj: o, handle: "p1" };
        if (Math.hypot(pt.x - o.x2, pt.y - o.y2) < tol) return { obj: o, handle: "p2" };
      } else if (resizable(o)) {
        const b = shownBox(pageId, o);
        for (const [name, hx, hy] of [["nw", b.x, b.y], ["ne", b.x + b.w, b.y], ["sw", b.x, b.y + b.h], ["se", b.x + b.w, b.y + b.h]]) {
          if (Math.abs(pt.x - hx) < tol && Math.abs(pt.y - hy) < tol) return { obj: o, handle: name };
        }
      }
    }
  }
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.hidden || o.locked) continue;
    const b = shownBox(pageId, o);
    const pad = (o.type === "line" || o.type === "arrow" || o.type === "ink") ? 6 / z : 0;
    if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) {
      if (o.type === "line" || o.type === "arrow") {
        // distance to the segment
        const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((pt.x - o.x1) * dx + (pt.y - o.y1) * dy) / L));
        if (Math.hypot(pt.x - (o.x1 + t * dx), pt.y - (o.y1 + t * dy)) > Math.max(8 / z, (o.width ?? 2))) continue;
      }
      return { obj: o, handle: null };
    }
  }
  return null;
}

let drag = null;

function onDown(e) {
  if (e.button > 0) return;
  // other tools: only the selection's frame and handles move or resize it (presses elsewhere are the tool's)
  const other = state.tool !== "select";
  if (other && (state.tool !== "lift" || !e.target.closest?.(".sel-frame"))) return; // editing never moves things
  const pageEl = e.target.closest?.(".page");
  if (!pageEl) return;
  if (e.target.closest?.("[contenteditable=true]")) return; // typing
  const pageId = pageEl.dataset.id;
  const pt = toPage(pageId, e.clientX, e.clientY);
  let h = hit(pageId, pt, e.pointerType !== "mouse");
  if (other && !(h && state.selection.includes(h.obj.id))) {
    const f = findObject(state.selection[0]);
    if (!f) return;
    h = { obj: f.obj, handle: null };
  }
  if (!h) {
    if (state.selection.length) select([]);
    if (e.altKey) return; // Alt keeps native text selection
    // the PDF's own words: a drag lifts the line and moves it; else a drag picks up a picture or
    // shape of the PDF's own (no preventDefault: over nothing, it still selects text)
    const words = !!e.target.closest?.(".textLayer span");
    if (words) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      pageEl.setPointerCapture?.(e.pointerId);
    }
    drag = { pageId, start: pt, lift: words ? "words" : "item", id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY };
    return;
  }
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  if (!state.selection.includes(h.obj.id) || h.handle == null) {
    if (e.shiftKey) select([...state.selection, h.obj.id]); else if (!state.selection.includes(h.obj.id)) select([h.obj.id]);
  }
  const objs = state.selection.map((id) => findObject(id)?.obj).filter(Boolean);
  drag = { pageId, start: pt, handle: h.handle, obj: h.obj, orig: JSON.parse(JSON.stringify(objs)), objs: objs.filter((o) => !o.locked), id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY, t: Date.now() };
  pageEl.setPointerCapture?.(e.pointerId);
  begin();
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  drag.last = { clientX: e.clientX, clientY: e.clientY, free: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey };
  if (drag.lift) { drag.lifting ||= lift(drag); return; }
  applyMove(drag, drag.last);
}

function applyMove(d, e) {
  const pt = toPage(d.pageId, e.clientX, e.clientY);
  let dx = pt.x - d.start.x, dy = pt.y - d.start.y;
  const o = d.obj, oo = d.orig.find((x) => x.id === o.id);
  if (d.handle === "p1" || d.handle === "p2") {
    const k = d.handle === "p1" ? 1 : 2;
    o[`x${k}`] = oo[`x${k}`] + dx; o[`y${k}`] = oo[`y${k}`] + dy;
  } else if (d.handle) {
    resize(o, oo, d.handle, dx, dy, e.shiftKey);
  } else {
    if (!e.free && d.objs.length) {
      const box = unionBox(d.orig.filter((x) => d.objs.some((m) => m.id === x.id)).map(bbox));
      const s = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, targetsFor(d), 6 / state.zoom);
      dx += s.dx; dy += s.dy;
      setGuides(d.pageId, s);
    } else setGuides(d.pageId, null);
    d.objs.forEach((obj) => moveBy(obj, d.orig.find((x) => x.id === obj.id), dx, dy));
  }
  if (d.picked) window.getSelection()?.removeAllRanges(); // the press started a native text selection
  live([d.pageId]);
}

/** What a move can snap to: the page, the other visible edits, and the left edges of the PDF's lines. */
function targetsFor(d) {
  if (d.targets) return d.targets;
  const page = pageById(d.pageId), moving = new Set(d.objs.map((o) => o.id));
  if (!d.lineXs) { d.lineXs = []; pageLines(d.pageId).then((ls) => { d.lineXs = ls.map((l) => l.x); d.targets = null; }); }
  return (d.targets = snapTargets(page, page.objects.filter((o) => !o.hidden && !moving.has(o.id)).map(bbox), d.lineXs));
}

/**
 * Turn what was pressed into an edit and carry on the drag with it: a PDF line becomes edited text
 * (via the Edit text tool), a picture or shape is picked up (via the lift feature's app.liftAt).
 */
async function lift(d) {
  let o = null;
  if (d.lift === "words") {
    const page = pageById(d.pageId);
    const before = new Set(page.objects.map((x) => x.id));
    try { await toolById("edittext")?.tap({ pageId: d.pageId, pt: d.start }); } catch (err) { console.error("[select] lift", err); }
    o = page.objects.find((x) => !before.has(x.id));
    if (!o) return; // no words there, or it reopened an edit that's already there
    await closeTyping(o.id);
  } else {
    // shortcut: reaches the lift feature through the app object; a registry hook would be cleaner if more features need this
    try { o = await window.ocpdf?.liftAt?.(d.pageId, d.start); } catch (err) { console.error("[select] pick up", err); }
    o = o && findObject(o.id)?.obj;
    if (!o) return; // nothing there: the drag was a plain text selection
    d.picked = true;
  }
  Object.assign(d, { lift: false, obj: o, objs: [o], orig: [JSON.parse(JSON.stringify(o))], handle: null });
  select([o.id]);
  begin();
  applyMove(d, d.last);
  if (d.up) finishDrag(d);
}

/** Edit text opens typing a frame or so after it adds the box; close it, we're moving not typing. */
async function closeTyping(id) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const n = document.querySelector(`.layer-objects [data-id="${id}"] [contenteditable=true]`);
    if (n) { n.blur(); return; }
  }
}

let lastWord = { t: 0, x: 0, y: 0 };

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.lift) {
    if (d.lifting) { d.up = true; return; } // finishes once the line or picture is lifted
    if (d.lift !== "words") return;
    // a double-click on the PDF's words opens them for typing
    if (Date.now() - lastWord.t < 450 && Math.hypot(d.sx - lastWord.x, d.sy - lastWord.y) < 8) toolById("edittext")?.tap({ pageId: d.pageId, pt: d.start });
    lastWord = { t: Date.now(), x: d.sx, y: d.sy };
    return;
  }
  finishDrag(d);
}

function finishDrag(d) {
  setGuides(d.pageId, null);
  live([d.pageId]);
  if (d.moved) end(d.handle ? "Resize" : "Move", { pages: [d.pageId] });
  else {
    end("Select");
    // a second press on text starts typing (double-tap on phones, double-click on computers)
    if (d.obj.type === "text" && lastTap.id === d.obj.id && Date.now() - lastTap.t < 450) startTyping(d.obj.id);
    lastTap = { id: d.obj.id, t: Date.now() };
  }
}
let lastTap = { id: "", t: 0 };

/** Move an object by dx, dy from its original copy. */
export function moveBy(o, orig, dx, dy) {
  if ("x1" in o) { o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; return; }
  if (o.strokes) { o.strokes = orig.strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy])); return; }
  if (o.rects) { o.rects = orig.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })); return; }
  o.x = orig.x + dx; o.y = orig.y + dy; // an edited line's cover stays over the old words
}

function resize(o, oo, handle, dx, dy, free) {
  const b = bbox(oo);
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (handle.includes("w")) x0 += dx; else x1 += dx;
  if (handle.includes("n")) y0 += dy; else y1 += dy;
  const keep = (o.type === "image" || o.type === "ink") && !free;
  if (keep && b.w > 0 && b.h > 0) {
    const s = Math.max(Math.abs(x1 - x0) / b.w, Math.abs(y1 - y0) / b.h);
    const w = b.w * s, h = b.h * s;
    if (handle.includes("w")) x0 = x1 - w; else x1 = x0 + w;
    if (handle.includes("n")) y0 = y1 - h; else y1 = y0 + h;
  }
  const nx = Math.min(x0, x1), ny = Math.min(y0, y1), nw = Math.max(4, Math.abs(x1 - x0)), nh = Math.max(4, Math.abs(y1 - y0));
  if (o.type === "ink") {
    const sx = nw / (b.w || 1), sy = nh / (b.h || 1);
    o.strokes = oo.strokes.map((s) => s.map(([x, y]) => [nx + (x - b.x) * sx, ny + (y - b.y) * sy]));
    return;
  }
  o.x = nx; o.y = ny; o.w = nw; o.h = o.type === "text" ? Math.max(nh, (o.size || 14) * 1.2) : nh;
}

// ---- typing into a text box -------------------------------------------------------------------

/** Put the caret in a text object (creates the editable on screen). */
export function startTyping(id, { selectAll = false, fresh = false } = {}) {
  const f = findObject(id);
  if (!f) return;
  const v = viewOf(f.page.id);
  const n = v?.objects.querySelector(`[data-id="${id}"] > .txt`);
  if (!n) return;
  select([id]);
  if (!fresh) begin(); // a fresh box already opened the undo step before it was added
  const wrap = n.parentElement;
  wrap.classList.add("typing");
  try { n.contentEditable = "plaintext-only"; } catch { n.contentEditable = "true"; }
  if (n.contentEditable !== "plaintext-only") n.contentEditable = "true";
  n.setAttribute("contenteditable", "true");
  n.spellcheck = true;
  n.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(n);
  if (!selectAll) r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const onInput = () => {
    f.obj.text = n.innerText.replace(/\n$/, "");
    n.classList.toggle("placeholder", !f.obj.text);
    const z = state.zoom;
    // the text's own height, not the box's (the box has a min-height, so it could only grow)
    f.obj.h = Math.max((f.obj.size || 14) * (f.obj.lineHeight || 1.25), n.offsetHeight / z);
    live([f.page.id]);
  };
  const finish = () => {
    n.removeEventListener("input", onInput);
    n.removeEventListener("blur", finish);
    n.removeEventListener("keydown", keys);
    n.removeAttribute("contenteditable");
    wrap.classList.remove("typing");
    onInput();
    if (!String(f.obj.text || "").trim() && !f.obj.cover) {
      // an empty new box: drop it (and its undo step)
      const p = f.page; p.objects = p.objects.filter((o) => o.id !== id);
      state.selection = [];
      end("Add text");
      emit("select");
      return;
    }
    end(fresh ? "Add text" : f.obj.cover ? "Edit text" : "Type", { pages: [f.page.id] });
  };
  const keys = (e) => {
    // Esc finishes; so does Enter when changing the PDF's own words (Shift+Enter still adds a line)
    if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey && f.obj.cover)) { e.preventDefault(); n.blur(); }
    e.stopPropagation();
  };
  n.addEventListener("input", onInput);
  n.addEventListener("blur", finish);
  n.addEventListener("keydown", keys);
}

// ---- keyboard and clipboard -----------------------------------------------------------------

let clip = null;

function onKey(e) {
  if (e.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
  const mod = e.ctrlKey || e.metaKey;
  const sel = state.selection;
  if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); removeObjects(sel, "Delete"); return; }
  if (e.key === "Escape") { if (sel.length) select([]); return; }
  if (mod && e.key.toLowerCase() === "d" && sel.length) { e.preventDefault(); duplicate(sel); return; }
  if (mod && e.key.toLowerCase() === "c" && sel.length && !String(window.getSelection())) {
    clip = sel.map((id) => { const c = JSON.parse(JSON.stringify(findObject(id).obj)); delete c.cover; return c; });
    return;
  }
  if (mod && e.key.toLowerCase() === "v" && clip) {
    // pictures on the clipboard are handled by the paste event; objects are ours
    e.preventDefault();
    const pageId = state.pages[currentIndex()]?.id;
    if (!pageId) return;
    const ids = [];
    change("Paste", () => {
      const p = pageById(pageId);
      for (const o of clip) { const c = { ...JSON.parse(JSON.stringify(o)), id: uid() }; moveBy(c, o, 12, 12); p.objects.push(c); ids.push(c.id); }
    });
    clip = clip.map((o) => { const c = JSON.parse(JSON.stringify(o)); moveBy(c, o, 12, 12); return c; });
    select(ids);
    return;
  }
  if (mod && (e.code === "BracketRight" || e.code === "BracketLeft") && sel.length) {
    e.preventDefault();
    arrange(e.code === "BracketRight" ? (e.shiftKey ? "front" : "forward") : (e.shiftKey ? "back" : "backward"));
    return;
  }
  if (e.key.startsWith("Arrow") && sel.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    change("Nudge", () => { for (const id of sel) { const o = findObject(id)?.obj; if (o && !o.locked) moveBy(o, JSON.parse(JSON.stringify(o)), dx, dy); } });
    return;
  }
  if (e.key === "Enter" && sel.length === 1 && findObject(sel[0])?.obj.type === "text") { e.preventDefault(); startTyping(sel[0]); }
}

export function duplicate(ids) {
  const out = [];
  change("Duplicate", () => {
    for (const id of ids) {
      const f = findObject(id); if (!f) continue;
      const c = { ...JSON.parse(JSON.stringify(f.obj)), id: uid() };
      delete c.cover; // the copy is new words, there's nothing under it to hide
      moveBy(c, f.obj, 14, 14);
      f.page.objects.push(c); out.push(c.id);
    }
  });
  select(out);
}

const STACK_LABELS = { front: "Bring to front", forward: "Bring forward", backward: "Send backward", back: "Send to back" };
/** Change the stacking order of the selection: "front" | "forward" | "backward" | "back". */
export function arrange(where) {
  change(STACK_LABELS[where], () => { for (const p of state.pages) p.objects = restack(p.objects, state.selection, where); });
}

const ALIGN_LABELS = { left: "Align left", center: "Align centre", right: "Align right", top: "Align top", middle: "Align middle", bottom: "Align bottom", x: "Spread out", y: "Spread out" };
/**
 * Line up the selection (on its page): left | center | right | top | middle | bottom, or spread
 * it out with even gaps: "x" | "y". One edit lines up with the page; several with each other.
 */
export function alignSelection(how) {
  const fs = state.selection.map(findObject).filter((f) => f && !f.obj.locked);
  const page = fs[0]?.page;
  if (!page) return;
  const mine = fs.filter((f) => f.page === page);
  const boxes = mine.map((f) => bbox(f.obj));
  const ds = how === "x" || how === "y" ? distributeDeltas(boxes, how) : alignDeltas(boxes, how, mine.length === 1 ? { x: 0, y: 0, w: page.w, h: page.h } : undefined);
  change(ALIGN_LABELS[how], () => mine.forEach((f, i) => moveBy(f.obj, JSON.parse(JSON.stringify(f.obj)), ds[i].dx, ds[i].dy)), { pages: [page.id] });
}

export function installSelect(column) {
  column.addEventListener("pointerdown", onDown);
  column.addEventListener("pointermove", onMove);
  column.addEventListener("pointerup", onUp);
  column.addEventListener("pointercancel", onUp);
  document.addEventListener("selectstart", (e) => { if (drag && drag.lift !== "item") e.preventDefault(); });
  document.addEventListener("keydown", onKey);
}
