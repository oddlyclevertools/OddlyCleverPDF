// Convert: PDF to Word, Excel, PowerPoint, pictures, text and more; and every kind of file to PDF.
import "./convert.css";
import { el } from "../../ui/kit.js";
import { registerExporters } from "./exporters.js";
import { registerImporters } from "./importers.js";
import { renderPanel, convertNow } from "./panel.js";

const PDF_ACCEPT = ".pdf,application/pdf";

export function install(app) {
  registerExporters(app);
  registerImporters(app);

  app.registerPanel({ id: "convert", title: "Convert", label: "Convert", icon: "ArrowLeftRight", order: 60, belt: true, accent: true, render: (box, opts) => renderPanel(app, box, opts) });

  // ---- home tasks: PDF to something --------------------------------------------------------
  const fromPdf = (id, title, blurb, icon, color, exporter, extra = {}) => app.registerTask({
    id, title, blurb, icon, color, group: "convert", files: "one", accept: PDF_ACCEPT, usesOpenDoc: true, ...extra,
    run: async (a, files) => {
      if (files?.length && !(await a.open(files))) return;
      await convertNow(a, exporter);
    },
  });
  fromPdf("pdf-to-word", "PDF to Word", "Turn a PDF into a Word file you can edit", "FileText", "cyan", "cv-docx", { popular: true, order: 10 });
  fromPdf("pdf-to-excel", "PDF to Excel", "Pull tables out into a spreadsheet", "Table", "mint", "cv-xlsx", { order: 11 });
  fromPdf("pdf-to-powerpoint", "PDF to PowerPoint", "One slide for every page", "Presentation", "orange", "cv-pptx", { order: 12 });
  fromPdf("pdf-to-pictures", "PDF to pictures", "Save every page as a PNG picture", "Image", "violet", "cv-png", { popular: true, order: 13 });
  fromPdf("pdf-to-text", "PDF to text", "Get just the words", "AlignLeft", "gold", "cv-txt", { order: 14 });

  // ---- home tasks: something to PDF --------------------------------------------------------
  const toPdf = (id, title, blurb, icon, color, accept, extra = {}) => app.registerTask({
    id, title, blurb, icon, color, group: "convert", files: extra.files || "one", accept, ...extra,
    run: async (a, files) => {
      if (!(await a.open(files))) return;
      offerSave(a);
    },
  });
  toPdf("word-to-pdf", "Word to PDF", "Make a PDF from a Word file", "FileText", "cyan", ".docx", { popular: true, order: 20 });
  toPdf("pictures-to-pdf", "Pictures to PDF", "Put photos or scans on pages, one each", "ImagePlus", "pink", "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg,.heic", { popular: true, files: "many", order: 21 });
  toPdf("excel-to-pdf", "Excel to PDF", "Turn a spreadsheet into pages", "Table", "mint", ".xlsx,.xlsm,.ods,.csv,.tsv", { order: 22 });
  toPdf("powerpoint-to-pdf", "PowerPoint to PDF", "One page for every slide", "Presentation", "orange", ".pptx", { order: 23 });
  toPdf("anything-to-pdf", "Anything to PDF", "Mix files of any kind into one PDF", "Files", "violet", undefined, { files: "many", order: 24 });

  // ---- Ctrl+K ----------------------------------------------------------------------------
  app.registerCommands((a) => {
    const list = [];
    if (a.state.pages.length) {
      list.push({ id: "convert:panel", label: "Convert this PDF…", group: "Convert", icon: "ArrowLeftRight", keywords: "export word excel powerpoint pictures text", run: () => a.openPanel("convert") });
      for (const ex of a.exporters().filter((e) => e.id.startsWith("cv-"))) {
        list.push({ id: `convert:${ex.id}`, label: `Convert to ${ex.label} (.${ex.ext})`, group: "Convert", icon: ex.icon, keywords: `save as export ${ex.ext} ${ex.blurb || ""}`, run: () => convertNow(a, ex.id) });
      }
    }
    return list;
  });
}

/** After a file is turned into a PDF: offer to save it. */
function offerSave(app) {
  if (!app.state.pages.length) return;
  app.modal("Your PDF is ready", (close) => el("div.stack", {},
    el("p", {}, "It is open in the editor. You can change it first, or save it now."),
    el("div.row.end", {},
      el("button.btn", { type: "button", on: { click: close } }, "Keep editing"),
      el("button.btn.primary", { type: "button", on: { click: () => { close(); app.save(); } } }, "Save PDF"))));
}
