// Layers panel: the current page's edits, top first. Click to select (Shift or Ctrl adds), drag a row
// to restack (Alt+Up/Down from the keyboard), the eye hides, the lock stops moves, double-click
// renames. Each change is one undo step. Array order is stacking order, so saving matches the list.
import "./layers.css";
import { layerName, moveItem } from "./logic.js";

const TYPE_ICONS = {
  text: "Type", image: "Image", rect: "Square", ellipse: "Circle", line: "Minus", arrow: "MoveUpRight", ink: "PenLine",
  highlight: "Highlighter", whiteout: "Eraser", redact: "EyeOff", note: "StickyNote",
};

export function install(app) {
  let box = null;
  const open = () => box?.isConnected && app.currentPanel() === "layers";
  app.registerPanel({ id: "layers", title: "Layers", label: "Layers", icon: "Layers", order: 32, belt: true, render: (b) => { box = b; render(app, b); } });
  app.store.on((e) => {
    if (!open()) return;
    if (e.type === "select") markSelected(app, box); // in place, so a double-click on a row still lands
    else if (["change", "doc", "page"].includes(e.type)) render(app, box);
  });
}

function markSelected(app, box) {
  const page = app.store.pageById(app.currentPageId());
  for (const row of box.querySelectorAll(".ly-row")) {
    const on = !!page && app.state.selection.includes(page.objects[Number(row.dataset.i)]?.id);
    row.classList.toggle("on", on);
    row.querySelector(".ly-pick")?.setAttribute("aria-pressed", String(on));
  }
}

function render(app, box) {
  const { el, icon, store, state } = app;
  const page = store.pageById(app.currentPageId());
  if (box.querySelector(".ly-rename")) return; // don't wipe a name being typed
  box.replaceChildren();
  if (!page) return;
  const n = page.objects.length;
  box.append(el("p.ly-help", {}, `Page ${store.pageIndex(page.id) + 1}. Top of the list is on top. Drag rows to restack.`));
  if (!n) { box.append(el("p.ly-empty", {}, "Nothing here yet. Drag the page's words, or add text, pictures or shapes, and they'll show up here.")); return; }

  // every action looks the edit up again by id: undo swaps in fresh objects
  const act = (label, id, fn) => store.change(label, () => { const f = store.findObject(id); if (f) fn(f.obj, f.page); }, { pages: [page.id] });
  const restack = (from, to) => store.change("Restack", () => { const p = store.pageById(page.id); p.objects = moveItem(p.objects, from, to); }, { pages: [page.id] });

  const list = el("ol.ly-list", { "aria-label": "Layers" });
  page.objects.forEach((o, i) => {
    const on = state.selection.includes(o.id);
    const name = el("span.ly-name", { title: "Double-click to rename" }, layerName(o));
    const row = el(`li.ly-row${on ? ".on" : ""}${o.hidden ? ".off" : ""}`, { dataset: { i: String(i) } },
      el("span.ly-grip", { title: "Drag to restack" }, icon("GripVertical", 15)),
      el("button.ly-pick", { type: "button", "aria-pressed": String(on), title: "Select",
        on: { click: (e) => pick(e, o.id), dblclick: () => rename(o, name), keydown: (e) => keys(e, i) } },
        icon(TYPE_ICONS[o.type] || "Shapes", 15), name),
      el("button.ly-btn", { type: "button", title: o.hidden ? "Show" : "Hide (also left out when you save)", "aria-pressed": String(!!o.hidden),
        on: { click: () => act(o.hidden ? "Show" : "Hide", o.id, (x) => { if (x.hidden) delete x.hidden; else x.hidden = true; }) } }, icon(o.hidden ? "EyeOff" : "Eye", 15)),
      el("button.ly-btn", { type: "button", title: o.locked ? "Unlock" : "Lock (stops moving it by accident)", "aria-pressed": String(!!o.locked),
        on: { click: () => act(o.locked ? "Unlock" : "Lock", o.id, (x) => { if (x.locked) delete x.locked; else x.locked = true; }) } }, icon(o.locked ? "Lock" : "LockOpen", 15)));
    row.addEventListener("pointerdown", (e) => dragRow(e, row, i));
    list.prepend(row); // top of the stack first
  });
  box.append(list);

  function pick(e, id) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) store.select(state.selection.includes(id) ? state.selection.filter((x) => x !== id) : [...state.selection, id]);
    else store.select([id]);
  }

  function keys(e, i) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const to = i + (e.key === "ArrowUp" ? 1 : -1);
    if (to < 0 || to >= n) return;
    restack(i, to);
    box.querySelector(`.ly-row[data-i="${to}"] .ly-pick`)?.focus();
  }

  function rename(o, name) {
    const inp = el("input.ly-rename", { value: o.name || layerName(o), "aria-label": "Layer name" });
    let done = false;
    const save = (keep) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      inp.remove(); // lets the next render through
      if (keep) act("Rename", o.id, (x) => { if (v && v !== layerName({ ...x, name: "" })) x.name = v; else delete x.name; });
      render(app, box);
    };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") save(true); if (e.key === "Escape") save(false); });
    inp.addEventListener("blur", () => save(true));
    name.replaceWith(inp);
    inp.focus(); inp.select();
  }

  // Pointer drag (works with mouse, pen and touch on the grip): a line shows where the row will land.
  function dragRow(e, row, from) {
    if (e.button > 0 || e.target.closest("button:not(.ly-pick), input")) return;
    if (e.pointerType !== "mouse" && !e.target.closest(".ly-grip")) return; // touch: let the list scroll
    const sy = e.clientY;
    let dragging = false, slot = null;
    const mark = el("div.ly-drop");
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId || (!dragging && Math.abs(ev.clientY - sy) < 5)) return;
      if (!dragging) { dragging = true; row.classList.add("dragging"); }
      const rows = [...list.querySelectorAll(".ly-row")];
      const over = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.bottom; }) || rows.at(-1);
      const b = over.getBoundingClientRect(), above = ev.clientY < b.top + b.height / 2, t = Number(over.dataset.i);
      slot = above ? t + 1 : t; // where it goes in the array (the list is drawn top first)
      above ? over.before(mark) : over.after(mark);
    };
    // on window, not the row: the pointer leaves the row as soon as the drag starts
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel);
      mark.remove(); row.classList.remove("dragging");
      if (!dragging || slot == null) return;
      const to = slot - (from < slot ? 1 : 0);
      if (to !== from) restack(from, to);
    };
    const cancel = () => { dragging = false; up(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
  }
}
