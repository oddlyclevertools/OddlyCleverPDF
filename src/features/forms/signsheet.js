// The signature sheet: Draw, Type or Upload, plus your saved ones. Resolves with a picture
// { url, w, h, id? } or null when closed. Saved pictures only ever live on this device.
import { el, icon, modal } from "../../ui/kit.js";
import { makePad } from "./signpad.js";
import { typedSignature, photoSignature, canvasToSig, TYPE_STYLES } from "./sigimg.js";
import { listSaved, saveItem, deleteItem } from "./sigstore.js";

const INKS = [["#111111", "Black"], ["#1f4fd8", "Blue"]];

export function openSignSheet({ kind = "signature" } = {}) {
  const word = kind === "initials" ? "initials" : "signature";
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (done) return; done = true; resolve(v); close?.(); };
    let closeFn = null;
    let tab = "draw", ink = INKS[0][0], remember = true;
    let typed = null, photo = null, photoFile = null, cleanup = 0.5;

    // ---- draw
    const pad = makePad({ color: ink, onInk: () => refresh() });
    const clearBtn = el("button.btn.small.fs-clear", { type: "button", on: { click: () => pad.clear() } }, icon("Eraser", 16), "Clear");
    const drawPane = el("div.fs-pane", {}, pad.node, el("div.row.between", {}, inkRow((c) => pad.setColor(c)), clearBtn));

    // ---- type
    const nameIn = el("input.input.fs-name", { type: "text", maxLength: 40, placeholder: kind === "initials" ? "Your initials" : "Type your full name", "aria-label": `Type your ${word}`, autocomplete: "off",
      on: { input: () => renderTyped() } });
    let styleId = TYPE_STYLES[0].id;
    const styleBtns = TYPE_STYLES.map((s) => el("button.fs-style", { type: "button", dataset: { style: s.id }, class: s.id === styleId ? "on" : null,
      on: { click: () => { styleId = s.id; styleBtns.forEach((b) => b.classList.toggle("on", b.dataset.style === s.id)); renderTyped(); } } },
      el("span.fs-style-name", {}, s.label), el("span.fs-style-text", { style: { fontFamily: s.css.replace(/^.*?px /, ""), fontStyle: s.css.startsWith("italic") ? "italic" : "normal" } }, "Signature")));
    const typedPreview = el("div.fs-typed-preview", {}, "Your name appears here");
    const typePane = el("div.fs-pane", {}, nameIn, el("div.fs-styles", {}, styleBtns), typedPreview, inkRow(() => renderTyped()));
    async function renderTyped() {
      const t = nameIn.value.trim();
      if (!t) { typed = null; typedPreview.replaceChildren("Your name appears here"); refresh(); return; }
      const c = await typedSignature(t, styleId, ink);
      if (nameIn.value.trim() !== t) return;
      typed = c; typedPreview.replaceChildren(c); c.className = "fs-typed-img"; refresh();
    }

    // ---- upload
    const fileIn = el("input", { type: "file", accept: "image/*", hidden: true, on: { change: async () => { photoFile = fileIn.files[0] || null; await renderPhoto(); } } });
    const photoPreview = el("div.fs-photo-preview", {}, "Take a photo of your signature on white paper, or pick one.");
    const clean = el("input", { type: "range", min: 0, max: 1, step: 0.05, value: cleanup, "aria-label": "How much paper to remove", on: { input: () => { cleanup = Number(clean.value); renderPhoto(); } } });
    const upPane = el("div.fs-pane", {}, el("button.btn.fs-pick", { type: "button", on: { click: () => fileIn.click() } }, icon("ImagePlus", 18), "Choose a photo"), fileIn, photoPreview,
      el("label.fs-slider", {}, el("span", {}, "Remove more paper"), clean));
    async function renderPhoto() {
      if (!photoFile) return;
      try { photo = await photoSignature(photoFile, cleanup); photo.className = "fs-typed-img"; photoPreview.replaceChildren(photo); }
      catch { photo = null; photoPreview.replaceChildren("That picture couldn't be read. Try another one."); }
      refresh();
    }

    function inkRow(onPick) {
      const row = el("div.fs-inks", { role: "group", "aria-label": "Ink colour" }, INKS.map(([c, name]) => el("button.fs-ink", { type: "button", title: name, "aria-label": name, class: c === ink ? "on" : null, style: { "--c": c },
        on: { click: () => { ink = c; for (const b of document.querySelectorAll(".fs-ink")) b.classList.toggle("on", b.style.getPropertyValue("--c") === c); onPick(c); } } })));
      return row;
    }

    // ---- tabs + footer
    const panes = { draw: drawPane, type: typePane, upload: upPane };
    const tabs = [["draw", "PenLine", "Draw"], ["type", "Type", "Type"], ["upload", "ImagePlus", "Upload"]];
    const tabBtns = tabs.map(([id, ic, label]) => el("button.fs-tab", { type: "button", role: "tab", dataset: { tab: id }, class: id === tab ? "on" : null, on: { click: () => setTab(id) } }, icon(ic, 18), label));
    const paneBox = el("div.fs-panes", {}, drawPane);
    function setTab(id) {
      tab = id;
      tabBtns.forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
      paneBox.replaceChildren(panes[id]);
      if (id === "type") { nameIn.focus(); renderTyped(); }
      refresh();
    }
    const useBtn = el("button.btn.primary.fs-use", { type: "button", disabled: true, on: { click: () => use() } }, icon("Check", 18), "Use it");
    const rem = el("input", { type: "checkbox", checked: true, on: { change: () => { remember = rem.checked; } } });
    const savedRow = el("div.fs-saved");
    const hasInk = () => (tab === "draw" ? !pad.isEmpty() : tab === "type" ? !!typed : !!photo);
    const refresh = () => { useBtn.disabled = !hasInk(); };

    async function use() {
      const canvas = tab === "draw" ? pad.result() : tab === "type" ? typed : photo;
      if (!canvas) return;
      const pic = canvasToSig(canvas);
      if (remember) pic.id = (await saveItem(kind, pic)).id;
      finish(pic, closeFn);
    }

    async function loadSaved() {
      const items = await listSaved(kind);
      savedRow.replaceChildren();
      if (!items.length) return;
      savedRow.append(el("p.fs-saved-title", {}, `Your saved ${kind === "initials" ? "initials" : "signatures"} (only on this device)`));
      const list = el("div.fs-saved-list");
      for (const it of items) {
        list.append(el("div.fs-saved-item", {},
          el("button.fs-saved-pick", { type: "button", title: `Use this ${word}`, "aria-label": `Use this saved ${word}`, on: { click: () => finish({ url: it.url, w: it.w, h: it.h, id: it.id }, closeFn) } }, el("img", { src: it.url, alt: "" })),
          el("button.fs-saved-del", { type: "button", title: "Delete it from this device", "aria-label": "Delete this saved one", on: { click: async () => { await deleteItem(it.id); loadSaved(); } } }, icon("Trash2", 15))));
      }
      savedRow.append(list);
    }

    const body = el("div.fs-sheet", { dataset: { kind } },
      el("div.fs-tabs", { role: "tablist" }, tabBtns), paneBox, savedRow,
      el("label.fs-remember", {}, rem, el("span", {}, "Remember it on this device")),
      el("div.row.end.fs-foot", {}, el("button.btn", { type: "button", on: { click: () => finish(null, closeFn) } }, "Cancel"), useBtn));
    const m = modal(kind === "initials" ? "Add your initials" : "Add your signature", body, { onClose: () => finish(null) });
    closeFn = m.close;
    loadSaved();
    // for tests and the screenshot
    openSignSheet.last = { pad, setTab, nameIn, renderTyped, use, body, setName: async (t) => { nameIn.value = t; await renderTyped(); } };
  });
}
