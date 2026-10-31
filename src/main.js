// OddlyClever PDF: boot. Builds the `app` object every feature gets, the frame, the home screen
// and the editor, then installs every feature folder in src/features/*/index.js.
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/app.css";
import "./styles/textlayer.css";
import { el, icon, toast, modal, confirmDialog } from "./ui/kit.js";
import * as store from "./core/store.js";
import { state, on, emit } from "./core/store.js";
import * as pdfCore from "./core/pdf.js";
import { installFontFaces } from "./core/fonts.js";
import { buildPdf, deliver, outName, registerExportStep, lib as pdfLib, hexToRgb, wrapText } from "./core/export.js";
import { openFiles, registerImporter, acceptList, restoreSession, addPdfBytes, pagesOf, fileToPdfBytes, listImporters } from "./core/open.js";
import { pageLines, pageString, clearTextCache } from "./core/text.js";
import { startAutosave, savedInfo, loadSaved, forgetSaved, saveNow } from "./core/autosave.js";
import * as viewer from "./viewer/viewer.js";
import { bbox } from "./viewer/objects.js";
import { registerTool, useTool, attach as attachTools, placeNext, toolPrefs, setToolPrefs, toolList } from "./tools/registry.js";
import { installSelect, startTyping } from "./tools/select.js";
import { installPaste, addPicture, pictureDataUrl, textRectsBetween } from "./tools/builtin.js";
import { buildShell, registerPanel, registerTopAction, registerCommands, openPanel, closePanel, togglePanel, busy, celebrate, isPhone, palette, currentPanel } from "./ui/shell.js";
import { mountStylebar, registerStyleControls } from "./ui/stylebar.js";
import { mountHome, registerTask, showResume, taskList } from "./ui/home.js";
import { installFind } from "./ui/find.js";
import { installTheme } from "./ui/theme.js";

installFontFaces();
installTheme();

/** Exporters ("Convert to…") live here so the Convert panel and the AI share one list. */
const exporters = new Map();

const app = {
  version: "0.1.0",
  view: "home",
  state, store, pdf: pdfCore, pdfLib, viewer,
  // documents
  openFiles, addPdfBytes, pagesOf, fileToPdfBytes, restoreSession, buildPdf, deliver, outName, hexToRgb, wrapText,
  pageLines, pageString, clearTextCache, bbox,
  // extension points
  registerTool, registerPanel, registerTopAction, registerCommands, registerTask, registerImporter, listImporters,
  registerExportStep, registerLayer: viewer.registerLayer, registerStyleControls,
  /** @param {{ id, label, ext, icon, group, blurb?, order?, run: (app, { progress, signal, pageIds? }) => Promise<{ blob: Blob, filename: string } | Array<{blob, filename}>> }} x */
  registerExporter: (x) => { exporters.set(x.id, { order: 50, group: "Documents", ...x }); emit("exporters"); },
  exporters: () => [...exporters.values()].sort((a, b) => a.order - b.order),
  // ui
  useTool, placeNext, toolPrefs, setToolPrefs, toolList, startTyping, addPicture, pictureDataUrl, textRectsBetween,
  openPanel, closePanel, togglePanel, currentPanel, busy, celebrate, toast, modal, el, icon, isPhone, palette,
  currentPageId: () => state.pages[viewer.currentIndex()]?.id,
  currentPageIndex: () => viewer.currentIndex(),
};
window.ocpdf = app; // for the tests and the console

const root = document.getElementById("app");
const ui = buildShell(root, app);
mountHome(ui.home, app);
viewer.mount(ui.work);
const column = ui.work.querySelector(".pages");
attachTools(column);
installSelect(column);
installPaste(() => app.currentPageId());
mountStylebar(ui.stylebar);
installFind(app);

// ---- views ----------------------------------------------------------------------------------

app.goHome = async () => {
  app.view = "home";
  document.body.dataset.view = "home";
  closePanel();
  if (state.pages.length) await saveNow();
  refreshResume();
};
app.goEditor = () => {
  app.view = "editor";
  document.body.dataset.view = "editor";
  useTool(state.tool || "select");
};
on((e) => { if (e.type === "doc") { if (state.pages.length) app.goEditor(); else app.goHome(); } });

async function refreshResume() {
  const info = await savedInfo();
  showResume(info && !state.pages.length ? info : info && state.pages.length ? { ...info, name: state.name } : null, async () => {
    if (state.pages.length) { app.goEditor(); return; }
    const b = busy("Opening your work");
    try { await restoreSession(await loadSaved()); b.done(); } catch (e) { b.fail(e); }
  }, async () => { await forgetSaved(); store.reset(); refreshResume(); });
}

// ---- opening files --------------------------------------------------------------------------

/** Ask for files. Resolves File[] (empty if cancelled). */
app.chooseFiles = ({ multiple = true, accept } = {}) => new Promise((resolve) => {
  const inp = el("input", { type: "file", multiple, accept: accept || acceptList(), style: { display: "none" } });
  inp.addEventListener("change", () => { resolve([...inp.files]); inp.remove(); });
  inp.addEventListener("cancel", () => { resolve([]); inp.remove(); });
  document.body.append(inp);
  inp.click();
});

/** Open files with a progress card. mode as in openFiles. */
app.open = async (files, mode = "replace") => {
  if (!files?.length) return 0;
  const b = busy(files.length > 1 ? `Opening ${files.length} files` : `Opening ${files[0].name}`);
  try {
    const n = await openFiles(files, { mode, progress: (f, l) => b.set(f, l) });
    b.done();
    if (n) app.goEditor();
    return n;
  } catch (e) { b.fail(e); return 0; }
};
app.pickFiles = async () => app.open(await app.chooseFiles());

// Drop files anywhere. On the editor they're added at the end; on the home screen they open.
document.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); document.body.classList.add("dragging"); } });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
document.addEventListener("drop", (e) => {
  document.body.classList.remove("dragging");
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  app.open(files, app.view === "editor" && state.pages.length ? "append" : "replace");
});

// Files sent from the phone's share sheet / "Open with" (installed app).
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    const files = await Promise.all((params.files || []).map((h) => h.getFile()));
    if (files.length) app.open(files);
  });
}

// ---- saving ---------------------------------------------------------------------------------

app.save = async ({ share = false } = {}) => {
  if (!state.pages.length) return;
  const b = busy("Making your PDF");
  try {
    const { bytes, notes } = await buildPdf({ onProgress: (f, l) => b.set(f, l) });
    const how = await deliver(bytes, outName("pdf"), { share });
    state.dirty = false;
    b.done(how === "cancelled" ? "" : how === "shared" ? "Shared!" : "Saved to your downloads");
    for (const n of notes || []) toast(n, { ms: 6000 });
    const wasLocked = [...state.files.values()].some((f) => f.password || f.hadPassword);
    if (wasLocked && !state.extras.pages?.security?.on) toast("Heads up: the file you opened had a password, and this copy doesn't. To lock it again, use Tools → Protect with a password.", { ms: 8000 });
  } catch (e) { console.error("[save]", e); b.fail(e); }
};

registerTopAction({
  id: "save", order: 90,
  render: () => el("div.save-group", {},
    navigator.canShare ? el("button.icon-btn.only-phone", { type: "button", title: "Share", "aria-label": "Share the PDF", on: { click: () => app.save({ share: true }) } }, icon("Share2", 19)) : null,
    el("button.btn.primary.save-btn", { type: "button", title: "Download the edited PDF (Ctrl+S)", on: { click: () => app.save() } }, icon("Download", 18), el("span", {}, "Save PDF"))),
});
registerTopAction({
  id: "open", order: 10,
  render: () => el("button.icon-btn", { type: "button", title: "Open or add files (Ctrl+O)", "aria-label": "Open files", on: { click: () => app.pickFiles() } }, icon("FolderOpen", 19)),
});
registerTopAction({
  id: "palette", order: 20,
  render: () => el("button.icon-btn.hide-phone", { type: "button", title: "Find any tool (Ctrl+K)", "aria-label": "Find a tool", on: { click: () => palette(app) } }, icon("Command", 19)),
});

/**
 * The finished document, built once and opened in pdf.js (cached until the next change).
 * Use this when a feature needs exactly what Save would produce (images, Word, AI pictures).
 * @returns {Promise<{ bytes: Uint8Array, pdf: any }>}
 */
let outCache = null;
on((e) => { if (e.type === "change" || e.type === "doc") outCache = null; });
app.outputPdf = async ({ onProgress } = {}) => {
  if (outCache) return outCache;
  // never password-locked: this copy is for reading back inside the app
  const { bytes } = await buildPdf({ onProgress, skipSteps: ["security"] });
  outCache = { bytes, pdf: await pdfCore.openPdf(bytes) };
  return outCache;
};

// ---- tasks ----------------------------------------------------------------------------------

app.runTask = async (id) => {
  const t = taskList().find((x) => x.id === id);
  if (!t) return;
  try {
    if (t.files === "none" || (t.usesOpenDoc && state.pages.length)) { await t.run(app); return; }
    const files = await app.chooseFiles({ multiple: t.files === "many", accept: t.accept });
    if (!files.length) return;
    await t.run(app, files);
  } catch (e) { console.error(`[task ${id}]`, e); toast(e.message || "That didn't work.", { error: true }); }
};

const openThen = (tool) => async (a, files) => { if (await a.open(files)) useTool(tool); };
registerTask({ id: "edit", title: "Edit a PDF", blurb: "Change words, add text and pictures", icon: "FilePen", color: "pink", popular: true, order: 1, run: openThen("edittext") });
registerTask({ id: "annotate", title: "Highlight & comment", blurb: "Mark up, draw, add notes", icon: "Highlighter", color: "gold", group: "edit", order: 20, run: openThen("highlight") });
registerTask({ id: "addtext", title: "Type on a PDF", blurb: "Fill in any form, even flat ones", icon: "Type", color: "cyan", group: "edit", order: 15, run: openThen("text") });
registerTask({ id: "whiteout", title: "Cover something up", blurb: "White-out or redact", icon: "Eraser", color: "mint", group: "edit", order: 40, run: openThen("whiteout") });
registerTask({ id: "blank", title: "Start a blank PDF", blurb: "A clean A4 page to write on", icon: "FilePlus2", color: "violet", group: "edit", order: 60, files: "none",
  run: async (a) => {
    const d = await pdfLib.PDFDocument.create(); d.addPage([595.28, 841.89]);
    const file = new File([await d.save()], "Untitled.pdf", { type: "application/pdf" });
    if (await a.open([file])) useTool("text");
  } });

registerCommands((a) => {
  const list = taskList().map((t) => ({ id: `task:${t.id}`, label: t.title, group: "Tasks", icon: t.icon, keywords: t.blurb, run: () => a.runTask(t.id) }));
  if (state.pages.length) {
    for (const t of toolList().filter((x) => !x.hidden)) list.push({ id: `tool:${t.id}`, label: t.label, group: "Tools", icon: t.icon, keywords: t.hint, run: () => useTool(t.id) });
    list.push({ id: "save", label: "Save PDF", group: "File", icon: "Download", keywords: "download export", run: () => a.save() });
  }
  list.push({ id: "open", label: "Open a file", group: "File", icon: "FolderOpen", keywords: "load import", run: () => a.pickFiles() });
  return list;
});

// ---- zoom controls ----------------------------------------------------------------------------

const zoomPct = el("button.zoom-pct", { type: "button", title: "Fit to width", on: { click: () => viewer.fitWidth() } }, "100%");
const pageNo = el("span.page-no", {}, "");
ui.work.append(el("div.zoombox", {},
  pageNo,
  el("button.icon-btn", { type: "button", title: "Zoom out", "aria-label": "Zoom out", on: { click: () => viewer.zoomBy(1 / 1.2) } }, icon("ZoomOut", 18)),
  zoomPct,
  el("button.icon-btn", { type: "button", title: "Zoom in", "aria-label": "Zoom in", on: { click: () => viewer.zoomBy(1.2) } }, icon("ZoomIn", 18))));
on((e) => {
  if (e.type === "zoom") zoomPct.textContent = `${Math.round(e.zoom / (96 / 72) * 100)}%`;
  if (e.type === "page" || e.type === "pages-built" || e.type === "doc") pageNo.textContent = state.pages.length ? `${viewer.currentIndex() + 1} / ${state.pages.length}` : "";
});

// ---- features -------------------------------------------------------------------------------

const features = import.meta.glob("./features/*/index.js", { eager: true });
for (const [path, mod] of Object.entries(features)) {
  try { mod.install?.(app); } catch (e) { console.error(`[feature] ${path} failed to install`, e); }
}

// ---- start ------------------------------------------------------------------------------------

startAutosave();
document.body.dataset.view = "home";
useTool("select");
refreshResume();
window.addEventListener("beforeunload", (e) => { if (state.dirty && state.pages.length) { saveNow(); } });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn("[sw]", e));
  // files shared to the installed app from another app's share sheet
  if (new URLSearchParams(location.search).has("shared")) {
    navigator.serviceWorker.ready.then((reg) => {
      navigator.serviceWorker.addEventListener("message", async (e) => {
        if (e.data?.type !== "shared-files" || !e.data.files.length) return;
        // anyone can send files to this address, so ask before replacing what is open
        const names = e.data.files.map((f) => f.name).join(", ");
        if (await confirmDialog("Open the shared file?", `Another app sent ${names}. Open it here?`, "Open")) app.open(e.data.files);
      }, { once: true });
      reg.active?.postMessage("shared-files");
      history.replaceState(null, "", location.pathname);
    });
  }
}

// "Install the app" (Chrome, Edge, Android): the button shows only when the browser offers it.
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; document.body.classList.add("can-install"); });
registerTopAction({
  id: "install", order: 35,
  render: () => el("button.btn.small.install-btn.keep-home", { type: "button", title: "Install OddlyClever PDF as an app (works offline)",
    on: { click: async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; document.body.classList.remove("can-install"); } } },
  icon("MonitorDown", 16), el("span", {}, "Install app")),
});
emit("ready");
