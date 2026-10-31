// The Tools panel: one small form per job (merge, split, make smaller, watermark, page numbers,
// header/footer, password, unlock, crop, document info, flatten, redact).
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { zipSync } from "fflate";
import { el, icon, toast, toggle, select, slider, colorRow } from "../../ui/kit.js";
import { state, on, change, putImage } from "../../core/store.js";
import { openPdf } from "../../core/pdf.js";
import { get, set, edit, commit, cropOf } from "./cfg.js";
import * as ops from "./ops.js";
import { parseRanges, everyN, describePages, scopeIndexes, marginsToPage, mmToPt, fmtBytes } from "./logic.js";
import { sweep, lockDoc } from "./steps.js";

const field = (label, ...c) => el("label.pg-field", {}, el("span.pg-label", {}, label), ...c);
function input({ value = "", type = "text", placeholder, onInput, onCommit, min, max, step, cls = "" }) {
  const i = el(`input.input${cls}`, { type, value: String(value), placeholder, min, max, step });
  i.addEventListener("input", () => onInput?.(i.value));
  i.addEventListener("change", () => onCommit?.(i.value));
  return i;
}
const note = (t, cls = "") => el(`p.pg-note.muted.small${cls}`, {}, t);
const bigBtn = (label, ic, fn, cls = "primary") => el(`button.btn.${cls}.pg-go`, { type: "button", on: { click: fn } }, icon(ic, 18), label);

// ---- helpers shared by the sections -----------------------------------------------------------------

/** A toggle for a settings group that also turns itself on when you edit something. */
function group(key, label, chip) {
  const chk = toggle({ label, value: get(key).on, onChange: (v) => { set(key, { on: v }, v ? `Turn on ${chip}` : `Turn off ${chip}`); refreshChips(); } });
  const input = chk.querySelector("input");
  const wake = () => { input.checked = true; };
  return {
    toggle: chk,
    ed(patch) { edit(key, { ...patch, on: true }); wake(); refreshChips(); },
    done(label) { commit(label); },
    put(patch, label) { set(key, { ...patch, on: true }, label); wake(); refreshChips(); },
  };
}
const base = () => (state.name || "document").replace(/\.[a-z0-9]{1,5}$/i, "");

function scopeControls(app, { withPicked = false, extra = [] } = {}) {
  let scope = "all", range = "";
  const rangeIn = input({ placeholder: "For example 1-3, 5", onInput: (v) => { range = v; } });
  rangeIn.hidden = true;
  const opts = [{ value: "all", label: "Every page" }, { value: "current", label: "Just the page I'm on" },
    ...(withPicked ? [{ value: "picked", label: "The pages I picked in Pages" }] : []),
    { value: "odd", label: "Odd pages (1, 3, 5…)" }, { value: "even", label: "Even pages (2, 4, 6…)" }, { value: "range", label: "Pages I type…" }, ...extra];
  const sel = select({ value: scope, options: opts, onChange: (v) => { scope = v; rangeIn.hidden = v !== "range"; } });
  return {
    node: el("div.pg-stack", {}, field("Which pages?", sel), rangeIn),
    indexes: () => {
      if (scope === "range") parseRanges(range, state.pages.length); // throws a friendly message
      return scopeIndexes(scope, range, state.pages.length, { current: app.currentPageIndex(), picked: ops.indexesOf([...ops.picked]) });
    },
  };
}

// ---- sections ---------------------------------------------------------------------------------------

function merge(app, body) {
  const files = new Set(state.pages.map((p) => p.src.fileId)).size;
  body.append(
    note(`This document has ${state.pages.length} page${state.pages.length === 1 ? "" : "s"} from ${files} file${files === 1 ? "" : "s"}. Add more and they join this one.`),
    el("div.pg-btns", {},
      bigBtn("Add files at the end", "FilePlus2", async () => { const f = await app.chooseFiles({ multiple: true }); if (f.length) { await app.open(f, "append"); app.openPanel("doc", { section: "merge" }); } }),
      bigBtn("Add files at the start", "FileInput", async () => { await ops.insertFromFiles(app, 0); app.openPanel("doc", { section: "merge" }); }, "")),
    note("PDFs, pictures, Word, Excel and more all work. Then open Pages to put them in order."),
    bigBtn("Put the pages in order", "LayoutGrid", () => app.openPanel("pages"), "ghost"));
}

function split(app, body) {
  const total0 = state.pages.length, half = Math.ceil(total0 / 2);
  let mode = "ranges", text = total0 > 1 ? `1-${half}, ${half + 1}-` : "1", n = 2, out = "zip";
  const summary = el("p.pg-sum", {});
  const parts = () => {
    const total = state.pages.length;
    if (mode === "each") return everyN(total, 1);
    if (mode === "every") return everyN(total, n);
    return parseRanges(text, total);
  };
  const refresh = () => {
    try {
      const p = parts();
      summary.className = "pg-sum";
      summary.textContent = `That makes ${p.length} file${p.length === 1 ? "" : "s"}: ${p.slice(0, 6).map((x) => `${x.length} page${x.length === 1 ? "" : "s"}`).join(", ")}${p.length > 6 ? "…" : ""}.`;
    } catch (e) { summary.className = "pg-sum bad"; summary.textContent = e.message; }
  };
  const rangeIn = field("Pages for each file (separate files with commas)", input({ value: text, onInput: (v) => { text = v; refresh(); } }));
  const everyIn = field("Pages in each file", input({ type: "number", value: n, min: 1, onInput: (v) => { n = Number(v) || 1; refresh(); } }));
  const show = () => { rangeIn.hidden = mode !== "ranges"; everyIn.hidden = mode !== "every"; refresh(); };
  const modeSel = select({ value: mode, options: [{ value: "ranges", label: "By page ranges" }, { value: "every", label: "Every few pages" }, { value: "each", label: "One file per page" }], onChange: (v) => { mode = v; show(); } });
  const outSel = select({ value: out, options: [{ value: "zip", label: "One zip file" }, { value: "pdfs", label: "Separate PDFs" }], onChange: (v) => { out = v; } });
  body.append(field("How do you want to split it?", modeSel), rangeIn, everyIn, summary, field("Download as", outSel),
    bigBtn("Split and download", "Scissors", async () => {
      let list;
      try { list = parts(); } catch (e) { toast(e.message, { error: true }); return; }
      const b = app.busy("Splitting your PDF");
      try {
        const files = {};
        for (const [k, idx] of list.entries()) {
          b.set(k / list.length, `Making file ${k + 1} of ${list.length}`);
          const { bytes } = await app.buildPdf({ pageIds: idx.map((i) => state.pages[i].id) });
          files[`${base()} part ${k + 1} (pages ${describePages(idx)}).pdf`] = bytes;
          if (b.signal.aborted) throw new Error("Cancelled");
        }
        if (out === "zip") await app.deliver(zipSync(files, { level: 0 }), app.outName("zip", "(split)"), { type: "application/zip" });
        else for (const [name, bytes] of Object.entries(files)) { await app.deliver(bytes, name); await new Promise((r) => setTimeout(r, 250)); }
        b.done(`Made ${list.length} file${list.length === 1 ? "" : "s"}`);
      } catch (e) { b.fail(e); }
    }));
  show();
}

// -- compress

/** Rebuild every page as a JPEG picture in a new PDF. */
async function rasterize(src, { dpi, quality }, b) {
  const pdf = await openPdf(src);
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (b.signal.aborted) throw new Error("Cancelled");
      b.set((i - 1) / pdf.numPages, `Page ${i} of ${pdf.numPages}`);
      const pg = await pdf.getPage(i);
      const v1 = pg.getViewport({ scale: 1 }), v = pg.getViewport({ scale: dpi / 72 });
      const c = document.createElement("canvas");
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      const g = c.getContext("2d", { alpha: false });
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvas: c, canvasContext: g, viewport: v }).promise;
      const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/jpeg", quality))).arrayBuffer());
      c.width = c.height = 1;
      out.addPage([v1.width, v1.height]).drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width: v1.width, height: v1.height });
    }
  } finally { pdf.destroy?.(); }
  const m = state.meta;
  if (m.title) out.setTitle(m.title);
  if (m.author) out.setAuthor(m.author);
  out.setProducer("OddlyClever PDF");
  return out.save({ useObjectStreams: true });
}

/** Re-save with object streams and no extras (thumbnails, hidden metadata, orphaned objects). */
async function lightSave(src) {
  const d = await PDFDocument.load(src, { updateMetadata: false });
  for (const pg of d.getPages()) pg.node.delete(PDFName.of("Thumb"));
  d.catalog.delete(PDFName.of("Metadata"));
  d.catalog.delete(PDFName.of("PieceInfo"));
  sweep(d);
  return d.save({ useObjectStreams: true });
}

async function withLock(bytes) {
  if (!get("security").on || !get("security").user) return bytes;
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  lockDoc(d);
  return d.save();
}

function compress(app, body) {
  let level = "strong";
  const LEVELS = [
    ["light", "Light", "Keeps your text selectable. Small saving."],
    ["strong", "Strong", "Good for sharing. Pages become pictures (150 dpi)."],
    ["smallest", "Smallest", "Tiny files for email. Pages become pictures (96 dpi)."],
  ];
  const result = el("div.pg-result", { hidden: true });
  const warn = note("", ".pg-warn");
  const cards = el("div.pg-levels", { role: "radiogroup" }, LEVELS.map(([id, t, d]) => el("button.pg-level", { type: "button", role: "radio", dataset: { id }, on: { click: () => pick(id) } }, el("b", {}, t), el("span", {}, d))));
  function pick(id) {
    level = id;
    for (const c of cards.children) { const on = c.dataset.id === id; c.classList.toggle("on", on); c.setAttribute("aria-checked", String(on)); }
    warn.hidden = id === "light";
    warn.textContent = "Heads up: on this level the text stops being selectable and searchable.";
  }
  body.append(note("Squash the file so it is easy to send. Your original stays as it is."), cards, warn,
    bigBtn("Make the file smaller", "Minimize2", async () => {
      result.hidden = true;
      const b = app.busy("Making the file smaller");
      try {
        const { bytes: src } = await app.outputPdf();
        let bytes = level === "light" ? await lightSave(src) : await rasterize(src, level === "strong" ? { dpi: 150, quality: 0.72 } : { dpi: 96, quality: 0.5 }, b);
        bytes = await withLock(bytes);
        b.done();
        const before = src.length, after = bytes.length;
        const smaller = after < before;
        result.replaceChildren(
          el("div.pg-sizes", {}, el("span", {}, fmtBytes(before)), icon("ArrowRight", 18), el("b", {}, fmtBytes(after)),
            smaller ? el("em", {}, `${Math.round((1 - after / before) * 100)}% smaller`) : null),
          smaller
            ? bigBtn("Download the smaller PDF", "Download", () => app.deliver(bytes, app.outName("pdf", "(smaller)")))
            : note(level === "light" ? "This file is already about as small as it gets without turning pages into pictures." : "This file is already small: the picture version would be bigger, so I kept your original."));
        result.hidden = false;
        result.classList.remove("oc-pop"); void result.offsetWidth; result.classList.add("oc-pop");
        result._bytes = bytes;
      } catch (e) { b.fail(e); }
    }), result);
  pick(level);
  body._compress = result;
}

// -- watermark, numbers, header and footer

async function pictureToPng(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/png"), w: c.width, h: c.height };
}

function watermark(app, body) {
  const w = get("watermark");
  const g = group("watermark", "Add this watermark when I save", "watermark");
  const textRow = field("Words", input({ value: w.text, placeholder: "CONFIDENTIAL", onInput: (v) => g.ed({ text: v }), onCommit: () => g.done("Change watermark") }));
  const picName = el("span.muted.small", {}, w.imageId ? "A picture is chosen." : "No picture yet.");
  const picRow = el("div.pg-stack", {}, bigBtn("Choose a picture", "Image", async () => {
    const [f] = await app.chooseFiles({ multiple: false, accept: "image/*" });
    if (!f) return;
    try {
      const p = await pictureToPng(f);
      g.put({ kind: "picture", imageId: putImage(p.url), imgW: p.w, imgH: p.h }, "Pick watermark picture");
      picName.textContent = f.name;
    } catch (e) { toast("I couldn't read that picture.", { error: true }); }
  }, ""), picName);
  const colorRowEl = field("Colour", colorRow(w.color, (c) => g.put({ color: c }, "Watermark colour"), { colors: ["#888888", "#111111", "#d81f3c", "#1f4fd8", "#11845b", "#ff8a00"] }));
  const show = (kind) => { textRow.hidden = colorRowEl.hidden = kind !== "text"; picRow.hidden = kind !== "picture"; };
  const kind = select({ value: w.kind, options: [{ value: "text", label: "Words" }, { value: "picture", label: "A picture" }], onChange: (v) => { show(v); g.put({ kind: v }, "Watermark type"); } });
  const scope = select({ value: w.scope, options: [{ value: "all", label: "Every page" }, { value: "odd", label: "Odd pages" }, { value: "even", label: "Even pages" }, { value: "range", label: "Pages I type…" }], onChange: (v) => { rangeIn.hidden = v !== "range"; g.put({ scope: v }, "Watermark pages"); } });
  const rangeIn = input({ value: w.range, placeholder: "For example 1-3, 5", onInput: (v) => g.ed({ range: v }), onCommit: () => g.done("Watermark pages") });
  rangeIn.hidden = w.scope !== "range";
  const pos = select({ value: w.position, options: [{ value: "middle", label: "In the middle" }, { value: "tiled", label: "Repeated all over" }, { value: "top-center", label: "Top" }, { value: "bottom-center", label: "Bottom" }, { value: "top-left", label: "Top left" }, { value: "top-right", label: "Top right" }, { value: "bottom-left", label: "Bottom left" }, { value: "bottom-right", label: "Bottom right" }], onChange: (v) => g.put({ position: v }, "Watermark position") });
  body.append(g.toggle, field("Make it from", kind), textRow, picRow, colorRowEl,
    slider({ label: "How see-through", unit: "%", min: 5, max: 100, value: Math.round(w.opacity * 100), onInput: (v) => g.ed({ opacity: v / 100 }), onChange: () => g.done("Watermark see-through") }),
    slider({ label: "Tilt", unit: "degrees", min: -90, max: 90, value: w.angle, onInput: (v) => g.ed({ angle: v }), onChange: () => g.done("Watermark tilt") }),
    slider({ label: "Size", unit: "% of page width", min: 10, max: 100, value: w.size, onInput: (v) => g.ed({ size: v }), onChange: () => g.done("Watermark size") }),
    field("Where", pos), field("Which pages?", scope), rangeIn,
    note("You can see it on the pages now. It is added to the PDF when you save, and only then."));
  show(w.kind);
}

function numbers(app, body) {
  const n = get("numbers");
  const g = group("numbers", "Add page numbers when I save", "page numbers");
  const fmtIn = input({ value: n.format, onInput: (v) => g.ed({ format: v }), onCommit: () => g.done("Page number format") });
  const chips = el("div.pg-chips", {}, ["{n}", "Page {n}", "Page {n} of {total}", "{n} / {total}"].map((f) => el("button.pg-chip", { type: "button", on: { click: () => { fmtIn.value = f; g.put({ format: f }, "Page number format"); } } }, f.replace("{n}", "1").replace("{total}", "9"))));
  const pos = select({ value: n.position, options: [["bottom-center", "Bottom middle"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top middle"], ["top-right", "Top right"], ["top-left", "Top left"]].map(([value, label]) => ({ value, label })), onChange: (v) => g.put({ position: v }, "Page number position") });
  body.append(g.toggle, field("What it says", fmtIn), chips, note("{n} is the page number and {total} is how many pages there are."), field("Where", pos),
    slider({ label: "Size", unit: "pt", min: 7, max: 28, value: n.size, onInput: (v) => g.ed({ size: v }), onChange: () => g.done("Page number size") }),
    field("Start counting at", input({ type: "number", value: n.start, onInput: (v) => g.ed({ start: Number(v) || 0 }), onCommit: () => g.done("Page number start") })),
    toggle({ label: "Leave the first page without a number", value: n.skipFirst, onChange: (v) => g.put({ skipFirst: v }, "Skip first page number") }));
}

function headfoot(app, body) {
  const h = get("headfoot");
  const g = group("headfoot", "Add this header and footer when I save", "header and footer");
  const box = (key, label) => field(label, input({ value: h[key], onInput: (v) => g.ed({ [key]: v }), onCommit: () => g.done("Header and footer") }));
  body.append(g.toggle, el("h5.pg-sub", {}, "Top of each page"), box("hl", "Left"), box("hc", "Middle"), box("hr", "Right"),
    el("h5.pg-sub", {}, "Bottom of each page"), box("fl", "Left"), box("fc", "Middle"), box("fr", "Right"),
    note("You can use {n} (page number), {total} (page count), {name} (file name) and {date}."),
    slider({ label: "Size", unit: "pt", min: 7, max: 24, value: h.size, onInput: (v) => g.ed({ size: v }), onChange: () => g.done("Header and footer size") }),
    toggle({ label: "Leave the first page empty", value: h.skipFirst, onChange: (v) => g.put({ skipFirst: v }, "Skip first page header") }));
}

// -- protect, unlock

function protect(app, body) {
  const s = get("security");
  const g = group("security", "Lock the PDF with a password when I save", "password");
  const pw = (key, label, ph) => {
    const i = input({ type: "password", value: s[key], placeholder: ph, onInput: (v) => g.ed({ [key]: v }), onCommit: () => g.done("Password") });
    i.autocomplete = "new-password";
    return { i, node: field(label, i) };
  };
  const user = pw("user", "Password to open it", "Type a password"), owner = pw("owner", "Password to change it (optional)", "Leave empty to keep it private");
  const show = toggle({ label: "Show the passwords", value: false, onChange: (v) => { user.i.type = owner.i.type = v ? "text" : "password"; } });
  body.append(g.toggle, user.node, owner.node, show,
    el("h5.pg-sub", {}, "People who open it may"),
    toggle({ label: "Print it", value: s.print, onChange: (v) => g.put({ print: v }, "Allow printing") }),
    toggle({ label: "Copy text out of it", value: s.copy, onChange: (v) => g.put({ copy: v }, "Allow copying") }),
    toggle({ label: "Edit and add comments", value: s.edit, onChange: (v) => g.put({ edit: v }, "Allow editing") }),
    note("The lock is added when you save. We never see your password and can't get it back, so keep it somewhere safe."));
}

function unlock(app, body) {
  const locked = [...state.files.values()].some((f) => f.password);
  body.append(locked
    ? note("This PDF had a password. The copy you save already has no password, so anyone can open it.")
    : note("This PDF is not locked, so there is nothing to remove. Saving gives a copy that anyone can open."));
  if (get("security").on) body.append(note("Heads up: you also asked for a new password in Protect. Saving normally adds it. The button below leaves it out.", ".pg-warn"));
  body.append(bigBtn("Save unlocked copy", "LockOpen", async () => {
    const b = app.busy("Making an unlocked copy");
    try {
      const { bytes } = await app.buildPdf({ skipSteps: ["security"], onProgress: (f, l) => b.set(f, l) });
      await app.deliver(bytes, app.outName("pdf", "(unlocked)"));
      b.done("Saved without a password");
    } catch (e) { b.fail(e); }
  }));
}

// -- crop

function crop(app, body) {
  const m = { t: 10, b: 10, l: 10, r: 10 };
  const sc = scopeControls(app, { withPicked: true });
  const mm = (k, label) => field(label, input({ type: "number", value: m[k], min: 0, max: 200, step: 1, onInput: (v) => { m[k] = Math.max(0, Number(v) || 0); } }));
  const count = () => Object.keys(get("crop")).filter((id) => state.pages.some((p) => p.id === id)).length;
  const info = note(count() ? `${count()} page${count() === 1 ? " is" : "s are"} cropped.` : "Nothing is cropped yet.");
  const idsFor = () => { try { return sc.indexes().map((i) => state.pages[i]).filter(Boolean); } catch (e) { toast(e.message, { error: true }); return null; } };
  body.append(note("Trim the edges off. The shaded part on the page is what gets cut. Measurements are in millimetres."), sc.node,
    el("div.pg-grid4", {}, mm("t", "Top"), mm("b", "Bottom"), mm("l", "Left"), mm("r", "Right")),
    bigBtn("Crop these pages", "Crop", () => {
      const pages = idsFor();
      if (!pages?.length) return;
      change("Crop pages", () => {
        state.extras.pages = state.extras.pages || {};
        const map = { ...(state.extras.pages.crop || {}) };
        for (const p of pages) {
          const sh = { l: mmToPt(m.l), t: mmToPt(m.t), r: mmToPt(m.r), b: mmToPt(m.b) };
          const c = marginsToPage(sh, p.rotate);
          const k = Math.min(1, (p.w - 20) / Math.max(1, c.l + c.r), (p.h - 20) / Math.max(1, c.t + c.b)); // always leave something
          map[p.id] = { l: c.l * k, t: c.t * k, r: c.r * k, b: c.b * k };
        }
        state.extras.pages.crop = map;
      });
      info.textContent = `${count()} page${count() === 1 ? " is" : "s are"} cropped.`;
    }),
    bigBtn("Put the edges back", "Undo2", () => {
      const pages = idsFor();
      if (!pages?.length) return;
      change("Remove crop", () => {
        const map = { ...(state.extras.pages?.crop || {}) };
        for (const p of pages) delete map[p.id];
        state.extras.pages = state.extras.pages || {};
        state.extras.pages.crop = map;
      });
      info.textContent = count() ? `${count()} page${count() === 1 ? " is" : "s are"} cropped.` : "Nothing is cropped yet.";
    }, "ghost"), info);
}

// -- info, flatten, redact

async function info(app, body) {
  const m = state.meta || {};
  const fields = [["title", "Title"], ["author", "Author"], ["subject", "What it is about"], ["keywords", "Keywords (separated by commas)"]];
  let orig = {};
  try { const f = [...state.files.values()][0]; orig = (await f.pdf.getMetadata())?.info || {}; } catch { /* no metadata is fine */ }
  const map = { title: orig.Title, author: orig.Author, subject: orig.Subject, keywords: orig.Keywords };
  for (const [k, label] of fields) {
    body.append(field(label, input({ value: m[k] || "", placeholder: map[k] || "", onCommit: (v) => change("Change document info", () => { state.meta = { ...state.meta, [k]: v.trim() }; }) })));
  }
  body.append(note("This is the information other programs show about your file. It is saved with the PDF."));
}

function flatten(app, body) {
  const g = group("flatten", "Make forms part of the page when I save", "flatten");
  body.append(g.toggle, note("Filled-in form boxes become plain page content, so nobody can change them. Good for sending a finished form."));
}

function redactHelp(app, body) {
  body.append(note("Black boxes that really remove what is under them. When you save, those pages become pictures and I check that the hidden words are gone."),
    bigBtn("Draw black boxes", "SquareDashed", () => { app.closePanel(); app.useTool("redact"); }));
}

const SECTIONS = [
  { id: "merge", icon: "Combine", title: "Join files", blurb: "Add more files to this one", build: merge },
  { id: "split", icon: "Scissors", title: "Split", blurb: "Cut it into smaller PDFs", build: split },
  { id: "compress", icon: "Minimize2", title: "Make the file smaller", blurb: "Easier to email", build: compress },
  { id: "watermark", icon: "Stamp", title: "Watermark", blurb: "Words or a picture on every page", build: watermark, chip: () => get("watermark").on },
  { id: "numbers", icon: "Hash", title: "Page numbers", blurb: "Number the pages", build: numbers, chip: () => get("numbers").on },
  { id: "headfoot", icon: "PanelTop", title: "Header and footer", blurb: "Text at the top and bottom", build: headfoot, chip: () => get("headfoot").on },
  { id: "protect", icon: "Lock", title: "Protect with a password", blurb: "Only people with it can open", build: protect, chip: () => get("security").on },
  { id: "unlock", icon: "LockOpen", title: "Unlock", blurb: "Save without a password", build: unlock },
  { id: "crop", icon: "Crop", title: "Crop", blurb: "Trim the page edges", build: crop, chip: () => Object.keys(get("crop")).length > 0 },
  { id: "info", icon: "Info", title: "Document info", blurb: "Title, author and more", build: info },
  { id: "flatten", icon: "Layers", title: "Flatten", blurb: "Lock in forms and notes", build: flatten, chip: () => get("flatten").on },
  { id: "redact", icon: "SquareDashed", title: "Black out private info", blurb: "Real redaction", build: redactHelp },
];

let chips = [];
export function refreshChips() {
  for (const { node, fn } of chips) node.hidden = !fn();
  document.querySelector('[data-panel="doc"]')?.classList.toggle("pg-locked", get("security").on);
  const belt = document.querySelector('[data-panel="doc"]');
  if (belt && !belt.querySelector(".pg-belt-badge")) belt.append(el("span.pg-belt-badge", { title: "Your PDF will be locked with a password" }, icon("Lock", 11)));
}

export function renderDocPanel(app, box, opts = {}) {
  box.classList.add("pg-box");
  chips = [];
  const list = el("div.pg-acc");
  let openId = null;
  const heads = new Map();
  const toggleSec = (id, force) => {
    const next = force ?? (openId === id ? null : id);
    openId = next;
    for (const [sid, h] of heads) {
      const isOpen = sid === next;
      h.sec.classList.toggle("open", isOpen);
      h.head.setAttribute("aria-expanded", String(isOpen));
      h.body.hidden = !isOpen;
    }
  };
  for (const s of SECTIONS) {
    const body = el("div.pg-sec-body", { hidden: true });
    const chip = el("span.pg-chipon", { hidden: true }, "On");
    if (s.chip) chips.push({ node: chip, fn: s.chip });
    const head = el("button.pg-sec-head", { type: "button", "aria-expanded": "false", on: { click: () => { toggleSec(s.id); if (openId === s.id) setTimeout(() => sec.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); } } },
      el("span.pg-sec-ic", {}, icon(s.icon, 20)), el("span.pg-sec-t", {}, el("b", {}, s.title), el("small", {}, s.blurb)), chip, icon("ChevronDown", 18));
    const sec = el("section.pg-sec", { dataset: { id: s.id } }, head, body);
    heads.set(s.id, { sec, head, body });
    list.append(sec);
    Promise.resolve(s.build(app, body)).catch((e) => { console.error(`[doc ${s.id}]`, e); body.append(el("p.bad", {}, "This part failed to open.")); });
  }
  box.append(list);
  refreshChips();
  if (opts.section) { toggleSec(opts.section, opts.section); setTimeout(() => heads.get(opts.section)?.sec.scrollIntoView({ block: "start" }), 80); }
  const off = on((e) => {
    if (!box.isConnected) { off(); return; }
    if (e.type === "change") refreshChips();
    // undo/redo or a new document: build the forms again so they show the right values
    if ((e.type === "change" && e.undo) || e.type === "doc") { off(); box.replaceChildren(); renderDocPanel(app, box, { section: openId }); }
  });
}
