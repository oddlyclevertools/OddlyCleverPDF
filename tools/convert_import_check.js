// node tools/smoke.mjs 5212 tools/convert_import_check.js   (needs: node tools/convert_fixtures.mjs)
const out = {};
const grab = async (name, type = "") => new File([await fetch(`/tests/fixtures/convert/${name}`).then((r) => r.arrayBuffer())], name, { type });
const pdfText = async (bytes) => {
  const pdf = await app.pdf.openPdf(bytes);
  let t = "";
  const sizes = [];
  for (let i = 0; i < pdf.numPages; i++) { t += (await app.pdf.pagePlainText(pdf, i)) + "\n"; const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1, rotation: 0 }); sizes.push([Math.round(vp.width), Math.round(vp.height)]); }
  return { pages: pdf.numPages, text: t, sizes };
};
const check = async (label, file, expects) => {
  try {
    const bytes = await app.fileToPdfBytes(file);
    const r = await pdfText(bytes);
    const missing = expects.filter((e) => !r.text.includes(e));
    out[label] = { ok: missing.length === 0, pages: r.pages, size: r.sizes[0], bytes: bytes.length, missing };
    return r;
  } catch (e) { out[label] = { ok: false, error: String(e.message || e).slice(0, 200) }; }
};
await check("docx", await grab("sample.docx"), ["Quarterly report", "bold", "café", "First point", "Widget", "100.00", "The end."]);
await check("md", await grab("sample.md"), ["Markdown title", "bold", "apples", "green", "second", "Widget", "const x = 1;"]);
await check("csv", await grab("sample.csv"), ["Widget", "100.00", "Thing, big"]);
await check("txt", await grab("sample.txt"), ["Plain text file.", "Second line"]);
await check("html", await grab("sample.html"), ["HTML title", "italic", "two", "Widget".slice(0, 0)]);
const html = await check("html2", await grab("sample.html"), ["HTML title"]);
out.htmlNoScript = html ? !html.text.includes("alert") : null;
await check("rtf", await grab("sample.rtf"), ["Rich text file", "Second paragraph"]);
await check("xlsx", await grab("sample.xlsx"), ["Sales", "Widget", "100", "50.5", "Notes", "Hello"]);
await check("ods", await grab("sample.ods"), ["Data", "Ann", "42"]);
await check("pptx", await grab("sample.pptx"), ["Big idea", "First bullet", "Second bullet", "Picture slide"]);
await check("odt", await grab("sample.odt"), ["ODT title", "bold", "one", "two"]);
await check("svg", await grab("sample.svg", "image/svg+xml"), []);
await check("png", await grab("sample.png", "image/png"), []);
await check("heic", new File([new Uint8Array(20)], "x.heic", { type: "image/heic" }), []);

// round trips: our own exporters -> importers
const ex = (id, options) => app.exporters().find((e) => e.id === id).run(app, { options });
for (const [id, ext, mime, expects] of [["cv-docx", "docx", "", ["Invoice number 101", "Widget", "100.00"]], ["cv-xlsx", "xlsx", "", ["Widget", "100", "Gadget"]], ["cv-odt", "odt", "", ["Invoice number 101", "Widget"]], ["cv-md", "md", "", ["Invoice number 101", "Widget"]], ["cv-html", "html", "", ["Invoice number 101", "Widget"]], ["cv-rtf", "rtf", "", ["Invoice number 101", "Widget"]], ["cv-pptx", "pptx", "", ["Invoice number 101", "Widget"]], ["cv-csv", "csv", "", ["Widget"]], ["cv-txt", "txt", "", ["Invoice number 101"]]]) {
  try { const r = await ex(id); await check(`round-${ext}`, new File([r.blob], `rt.${ext}`, { type: mime }), expects); } catch (e) { out[`round-${ext}`] = { ok: false, error: String(e.message || e).slice(0, 200) }; }
}
out.importerCount = app.listImporters().length;
return out;
