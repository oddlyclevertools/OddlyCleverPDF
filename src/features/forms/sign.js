// Sign: the tool, its panel, initials, the date stamp and the "Sign here" walk-through.
import { el, icon, toast } from "../../ui/kit.js";
import { openSignSheet } from "./signsheet.js";
import { listSaved, getItem, deleteItem } from "./sigstore.js";
import { fitSize } from "./sigimg.js";
import { thunk } from "./thunk.js";

export const SIGN_WIDTH = 150, INITIALS_WIDTH = 56;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function installSign(app) {
  const { state, store } = app;

  const chosenKey = (kind) => `chosen_${kind}`;
  const chosen = () => app.toolPrefs("sign", {});

  /** The saved one the user chose, or the sheet if none is chosen. */
  async function getPic(kind = "signature", { forceSheet = false } = {}) {
    if (!forceSheet) {
      const it = await getItem(chosen()[chosenKey(kind)]);
      if (it) return it;
    }
    const pic = await openSignSheet({ kind });
    if (pic?.id) app.setToolPrefs("sign", { [chosenKey(kind)]: pic.id });
    return pic;
  }

  /** Put a signature picture on a page. `at` is the centre; `fit` makes it fill a box instead. */
  function place(pageId, pic, at, { width = SIGN_WIDTH, fit = null, sigField = null, label = "Add signature" } = {}) {
    const page = store.pageById(pageId);
    if (!page || !pic) return null;
    let size = fit ? fitSize(pic.w, pic.h, fit.w * 0.94, fit.h * 0.94) : { w: width, h: (width * pic.h) / pic.w };
    if (size.w > page.w * 0.9) size = { w: page.w * 0.9, h: (page.w * 0.9 * size.h) / size.w };
    const cx = fit ? fit.x + fit.w / 2 : at.x, cy = fit ? fit.y + fit.h / 2 : at.y;
    const o = store.addObject(pageId, {
      type: "image", imageId: store.putImage(pic.url), x: clamp(cx - size.w / 2, 0, page.w - size.w), y: clamp(cy - size.h / 2, 0, page.h - size.h), w: size.w, h: size.h,
      ...(sigField ? { sigField } : {}),
    }, label);
    store.select([o.id]);
    thunk(pageId, o.id);
    return o;
  }

  // ---- the tool ------------------------------------------------------------------------------
  app.registerTool({
    id: "sign", label: "Sign", icon: "Signature", mode: "tap", order: 25, key: "g", group: "edit",
    hint: "Tap where you want to sign.",
    enter: () => { if (!app.isPhone() && app.view === "editor") app.openPanel("sign"); },
    tap: async ({ pageId, pt }) => {
      const pic = await getPic("signature");
      if (pic) { place(pageId, pic, pt); renderPanelIfOpen(); }
    },
  });

  // ---- initials and date ----------------------------------------------------------------------
  function placeInitials() {
    app.placeNext({
      label: "Initials",
      make: async ({ pageId, pt }) => {
        const pic = await getPic("initials");
        if (pic) place(pageId, pic, pt, { width: INITIALS_WIDTH, label: "Add initials" });
      },
    });
  }

  const dateText = () => new Date().toLocaleDateString();
  function measure(text, size) {
    const g = document.createElement("canvas").getContext("2d");
    g.font = `${size}px "OC Sans", system-ui, sans-serif`;
    return g.measureText(text).width;
  }
  function placeDate() {
    app.placeNext({
      label: "Date",
      make: ({ pageId, pt }) => {
        const page = store.pageById(pageId);
        const size = 12, text = dateText(), w = Math.ceil(measure(text, size)) + 6, h = size * 1.25;
        const o = store.addObject(pageId, {
          type: "text", x: clamp(pt.x - w / 2, 0, page.w - w), y: clamp(pt.y - h / 2, 0, page.h - h), w, h, text,
          font: "sans", size, color: "#111111", bold: false, italic: false, underline: false, align: "left", lineHeight: 1.25,
        }, "Add date");
        store.select([o.id]);
        thunk(pageId, o.id);
      },
    });
  }

  // ---- Sign here walk-through -----------------------------------------------------------------
  async function signBoxes() { return (await app.fs.widgets()).filter((w) => w.kind === "signature"); }

  function ping(pageId, name) {
    const box = [...document.querySelectorAll(`.fs-layer[data-page="${pageId}"] .fs-box`)].find((b) => b.dataset.field === name);
    if (!box) return;
    box.classList.remove("fs-ping"); void box.offsetWidth; box.classList.add("fs-ping");
  }

  async function signInto(w) {
    const idx = store.pageIndex(w.pageId);
    app.viewer.scrollToPage(idx);
    await new Promise((r) => setTimeout(r, 450));
    ping(w.pageId, w.name);
    const pic = await getPic("signature");
    if (!pic) return false;
    place(w.pageId, pic, null, { fit: { x: w.x, y: w.y, w: w.w, h: w.h }, sigField: w.name });
    return true;
  }

  async function walkThrough() {
    const boxes = (await signBoxes()).filter((w) => !state.pages.some((p) => p.objects.some((o) => o.sigField === w.name)));
    if (!boxes.length) {
      const any = (await signBoxes()).length;
      toast(any ? "All the signature boxes are signed." : "This PDF has no signature boxes. Tap on the page where you want to sign.", { ms: 4200 });
      if (!any) app.useTool("sign");
      return;
    }
    for (let i = 0; i < boxes.length; i++) {
      toast(`Signature box ${i + 1} of ${boxes.length}`, { ms: 1800 });
      if (!(await signInto(boxes[i]))) return;
      if (i < boxes.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    toast("All signed. Save your PDF when you're ready.", { ms: 4200 });
  }
  document.addEventListener("fs-sign-field", async (e) => {
    const d = e.detail;
    const pic = await getPic("signature");
    if (pic) place(d.pageId, pic, null, { fit: d.rect, sigField: d.name });
  });
  app.fs.signHere = walkThrough;
  app.fs.getSignature = getPic;
  app.fs.placeSignature = place;

  // ---- the panel -----------------------------------------------------------------------------
  let panelBox = null;
  const renderPanelIfOpen = () => { if (panelBox?.isConnected && app.currentPanel() === "sign") renderPanel(panelBox); };

  async function savedList(kind, box) {
    const items = await listSaved(kind);
    const pick = chosen()[chosenKey(kind)];
    if (!items.length) { box.append(el("p.muted.fs-none", {}, kind === "initials" ? "No initials saved yet." : "No signature saved yet.")); return; }
    const row = el("div.fs-saved-list");
    for (const it of items) {
      row.append(el("div.fs-saved-item", { class: it.id === pick ? "on" : null },
        el("button.fs-saved-pick", { type: "button", title: it.id === pick ? "This one is in use" : "Use this one", on: { click: () => { app.setToolPrefs("sign", { [chosenKey(kind)]: it.id }); renderPanelIfOpen(); } } }, el("img", { src: it.url, alt: "" })),
        el("button.fs-saved-del", { type: "button", title: "Delete it from this device", "aria-label": "Delete this saved one", on: { click: async () => { await deleteItem(it.id); if (it.id === pick) app.setToolPrefs("sign", { [chosenKey(kind)]: null }); renderPanelIfOpen(); } } }, icon("Trash2", 15))));
    }
    box.append(row);
  }

  function renderPanel(box) {
    panelBox = box;
    box.replaceChildren();
    const sigs = el("div.fs-psec"), inis = el("div.fs-psec");
    box.append(
      el("p.muted", {}, "Tap the page to place your signature. Your saved ones stay on this device only."),
      el("h4.fs-ph", {}, "Your signature"), sigs,
      el("div.row", {},
        el("button.btn.small", { type: "button", on: { click: async () => { const pic = await getPic("signature", { forceSheet: true }); if (pic) { toast("Saved. Tap the page to place it."); } renderPanelIfOpen(); } } }, icon("PenLine", 16), "Make a new one"),
        chosen()[chosenKey("signature")] ? el("button.btn.small.ghost", { type: "button", on: { click: () => { app.setToolPrefs("sign", { [chosenKey("signature")]: null }); renderPanelIfOpen(); } } }, "Ask me each time") : null),
      el("h4.fs-ph", {}, "Your initials"), inis,
      el("div.row", {}, el("button.btn.small", { type: "button", on: { click: () => placeInitials() } }, icon("CaseUpper", 16), "Add initials"),
        el("button.btn.small.ghost", { type: "button", on: { click: async () => { await getPic("initials", { forceSheet: true }); renderPanelIfOpen(); } } }, "Make new initials")),
      el("h4.fs-ph", {}, "Quick extras"),
      el("div.row", {}, el("button.btn.small", { type: "button", on: { click: () => placeDate() } }, icon("CalendarDays", 16), `Add today's date`),
        el("button.btn.small", { type: "button", on: { click: () => walkThrough() } }, icon("MapPin", 16), "Sign here, step by step")));
    savedList("signature", sigs);
    savedList("initials", inis);
    signBoxes().then((b) => { if (b.length && box.isConnected) box.prepend(el("p.fs-found", {}, icon("Info", 16), `This PDF has ${b.length} signature box${b.length > 1 ? "es" : ""}. Use "Sign here, step by step".`)); });
  }

  app.registerPanel({ id: "sign", title: "Sign", label: "Sign", icon: "Signature", order: 25, belt: false, render: renderPanel });

  // ---- home tasks and commands ---------------------------------------------------------------
  const openDoc = async (a, files) => (files?.length ? !!(await a.open(files)) : true);
  app.registerTask({ id: "sign-pdf", title: "Sign a PDF", blurb: "Draw, type or upload your signature", icon: "Signature", color: "mint", group: "edit", popular: true, order: 3, usesOpenDoc: true,
    run: async (a, files) => {
      if (!(await openDoc(a, files))) return;
      if ((await signBoxes()).length) walkThrough(); else a.useTool("sign");
    } });
  app.registerTask({ id: "fill-sign", title: "Fill & sign", blurb: "Fill in the form, then sign it", icon: "ClipboardPenLine", color: "gold", group: "edit", order: 4, usesOpenDoc: true,
    run: async (a, files) => {
      if (!(await openDoc(a, files))) return;
      a.useTool("select");
      setTimeout(async () => { if (await a.fs.fieldCount()) a.fs.nextField(); else a.useTool("sign"); }, 500);
    } });
  app.registerCommands(() => state.pages.length ? [
    { id: "fs:sign", label: "Sign this PDF", group: "Tools", icon: "Signature", keywords: "signature autograph", run: () => app.useTool("sign") },
    { id: "fs:initials", label: "Add my initials", group: "Tools", icon: "CaseUpper", keywords: "sign", run: () => placeInitials() },
    { id: "fs:date", label: "Add today's date", group: "Tools", icon: "CalendarDays", keywords: "stamp", run: () => placeDate() },
    { id: "fs:next", label: "Go to the next form field", group: "Tools", icon: "TextCursorInput", keywords: "fill form", run: () => app.fs.nextField() },
  ] : []);
}
