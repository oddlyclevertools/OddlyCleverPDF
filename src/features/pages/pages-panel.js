// The Pages panel: a grid of thumbnails you can pick, drag into a new order, turn, copy and delete.
import { el, icon, toast } from "../../ui/kit.js";
import { state, on, shownSize } from "../../core/store.js";
import * as ops from "./ops.js";

// ---- thumbnails: small, lazy, cached by fileId:index -------------------------------------------
const cache = new Map(); // key -> Promise<canvas>
const queue = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}
function thumb(app, page) {
  const key = `${page.src.fileId}:${page.src.index}`;
  if (!cache.has(key)) {
    cache.set(key, new Promise((resolve) => {
      queue.push(async () => {
        try {
          const f = state.files.get(page.src.fileId);
          resolve(await app.pdf.pageToCanvas(f.pdf, page.src.index, { width: 240 }));
        } catch (e) { console.warn("[pages] thumbnail failed", e); resolve(null); }
      });
      pump();
    }));
  }
  return cache.get(key);
}
const BOUND = { w: 100, h: 116 };

export function renderPagesPanel(app, box) {
  box.classList.add("pg-box");
  const tiles = new Map(); // pageId -> element
  let anchor = null;
  let drag = null;

  const hint = el("p.pg-hint.muted.small", {}, "");
  const grid = el("div.pg-grid", { role: "list", "aria-label": "All pages" });
  const bar = el("div.pg-drop", { hidden: true });
  grid.append(bar);
  const btn = (name, label, fn, cls = "") => el(`button.pg-act${cls}`, { type: "button", title: label, on: { click: fn } }, icon(name, 20), el("span", {}, label));
  // always there: add pages
  const adds = el("div.pg-adds", {},
    btn("FilePlus2", "Blank page", async () => {
      const t = ops.indexesOf(ops.targets());
      const id = await ops.insertBlank(app, t.length ? Math.max(...t) : state.pages.length - 1);
      ops.setPicked([id]);
    }, ".pg-add"),
    btn("FilePlus", "Pages from a file", async () => {
      const t = ops.indexesOf(ops.targets());
      const at = ops.picked.size && t.length ? Math.max(...t) + 1 : state.pages.length;
      const ids = await ops.insertFromFiles(app, at);
      if (ids.length) ops.setPicked(ids);
    }, ".pg-add"));
  // only once pages are picked: what to do with them
  const count = el("strong.pg-picked-n", {}, "");
  const allBtn = el("button.btn.small.ghost", { type: "button", on: { click: () => ops.setPicked(state.pages.map((p) => p.id)) } }, "Pick all");
  const picked = el("div.pg-picked", { hidden: true },
    el("div.pg-picked-head", {}, count, allBtn,
      el("button.btn.small.ghost", { type: "button", on: { click: () => ops.setPicked([]) } }, "Clear")),
    el("div.pg-actions", {},
      btn("RotateCw", "Turn", () => ops.rotate(ops.targets(), 90)),
      btn("Copy", "Copy", () => { const m = ops.duplicate(ops.targets()); ops.setPicked(m); }),
      btn("Trash2", "Delete", () => { const t = ops.targets(); if (!ops.remove(t)) toast("A PDF needs at least one page, so I kept one.", { error: true }); }),
      btn("ArrowUpToLine", "Move to start", () => ops.move(ops.targets(), "start")),
      btn("ArrowDownToLine", "Move to end", () => ops.move(ops.targets(), "end")),
      btn("FileOutput", "Save as new PDF", () => ops.extract(app, ops.targets()))));
  box.append(adds, hint, picked, grid);

  // ---- tiles ---------------------------------------------------------------------------------
  function makeTile(page) {
    const canvasHost = el("div.pg-paper");
    const t = el("div.pg-tile.pg-enter", { role: "listitem", tabindex: "0", dataset: { id: page.id } },
      el("div.pg-frame", {}, canvasHost, el("span.pg-check", {}, icon("Check", 14))),
      el("span.pg-num", {}, ""));
    t._paper = canvasHost;
    t._angle = null;
    t._key = "";
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(t, e); }
    });
    t.addEventListener("animationend", () => t.classList.remove("pg-enter"));
    io.observe(t);
    return t;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const t = en.target;
      io.unobserve(t);
      const page = state.pages.find((p) => p.id === t.dataset.id);
      if (page) fill(t, page);
    }
  }, { root: box, rootMargin: "200px" });
  async function fill(t, page) {
    const c = await thumb(app, page);
    if (!c || !t.isConnected) return;
    const copy = el("canvas", { width: c.width, height: c.height });
    copy.getContext("2d").drawImage(c, 0, 0);
    t._paper.replaceChildren(copy);
    t._key = `${page.src.fileId}:${page.src.index}`;
  }
  function update(t, page, i) {
    const fit = Math.min(BOUND.w / shownSize(page).w, BOUND.h / shownSize(page).h);
    t._paper.style.width = `${page.w * fit}px`;
    t._paper.style.height = `${page.h * fit}px`;
    let a = ((page.rotate % 360) + 360) % 360;
    if (t._angle != null) { const d = ((a - t._angle + 540) % 360) - 180; a = t._angle + d; } // turn the short way
    t._angle = a;
    t._paper.style.transform = `translate(-50%, -50%) rotate(${a}deg)`;
    t.querySelector(".pg-num").textContent = String(i + 1);
    t.classList.toggle("on", ops.picked.has(page.id));
    t.setAttribute("aria-label", `Page ${i + 1}${ops.picked.has(page.id) ? ", picked" : ""}`);
    t.setAttribute("aria-selected", String(ops.picked.has(page.id)));
    t.classList.toggle("cur", app.currentPageIndex() === i);
    // the picture may belong to another file now (nothing moves a page between files, but be safe)
    if (t._key && t._key !== `${page.src.fileId}:${page.src.index}`) { t._key = ""; io.observe(t); }
  }

  function sync({ flip = true } = {}) {
    if (!grid.isConnected) return;
    const first = new Map();
    if (flip) for (const [id, t] of tiles) first.set(id, t.getBoundingClientRect());
    const ids = new Set(state.pages.map((p) => p.id));
    for (const [id, t] of tiles) if (!ids.has(id)) { io.unobserve(t); t.remove(); tiles.delete(id); }
    state.pages.forEach((p, i) => {
      let t = tiles.get(p.id);
      if (!t) { t = makeTile(p); tiles.set(p.id, t); }
      update(t, p, i);
      const at = grid.children[i + 1]; // children[0] is the drop bar
      if (at !== t) grid.insertBefore(t, at || null);
    });
    if (flip) {
      for (const [id, t] of tiles) {
        const a = first.get(id);
        if (!a) continue;
        const b = t.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        t.style.transition = "none";
        t.style.transform = `translate(${dx}px, ${dy}px)`;
        void t.offsetWidth;
        t.style.transition = "";
        t.style.transform = "";
      }
    }
    refreshBar();
  }
  function refreshBar() {
    const n = ops.picked.size;
    hint.hidden = !!n;
    hint.textContent = "Tap pages to pick them. Drag a page to move it.";
    picked.hidden = !n;
    count.textContent = `${n} picked`;
    allBtn.hidden = n === state.pages.length;
    for (const [id, t] of tiles) {
      const on = ops.picked.has(id);
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", String(on));
    }
  }

  // ---- pick -----------------------------------------------------------------------------------
  function tap(t, e) {
    const id = t.dataset.id;
    const i = state.pages.findIndex((p) => p.id === id);
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      ops.setPicked(state.pages.slice(a, b + 1).map((p) => p.id));
      return;
    }
    // a tap adds or removes the page, like picking photos on a phone
    const next = new Set(ops.picked);
    next.has(id) ? next.delete(id) : next.add(id);
    anchor = i;
    ops.setPicked(next);
    if (next.has(id)) app.viewer.scrollToPage(i);
  }

  // ---- drag to reorder (pointer events: mouse, pen and touch) ----------------------------------
  let down = null;
  const LONG = 380;
  grid.addEventListener("contextmenu", (e) => { if (e.target.closest(".pg-tile") && (down || drag)) e.preventDefault(); });
  grid.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
  grid.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".pg-tile");
    if (!t || (e.button && e.button > 0)) return;
    down = { t, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", e, timer: null, id: e.pointerId };
    if (down.touch) down.timer = setTimeout(() => { if (down) startDrag(e); }, LONG);
  });
  grid.addEventListener("pointermove", (e) => {
    if (drag) { moveDrag(e); return; }
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) {
      if (down.touch) { clearTimeout(down.timer); down = null; } // the finger is scrolling
      else startDrag(e);
    }
  });
  const end = (e, cancelled) => {
    if (drag) { finishDrag(e, cancelled); return; }
    if (down) {
      clearTimeout(down.timer);
      if (!cancelled && e.type === "pointerup") tap(down.t, e);
      down = null;
    }
  };
  grid.addEventListener("pointerup", (e) => end(e, false));
  grid.addEventListener("pointercancel", (e) => end(e, true));

  function startDrag(e) {
    const t = down.t;
    clearTimeout(down.timer);
    const id = t.dataset.id;
    if (!ops.picked.has(id)) ops.setPicked([id]);
    const ids = state.pages.filter((p) => ops.picked.has(p.id)).map((p) => p.id);
    const r = t.getBoundingClientRect();
    const ghost = t.cloneNode(true);
    ghost.classList.add("pg-ghost");
    ghost.classList.remove("pg-enter");
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    const src = t.querySelectorAll("canvas"), dst = ghost.querySelectorAll("canvas");
    src.forEach((c, k) => dst[k]?.getContext("2d").drawImage(c, 0, 0));
    if (ids.length > 1) ghost.append(el("span.pg-count", {}, String(ids.length)));
    document.body.append(ghost);
    drag = { ids, ghost, w: r.width, h: r.height, to: 0, last: e, timer: null, pid: down.id };
    for (const i of ids) tiles.get(i)?.classList.add("lift");
    try { grid.setPointerCapture(down.id); } catch { /* pointer already gone */ }
    if (navigator.vibrate) navigator.vibrate(12);
    down = null;
    moveDrag(e);
    drag.timer = setInterval(() => autoscroll(drag.last), 30);
  }
  function autoscroll(e) {
    const r = box.getBoundingClientRect();
    if (e.clientY < r.top + 46) box.scrollTop -= 14;
    else if (e.clientY > r.bottom - 46) box.scrollTop += 14;
    place(e);
  }
  function moveDrag(e) {
    drag.last = e;
    drag.ghost.style.transform = `translate(${e.clientX - drag.w / 2}px, ${e.clientY - drag.h / 2}px) rotate(-3deg)`;
    place(e);
  }
  function place(e) {
    const drags = new Set(drag.ids);
    const rest = state.pages.filter((p) => !drags.has(p.id));
    let to = rest.length;
    for (const [k, p] of rest.entries()) {
      const r = tiles.get(p.id).getBoundingClientRect();
      if (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)) { to = k; break; }
    }
    drag.to = to;
    const ref = rest[to] ? tiles.get(rest[to].id) : tiles.get(rest.at(-1)?.id);
    if (!ref) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.style.left = `${(rest[to] ? ref.offsetLeft : ref.offsetLeft + ref.offsetWidth) - 4}px`;
    bar.style.top = `${ref.offsetTop}px`;
    bar.style.height = `${ref.offsetHeight}px`;
  }
  function finishDrag(e, cancelled) {
    clearInterval(drag.timer);
    drag.ghost.remove();
    for (const i of drag.ids) tiles.get(i)?.classList.remove("lift");
    bar.hidden = true;
    const { ids, to } = drag;
    drag = null;
    try { grid.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!cancelled) ops.move(ids, to);
  }

  // ---- stay in step with the document ---------------------------------------------------------------
  const off = on((e) => {
    if (!box.isConnected || ops.picked === null) { off(); return; }
    if (e.type === "doc") { tiles.clear(); grid.replaceChildren(bar); sync({ flip: false }); }
    else if (e.type === "change") sync();
    else if (e.type === "page") for (const [i, p] of state.pages.entries()) tiles.get(p.id)?.classList.toggle("cur", i === e.index);
  });
  const offPick = ops.onPicked(() => { if (!box.isConnected) { offPick(); return; } refreshBar(); });
  sync({ flip: false });
  const cur = tiles.get(state.pages[app.currentPageIndex()]?.id);
  if (cur) setTimeout(() => cur.scrollIntoView({ block: "nearest" }), 60);
}
