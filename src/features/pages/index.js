// Pages feature: the Pages panel (thumbnails, drag to reorder, rotate, delete, copy, extract, insert),
// the Tools panel (merge, split, compress, watermark, numbers, header/footer, password, unlock, crop,
// info, flatten), true redaction, the home tasks and the Ctrl+K commands.
import "./pages.css";
import { state } from "../../core/store.js";
import { renderPagesPanel } from "./pages-panel.js";
import { renderDocPanel, refreshChips } from "./doc-panel.js";
import { installSteps } from "./steps.js";
import { installPreview } from "./preview.js";
import { set } from "./cfg.js";
import * as ops from "./ops.js";

export function install(app) {
  installSteps(app);
  installPreview(app);

  app.registerPanel({ id: "pages", title: "Pages", label: "Pages", icon: "LayoutGrid", order: 30, belt: true, render: (box) => renderPagesPanel(app, box) });
  app.registerPanel({ id: "doc", title: "Tools", label: "Tools", icon: "Wand2", order: 35, belt: true, render: (box, opts) => renderDocPanel(app, box, opts || {}) });
  app.store.on((e) => { if (e.type === "change" || e.type === "doc" || e.type === "ready") refreshChips(); });
  setTimeout(refreshChips, 300);

  /** Other features (and the tests) can use the same page actions. */
  app.pagesTools = { ...ops, set };

  // ---- home tasks ----------------------------------------------------------------------------------
  const opened = async (app2, files) => (files?.length ? !!(await app2.open(files)) : state.pages.length > 0);
  const toDoc = (section, before) => async (a, files) => {
    if (!(await opened(a, files))) return;
    before?.();
    a.openPanel("doc", { section });
  };
  const toPages = (tip) => async (a, files) => {
    if (!(await opened(a, files))) return;
    a.openPanel("pages");
    if (tip) a.toast(tip, { ms: 5000 });
  };
  const T = (id, title, blurb, ic, color, group, run, extra = {}) =>
    app.registerTask({ id: `pg-${id}`, title, blurb, icon: ic, color, group, files: "one", usesOpenDoc: true, order: 30, run, ...extra });

  app.registerTask({
    id: "pg-merge", title: "Merge PDFs", blurb: "Join several files into one", icon: "Combine", color: "cyan", group: "pages", popular: true, files: "many", order: 5,
    run: async (a, files) => { if (await a.open(files)) { a.openPanel("pages"); a.toast("Joined into one! Drag pages to put them in order.", { ms: 5000 }); } },
  });
  T("split", "Split a PDF", "Cut it into smaller files", "Scissors", "orange", "pages", toDoc("split"), { order: 31 });
  T("compress", "Compress", "Make the file smaller", "Minimize2", "mint", "pages", toDoc("compress"), { popular: true, order: 6 });
  T("organise", "Organise pages", "Drag pages into a new order", "LayoutGrid", "violet", "pages", toPages(), { order: 32 });
  T("rotate", "Rotate pages", "Turn pages the right way up", "RotateCw", "gold", "pages", toPages("Pick the pages, then tap Turn left or Turn right."), { order: 33 });
  T("delete", "Delete pages", "Throw away pages you don't need", "Trash2", "pink", "pages", toPages("Pick the pages, then tap Delete."), { order: 34 });
  T("extract", "Extract pages", "Save some pages as a new PDF", "FileOutput", "cyan", "pages", toPages("Pick the pages, then tap Save as new PDF."), { order: 35 });
  T("numbers", "Add page numbers", "Number every page", "Hash", "gold", "pages", toDoc("numbers", () => set("numbers", { on: true }, "Turn on page numbers")), { order: 36 });
  T("watermark", "Watermark", "Stamp words or a picture on pages", "Stamp", "violet", "pages", toDoc("watermark", () => set("watermark", { on: true }, "Turn on watermark")), { order: 37 });
  T("crop", "Crop pages", "Trim the edges off", "Crop", "orange", "pages", toDoc("crop"), { order: 38 });
  T("protect", "Protect with password", "Lock your PDF", "Lock", "pink", "secure", toDoc("protect"), { order: 40 });
  T("unlock", "Unlock a PDF", "Take the password off", "LockOpen", "mint", "secure", toDoc("unlock"), { order: 41 });
  T("redact", "Redact", "Black out private info for real", "SquareDashed", "cyan", "secure", async (a, files) => {
    if (await opened(a, files)) a.useTool("redact");
  }, { order: 42 });

  // ---- Ctrl+K ----------------------------------------------------------------------------------------
  app.registerCommands((a) => {
    if (!state.pages.length) return [];
    const C = (id, label, ic, run, keywords = "", group = "Pages") => ({ id: `pg:${id}`, label, group, icon: ic, keywords, run });
    const sec = (id, label, ic, keywords, pre) => C(`doc-${id}`, label, ic, () => { pre?.(); a.openPanel("doc", { section: id }); }, keywords, "Document");
    return [
      C("panel", "Show all pages", "LayoutGrid", () => a.openPanel("pages"), "thumbnails organise reorder"),
      C("left", "Turn page left", "RotateCcw", () => ops.rotate(ops.targets(), -90), "rotate counter clockwise"),
      C("right", "Turn page right", "RotateCw", () => ops.rotate(ops.targets(), 90), "rotate clockwise"),
      C("delete", "Delete page", "Trash2", () => { if (!ops.remove(ops.targets())) a.toast("A PDF needs at least one page.", { error: true }); }, "remove"),
      C("dup", "Copy page", "Copy", () => ops.duplicate(ops.targets()), "duplicate"),
      C("blank", "Add a blank page", "FilePlus2", () => ops.insertBlank(a, Math.max(...ops.indexesOf(ops.targets()))), "insert empty"),
      C("insert", "Add pages from a file", "FilePlus", () => ops.insertFromFiles(a, Math.max(...ops.indexesOf(ops.targets())) + 1), "insert merge"),
      C("extract", "Save page as a new PDF", "FileOutput", () => ops.extract(a, ops.targets()), "extract split"),
      C("start", "Move page to the start", "ArrowUpToLine", () => ops.move(ops.targets(), "start"), "first"),
      C("end", "Move page to the end", "ArrowDownToLine", () => ops.move(ops.targets(), "end"), "last"),
      sec("merge", "Join files", "Combine", "merge combine add"),
      sec("split", "Split this PDF", "Scissors", "cut divide separate"),
      sec("compress", "Make the file smaller", "Minimize2", "compress shrink reduce size"),
      sec("watermark", "Add a watermark", "Stamp", "stamp confidential draft", () => set("watermark", { on: true }, "Turn on watermark")),
      sec("numbers", "Add page numbers", "Hash", "number pages", () => set("numbers", { on: true }, "Turn on page numbers")),
      sec("headfoot", "Add a header and footer", "PanelTop", "header footer"),
      sec("protect", "Protect with a password", "Lock", "encrypt lock secure"),
      sec("unlock", "Unlock (remove password)", "LockOpen", "decrypt password"),
      sec("crop", "Crop pages", "Crop", "trim margins"),
      sec("info", "Document info", "Info", "title author metadata properties"),
      sec("flatten", "Flatten forms", "Layers", "flatten form fields"),
      C("redact", "Redact (black out private info)", "SquareDashed", () => a.useTool("redact"), "hide censor", "Document"),
    ];
  });
}
