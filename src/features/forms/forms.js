// Fillable forms: live HTML inputs over each page (the canvas skips the field widgets), the
// "this PDF has fields" banner with Next field, and the Save step that writes the values.
import { el, icon, toast } from "../../ui/kit.js";
import { readWidgets, fillableFields, isEmptyValue, applyFormValues } from "./forms-core.js";

const annotCache = new WeakMap(); // pdf.js doc -> Map(index -> Promise<widgets>)

export function installForms(app) {
  const { state, store } = app;
  const { pdfjs } = app.pdf;
  app.pdf.renderOptions.annotationMode = pdfjs.AnnotationMode.ENABLE_FORMS;

  /** The widgets of one page (page space), read once per source page. */
  const widgetsOf = (page) => {
    const f = state.files.get(page.src.fileId);
    if (!f?.pdf) return Promise.resolve([]);
    let m = annotCache.get(f.pdf);
    if (!m) annotCache.set(f.pdf, m = new Map());
    if (!m.has(page.src.index)) {
      m.set(page.src.index, f.pdf.getPage(page.src.index + 1)
        .then((p) => p.getAnnotations()).then((a) => readWidgets(a, page.box))
        .catch((e) => { console.error("[forms] annotations", e); return []; }));
    }
    return m.get(page.src.index);
  };
  /** Every widget in the document with its page id. */
  const allWidgets = async () => {
    const lists = await Promise.all(state.pages.map(async (p) => (await widgetsOf(p)).map((w) => ({ ...w, pageId: p.id }))));
    return lists.flat();
  };
  app.fs = { ...(app.fs || {}), widgets: allWidgets, widgetsOf };

  // ---- values ---------------------------------------------------------------------------
  const controls = new Set(); // { node, w, pageId }
  const current = (w) => (w.name in state.form ? state.form[w.name] : w.initial);
  const same = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
  const setValue = (w, v) => {
    if (same(current(w), v)) return;
    store.change(`Fill "${w.name}"`, () => { state.form[w.name] = v; }, { pages: [] });
  };

  function paint(c) {
    const { node, w } = c;
    const v = current(w);
    if (w.kind === "checkbox") node.checked = !!v;
    else if (w.kind === "radio") node.checked = v === w.buttonValue;
    else if (w.kind === "list") for (const o of node.options) o.selected = [].concat(v || []).includes(o.value);
    else if (node.value !== String(v ?? "")) node.value = String(v ?? "");
    node.parentElement?.classList.toggle("fs-filled", !isEmptyValue(v) && !(w.kind === "radio" && v !== w.buttonValue));
  }
  function repaint() {
    for (const c of [...controls]) {
      if (!c.node.isConnected) { controls.delete(c); continue; }
      if (c.w.kind === "signature") { c.node.classList.toggle("fs-signed", state.pages.some((p) => p.objects.some((o) => o.sigField === c.w.name))); continue; }
      if (document.activeElement === c.node && c.node.matches("input[type=text],textarea,input[type=password]")) continue;
      paint(c);
    }
    updateBanner();
  }
  store.on((e) => { if (e.type === "change") repaint(); else if (e.type === "doc") { controls.clear(); updateBanner(); } });

  // ---- one control -----------------------------------------------------------------------
  function makeControl(w, pageId) {
    const pt = w.fontSize > 0 ? w.fontSize : w.multiLine ? 12 : Math.max(7, Math.min(12, w.h * 0.62));
    const box = el("div.fs-box", { dataset: { kind: w.kind, field: w.name }, style: {
      left: `calc(${w.x}px * var(--z, 1))`, top: `calc(${w.y}px * var(--z, 1))`,
      width: `calc(${w.w}px * var(--z, 1))`, height: `calc(${w.h}px * var(--z, 1))`,
      fontSize: `calc(${pt}px * var(--z, 1))`,
    } });
    let node;
    if (w.kind === "text") {
      node = w.multiLine ? el("textarea.fs-input", { spellcheck: true }) : el("input.fs-input", { type: w.password ? "password" : "text", autocomplete: "off" });
      if (w.maxLen) node.maxLength = w.maxLen;
      node.style.textAlign = w.align;
      if (w.comb && w.maxLen) node.style.letterSpacing = `calc(${(w.w / w.maxLen) * 0.4}px * var(--z, 1))`;
      node.addEventListener("change", () => setValue(w, node.value));
    } else if (w.kind === "checkbox") {
      node = el("input.fs-check", { type: "checkbox" });
      node.addEventListener("change", () => { setValue(w, node.checked); if (node.checked) { node.classList.remove("fs-pop"); void node.offsetWidth; node.classList.add("fs-pop"); } });
    } else if (w.kind === "radio") {
      node = el("input.fs-radio", { type: "radio", name: `fs-r-${w.name}` });
      node.addEventListener("change", () => { if (node.checked) setValue(w, w.buttonValue); });
    } else if (w.kind === "dropdown" || w.kind === "list") {
      node = el("select.fs-input", { multiple: w.kind === "list" || w.multiSelect });
      if (w.kind === "dropdown") node.append(el("option", { value: "" }, ""));
      for (const o of w.options) node.append(el("option", { value: o.value }, o.label));
      if (w.kind === "dropdown" && current(w) && !w.options.some((o) => o.value === current(w))) node.append(el("option", { value: current(w) }, current(w)));
      node.addEventListener("change", () => setValue(w, w.kind === "list" ? [...node.selectedOptions].map((o) => o.value) : node.value));
    } else if (w.kind === "signature") {
      node = el("button.fs-sig", { type: "button", title: "Sign here", on: { click: () => document.dispatchEvent(new CustomEvent("fs-sign-field", { detail: { pageId, name: w.name, rect: { x: w.x, y: w.y, w: w.w, h: w.h } } })) } }, icon("PenLine", 14), el("span", {}, "Sign here"));
      box.append(node);
      controls.add({ node, w, pageId });
      return box;
    } else return null;
    node.setAttribute("aria-label", w.name);
    node.title = w.name;
    if (w.readOnly) { node.disabled = true; box.classList.add("fs-ro"); }
    box.append(node);
    const c = { node, w, pageId };
    controls.add(c);
    paint(c);
    return box;
  }

  app.registerLayer((page) => {
    const layer = el("div.fs-layer", { dataset: { page: page.id } });
    widgetsOf(page).then((list) => {
      for (const w of list) { const n = makeControl(w, page.id); if (n) layer.append(n); }
      repaint();
    });
    return layer;
  });

  // ---- banner ------------------------------------------------------------------------------
  let banner = null, dismissedFor = "";
  const docKey = () => [...state.files.keys()].join(",");
  const bannerText = el("span.fs-banner-text");
  const flat = el("input", { type: "checkbox", id: "fs-flat", on: { change: () => store.change("Lock answers", () => { state.extras.forms = { ...(state.extras.forms || {}), flatten: flat.checked }; }, { pages: [] }) } });
  const nextBtn = el("button.btn.small.primary.fs-next", { type: "button", on: { click: () => nextField() } }, "Next field", icon("ArrowRight", 16));
  const closeBtn = el("button.icon-btn.fs-x", { type: "button", "aria-label": "Hide this", title: "Hide", on: { click: () => { dismissedFor = docKey(); banner.classList.remove("show"); } } }, icon("X", 16));

  async function updateBanner() {
    const host = document.querySelector(".work");
    if (!host) return;
    if (!banner) {
      banner = el("div.fs-banner", { role: "status" }, icon("TextCursorInput", 20), bannerText, nextBtn,
        el("label.fs-flat", { for: "fs-flat", title: "Turn the fields into plain text on the page, so nobody can change them" }, flat, el("span", {}, "Lock answers when I save")), closeBtn);
      host.append(banner);
    }
    const fields = fillableFields(await allWidgets());
    if (!fields.length || !state.pages.length || dismissedFor === docKey()) { banner.classList.remove("show"); return; }
    const left = fields.filter((f) => isEmptyValue(f.name in state.form ? state.form[f.name] : f.initial)).length;
    bannerText.textContent = left === fields.length
      ? `This PDF has ${fields.length} field${fields.length > 1 ? "s" : ""} to fill.`
      : left ? `${left} of ${fields.length} fields still to fill.` : "All fields are filled in. Nice!";
    nextBtn.hidden = !left;
    flat.checked = !!state.extras.forms?.flatten;
    banner.classList.add("show");
  }
  store.on((e) => { if (e.type === "pages-built") updateBanner(); });

  /** Jump to the next empty field after the one in focus. */
  function nextField() {
    const list = [...controls].filter((c) => c.node.isConnected && c.w.kind !== "signature" && !c.w.readOnly);
    list.sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const empty = (c) => isEmptyValue(current(c.w)) && !(c.w.kind === "radio" && list.some((o) => o.w.name === c.w.name && current(o.w) === o.w.buttonValue));
    const at = list.findIndex((c) => c.node === document.activeElement);
    const order = [...list.slice(at + 1), ...list.slice(0, at + 1)];
    const seen = new Set();
    const hit = order.find((c) => { if (!empty(c) || seen.has(c.w.name)) return false; seen.add(c.w.name); return true; });
    if (!hit) { toast("Every field is filled in. Save your PDF when you're ready."); return; }
    hit.node.scrollIntoView({ block: "center", behavior: "smooth" });
    hit.node.focus({ preventScroll: true });
    const box = hit.node.parentElement;
    box.classList.remove("fs-ping"); void box.offsetWidth; box.classList.add("fs-ping");
  }
  app.fs.nextField = nextField;
  app.fs.fieldCount = async () => fillableFields(await allWidgets()).length;

  // ---- Save ----------------------------------------------------------------------------------
  app.registerExportStep({
    id: "forms", label: "Filling in your form", order: 100,
    async run(ctx) {
      const flatten = !!state.extras.forms?.flatten;
      if (!Object.keys(state.form).length && !flatten) return;
      const form = ctx.doc.getForm();
      if (!form.getFields().length) return;
      const { skipped } = applyFormValues(form, state.form);
      try { form.updateFieldAppearances(); }
      catch { form.updateFieldAppearances(await ctx.font("sans", false, false)); } // letters Helvetica can't draw
      if (flatten) {
        try { form.flatten(); } catch (e) { ctx.notes.push("The form couldn't be flattened, so it stays fillable."); console.error("[forms] flatten", e); }
      }
      if (skipped.length) console.warn("[forms] skipped", skipped);
    },
  });
}
