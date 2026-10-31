// node tools/smoke.mjs 5212 tools/convert_export_check.js   (body of an async fn; `app` in scope)
const { unzipSync, strFromU8 } = await import("/tools/convert_zip.js");
const out = {};
const bytesOf = async (r) => new Uint8Array(await r.blob.arrayBuffer());
const run = async (id, options) => { const ex = app.exporters().find((e) => e.id === id); const t = performance.now(); const r = await ex.run(app, { options }); return { r, ms: Math.round(performance.now() - t) }; };
const ck = (name, fn) => fn().then((v) => { out[name] = v; }, (e) => { out[name] = "ERROR " + (e.message || e).toString().slice(0, 200); });
const text = (z, p) => strFromU8(z[p]);

await ck("docx", async () => {
  const { r, ms } = await run("cv-docx");
  const z = unzipSync(await bytesOf(r)); const x = text(z, "word/document.xml");
  return { ms, file: r.filename, sections: (x.match(/<w:sectPr/g) || []).length, h1: /Heading1/.test(x), invoice: x.includes("Invoice number 101"), tableCols: (x.match(/<w:tc>/g) || []).length, gridCols: (x.match(/<w:gridCol/g) || []).length, widget: x.includes("Widget") };
});
await ck("docx-exact", async () => {
  const { r, ms } = await run("cv-docx", { mode: "exact" });
  const z = unzipSync(await bytesOf(r)); const x = text(z, "word/document.xml");
  return { ms, media: Object.keys(z).filter((k) => k.startsWith("word/media")).length, behind: /behindDoc="1"/.test(x), hiddenText: x.includes("Invoice number 101") };
});
await ck("xlsx", async () => {
  const { r, ms } = await run("cv-xlsx");
  const z = unzipSync(await bytesOf(r)); const s = text(z, "xl/worksheets/sheet1.xml"); const sst = text(z, "xl/sharedStrings.xml");
  return { ms, sheets: Object.keys(z).filter((k) => /worksheets\/sheet/.test(k)).length, widgetRow: /Widget/.test(sst), numeric100: s.includes("<v>100</v>"), cols: (s.match(/<row r="\d+">(?:<c [^>]*>.*?<\/c>){3}<\/row>/g) || []).length };
});
await ck("xlsx-table", async () => { const { r } = await run("cv-xlsx", { split: "table" }); const z = unzipSync(await bytesOf(r)); return { sheets: Object.keys(z).filter((k) => /worksheets\/sheet/.test(k)).length, wb: text(z, "xl/workbook.xml").match(/name="[^"]+"/g) }; });
await ck("csv", async () => { const { r } = await run("cv-csv"); const t = await r.blob.text(); return { lines: t.split(/\r?\n/).length, widget: t.includes("Widget,2,100.00") }; });
await ck("pptx", async () => {
  const { r, ms } = await run("cv-pptx");
  const z = unzipSync(await bytesOf(r)); const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  const s1 = text(z, "ppt/slides/slide1.xml");
  return { ms, slides: slides.length, media: Object.keys(z).filter((k) => k.startsWith("ppt/media")).length, texts: (s1.match(/<a:t>/g) || []).length, invoice: s1.includes("Invoice number 101"), bgPic: /<p:bg>/.test(s1) || /<p:pic>/.test(s1) };
});
await ck("pptx-picture", async () => { const { r } = await run("cv-pptx", { mode: "picture" }); const z = unzipSync(await bytesOf(r)); return { texts: (text(z, "ppt/slides/slide1.xml").match(/<a:t>/g) || []).length }; });
for (const [id, mime] of [["cv-png", "image/png"], ["cv-jpg", "image/jpeg"], ["cv-webp", "image/webp"]]) {
  await ck(id, async () => { const { r } = await run(id, { dpi: 72 }); const b = await bytesOf(r); const z = r.filename.endsWith(".zip") ? unzipSync(b) : null; return { file: r.filename, entries: z ? Object.keys(z).length : 1, type: r.blob.type }; });
}
await ck("png-one-300", async () => { const ex = app.exporters().find((e) => e.id === "cv-png"); const r = await ex.run(app, { options: { dpi: 300 }, pages: [0] }); const bmp = await createImageBitmap(r.blob); return { w: bmp.width, h: bmp.height, file: r.filename }; });
await ck("txt", async () => { const { r } = await run("cv-txt"); const t = await r.blob.text(); return { invoice: t.includes("Invoice number 101"), tab: t.includes("Widget\t2\t100.00"), len: t.length }; });
await ck("md", async () => { const { r } = await run("cv-md"); const t = await r.blob.text(); return { h1: t.includes("# Invoice number 101"), table: t.includes("| Widget | 2 | 100.00 |") }; });
await ck("html", async () => { const { r } = await run("cv-html"); const t = await r.blob.text(); return { h1: t.includes("<h1>"), table: t.includes("<table>"), th: t.includes("<td>Widget</td>") }; });
await ck("rtf", async () => { const { r } = await run("cv-rtf"); const t = await r.blob.text(); return { rtf: t.startsWith("{\\rtf1"), widget: t.includes("Widget") }; });
await ck("epub", async () => { const { r } = await run("cv-epub"); const z = unzipSync(await bytesOf(r)); return { first: Object.keys(z)[0], chapters: Object.keys(z).filter((k) => /page\d+\.xhtml/.test(k)).length, table: text(z, "OEBPS/page1.xhtml").includes("<table>") }; });
await ck("odt", async () => { const { r } = await run("cv-odt"); const z = unzipSync(await bytesOf(r)); const c = text(z, "content.xml"); return { first: Object.keys(z)[0], cells: (c.match(/<table:table-cell/g) || []).length, invoice: c.includes("Invoice number 101") }; });
await ck("json", async () => { const { r } = await run("cv-json"); const j = JSON.parse(await r.blob.text()); return { pages: j.pages.length, lines: j.pages[0].lines.length, run: j.pages[0].lines[0].runs[0] }; });
for (const id of ["cv-pdf-print", "cv-pdf-grey"]) {
  await ck(id, async () => {
    const { r } = await run(id, { dpi: 100 });
    const b = await bytesOf(r); const pdf = await app.pdf.openPdf(b);
    const c = await app.pdf.pageToCanvas(pdf, 0, { width: 200 }); const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let colour = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - px[i + 1]) > 6 || Math.abs(px[i + 1] - px[i + 2]) > 6) colour++;
    const text = await app.pdf.pagePlainText(pdf, 0);
    return { pages: pdf.numPages, bytes: b.length, colourPixels: colour, hasText: text.length };
  });
}
return out;
