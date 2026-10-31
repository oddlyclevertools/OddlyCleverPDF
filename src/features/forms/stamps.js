// Stamps & marks: the picker (tick, cross, dot, line and rubber-stamp badges) and the tool.
import { el, icon, modal, toast } from "../../ui/kit.js";
import { BADGES, STAMP_COLORS, stampSvg, svgDataUrl, stampPng, MARKS, markObject } from "./stampart.js";
import { thunk } from "./thunk.js";

export const STAMP_WIDTH = 140;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function installStamps(app) {
  const { store } = app;
  const prefs = () => app.toolPrefs("stamp", { choice: null, color: STAMP_COLORS[0][0], custom: "" });
  const textPrefs = () => app.toolPrefs("text", { size: 14, color: "#111111" });

  /** Put the current choice on a page, centred on pt. */
  async function place(pageId, pt, choice = prefs().choice) {
    const page = store.pageById(pageId);
    if (!page || !choice) return null;
    let o;
    if (choice.kind === "mark") {
      const tp = textPrefs();
      const size = Math.max(10, tp.size || 14);
      const obj = markObject(choice.id, clamp(pt.x, 6, page.w - 6), clamp(pt.y, 6, page.h - 6), size, tp.color || "#111111");
      o = store.addObject(pageId, obj, `Add ${MARKS[choice.id].label.toLowerCase()}`);
    } else {
      const pic = await stampPng(choice.text, choice.color);
      const w = Math.min(STAMP_WIDTH * (choice.text.length > 10 ? 1.25 : 1), page.w * 0.8), h = (w * pic.h) / pic.w;
      o = store.addObject(pageId, {
        type: "image", imageId: store.putImage(pic.url), x: clamp(pt.x - w / 2, 0, page.w - w), y: clamp(pt.y - h / 2, 0, page.h - h), w, h, stamp: choice.text,
      }, `Add ${choice.text.toLowerCase()} stamp`);
    }
    store.select([o.id]);
    thunk(pageId, o.id);
    return o;
  }

  /** The picker, used in the side panel and in a pop-up on phones. */
  function renderPicker(box, onPick) {
    box.replaceChildren();
    const p = prefs();
    const sel = p.choice;
    const markRow = el("div.fs-marks", { role: "group", "aria-label": "Marks" }, Object.entries(MARKS).map(([id, m]) =>
      el("button.fs-mark", { type: "button", title: m.label, "aria-label": m.label, dataset: { mark: id }, class: sel?.kind === "mark" && sel.id === id ? "on" : null,
        on: { click: () => onPick({ kind: "mark", id }) } }, m.glyph)));
    const colors = el("div.fs-inks", { role: "group", "aria-label": "Stamp colour" }, STAMP_COLORS.map(([c, name]) =>
      el("button.fs-ink", { type: "button", title: name, "aria-label": name, class: c === p.color ? "on" : null, style: { "--c": c },
        on: { click: () => { app.setToolPrefs("stamp", { color: c }); renderPicker(box, onPick); } } })));
    const grid = el("div.fs-badges", {}, BADGES.map((t) =>
      el("button.fs-badge", { type: "button", title: t, "aria-label": `${t} stamp`, dataset: { badge: t }, class: sel?.kind === "badge" && sel.text === t && sel.color === p.color ? "on" : null,
        on: { click: () => onPick({ kind: "badge", text: t, color: p.color }) } }, el("img", { src: svgDataUrl(stampSvg(t, p.color).svg), alt: "" }))));
    const custom = el("input.input.fs-custom", { type: "text", maxLength: 24, placeholder: "Your own words", "aria-label": "Your own stamp text", value: p.custom || "",
      on: { input: () => app.setToolPrefs("stamp", { custom: custom.value }), keydown: (e) => { if (e.key === "Enter") useCustom(); } } });
    const useCustom = () => { const t = custom.value.trim(); if (t) onPick({ kind: "badge", text: t, color: prefs().color }); else custom.focus(); };
    box.append(
      el("h4.fs-ph", {}, "Marks for paper forms"), markRow,
      el("h4.fs-ph", {}, "Stamps"), colors, grid,
      el("h4.fs-ph", {}, "Your own stamp"), el("div.row.fs-customrow", {}, custom, el("button.btn.small", { type: "button", on: { click: useCustom } }, "Use")));
  }

  const choose = (choice) => {
    app.setToolPrefs("stamp", { choice });
    if (app.state.tool !== "stamp") app.useTool("stamp");
    toast(choice.kind === "mark" ? "Tap the page to put it down." : `Tap the page to stamp ${choice.text}.`, { ms: 2200 });
  };

  app.registerTool({
    id: "stamp", label: "Stamp", icon: "Stamp", mode: "tap", order: 26, key: "k", group: "edit",
    hint: "Tap the page to stamp or tick.",
    enter: () => { if (!app.isPhone() && app.view === "editor") app.openPanel("stamp"); },
    tap: ({ pageId, pt }) => {
      if (prefs().choice) { place(pageId, pt); return; }
      const m = modal("Pick a stamp", (close) => {
        const box = el("div.fs-picker");
        renderPicker(box, (c) => { app.setToolPrefs("stamp", { choice: c }); close(); place(pageId, pt, c); });
        return box;
      });
      return m;
    },
  });

  app.registerPanel({
    id: "stamp", title: "Stamps & marks", label: "Stamp", icon: "Stamp", order: 26, belt: false,
    render: (box) => {
      const body = el("div.fs-picker");
      box.append(el("p.muted", {}, "Pick one, then tap the page. Ticks and crosses match your text size."), body);
      const onPick = (c) => { choose(c); renderPicker(body, onPick); };
      renderPicker(body, onPick);
    },
  });
  app.fs.placeStamp = place;
  app.registerCommands(() => app.state.pages.length ? [{ id: "fs:stamp", label: "Stamps and ticks", group: "Tools", icon: "Stamp", keywords: "approved paid draft tick cross", run: () => app.useTool("stamp") }] : []);
}
