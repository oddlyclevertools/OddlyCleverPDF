// Select: press an edit to pick it, drag to move, pull a corner to resize, drag a line's ends,
// double-press text to type. Presses on the page itself fall through to the PDF's own text, so
// you can select and copy it. Keyboard: Delete, Ctrl+D, Ctrl+C/V, arrows, Esc.
import { state, findObject, begin, end, live, select, removeObjects, change, uid, pageById, emit } from "../core/store.js";
import { toPage, viewOf, currentIndex } from "../viewer/viewer.js";
import { bbox, resizable } from "../viewer/objects.js";
import { registerTool } from "./registry.js";

registerTool({ id: "select", label: "Select", icon: "MousePointer2", mode: "none", order: 0, key: "v", hint: "Pick an edit to move or change it. Press the page to select its text." });

const HANDLE = 14; // px

/** The topmost object at a page point, and which handle (if any). */
function hit(pageId, pt, clientX, clientY) {
  const page = pageById(pageId);
  if (!page) return null;
  const z = state.zoom, tol = HANDLE / z;
  // handles of the current selection first
  if (state.selection.length === 1) {
    const f = findObject(state.selection[0]);
    if (f && f.page.id === pageId) {
      const o = f.obj;
      if (o.type === "line" || o.type === "arrow") {
        if (Math.hypot(pt.x - o.x1, pt.y - o.y1) < tol) return { obj: o, handle: "p1" };
        if (Math.hypot(pt.x - o.x2, pt.y - o.y2) < tol) return { obj: o, handle: "p2" };
      } else if (resizable(o)) {
        const b = bbox(o);
        const n = viewOf(pageId)?.objects.querySelector(`[data-id="${o.id}"]`);
        const h = o.type === "text" && n ? Math.max(b.h, n.offsetHeight / z) : b.h;
        for (const [name, hx, hy] of [["nw", b.x, b.y], ["ne", b.x + b.w, b.y], ["sw", b.x, b.y + h], ["se", b.x + b.w, b.y + h]]) {
          if (Math.abs(pt.x - hx) < tol && Math.abs(pt.y - hy) < tol) return { obj: o, handle: name };
        }
      }
    }
  }
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    let b = bbox(o);
    if (o.type === "text") { const n = viewOf(pageId)?.objects.querySelector(`[data-id="${o.id}"]`); if (n) b = { ...b, h: Math.max(b.h, n.offsetHeight / z) }; }
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
  if (state.tool !== "select" || e.button > 0) return;
  const pageEl = e.target.closest?.(".page");
  if (!pageEl) return;
  if (e.target.closest?.("[contenteditable=true]")) return; // typing
  const pageId = pageEl.dataset.id;
  const pt = toPage(pageId, e.clientX, e.clientY);
  const h = hit(pageId, pt, e.clientX, e.clientY);
  if (!h) {
    if (state.selection.length) select([]);
    return; // native text selection
  }
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  if (!state.selection.includes(h.obj.id) || h.handle == null) {
    if (e.shiftKey) select([...state.selection, h.obj.id]); else if (!state.selection.includes(h.obj.id)) select([h.obj.id]);
  }
  const objs = state.selection.map((id) => findObject(id)?.obj).filter(Boolean);
  drag = { pageId, start: pt, handle: h.handle, obj: h.obj, orig: JSON.parse(JSON.stringify(objs)), objs, id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY, t: Date.now() };
  pageEl.setPointerCapture?.(e.pointerId);
  begin();
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  const pt = toPage(drag.pageId, e.clientX, e.clientY);
  const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
  const o = drag.obj, oo = drag.orig.find((x) => x.id === o.id);
  if (drag.handle === "p1" || drag.handle === "p2") {
    const k = drag.handle === "p1" ? 1 : 2;
    o[`x${k}`] = oo[`x${k}`] + dx; o[`y${k}`] = oo[`y${k}`] + dy;
  } else if (drag.handle) {
    resize(o, oo, drag.handle, dx, dy, e.shiftKey);
  } else {
    drag.objs.forEach((obj, i) => moveBy(obj, drag.orig[i], dx, dy));
  }
  live([drag.pageId]);
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
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
  o.x = orig.x + dx; o.y = orig.y + dy;
  if (o.cover && orig.cover) o.cover = { ...orig.cover, x: orig.cover.x + dx, y: orig.cover.y + dy };
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
    clip = sel.map((id) => JSON.parse(JSON.stringify(findObject(id).obj)));
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
  if (e.key.startsWith("Arrow") && sel.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    change("Nudge", () => { for (const id of sel) { const o = findObject(id)?.obj; if (o) moveBy(o, JSON.parse(JSON.stringify(o)), dx, dy); } });
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
      moveBy(c, f.obj, 14, 14);
      f.page.objects.push(c); out.push(c.id);
    }
  });
  select(out);
}

/** Change the stacking order of the selection: "front" | "back". */
export function arrange(where) {
  change(where === "front" ? "Bring to front" : "Send to back", () => {
    for (const id of state.selection) {
      const f = findObject(id); if (!f) continue;
      const arr = f.page.objects; arr.splice(arr.indexOf(f.obj), 1);
      where === "front" ? arr.push(f.obj) : arr.unshift(f.obj);
    }
  });
}

export function installSelect(column) {
  column.addEventListener("pointerdown", onDown);
  column.addEventListener("pointermove", onMove);
  column.addEventListener("pointerup", onUp);
  column.addEventListener("pointercancel", onUp);
  document.addEventListener("keydown", onKey);
}
