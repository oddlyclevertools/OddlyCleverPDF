// Contact sheet of imported fixtures: node tools/smoke.mjs 5212 tools/convert_sheet.js none --shot tools/_convert_sheet.png
const names = ["sample.docx", "sample.md", "sample.html", "sample.xlsx", "sample.pptx", "sample.odt", "sample.csv", "sample.rtf"];
const wrap = document.createElement("div");
wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#888;display:flex;flex-wrap:wrap;gap:8px;padding:8px;overflow:hidden;align-content:flex-start";
for (const n of names) {
  const f = new File([await fetch(`/tests/fixtures/convert/${n}`).then((r) => r.arrayBuffer())], n);
  const pdf = await app.pdf.openPdf(await app.fileToPdfBytes(f));
  const c = await app.pdf.pageToCanvas(pdf, 0, { width: 300 });
  c.style.cssText = "background:#fff;max-height:400px;width:auto";
  wrap.append(c);
}
document.body.append(wrap);
return names.length;
