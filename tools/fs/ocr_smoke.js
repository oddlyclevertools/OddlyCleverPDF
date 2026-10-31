// OCR on the scan fixture: reads it with tesseract.js (downloads eng once), then checks the words
// are searchable by the app and that Save keeps the invisible text.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
localStorage.setItem("ocpdf.ocr.langs", JSON.stringify(["eng"]));
await sleep(500);
const out = {};
out.blankBefore = (await app.fs.ocr.blankPages()).length;
const t0 = performance.now();
const n = await app.fs.ocr.readScan({ lang: "eng", dpi: 200 });
out.pagesRead = n; out.secs = Math.round((performance.now() - t0) / 100) / 10;
out.blankAfter = (await app.fs.ocr.blankPages()).length;
const text = await app.pageString(app.state.pages[0].id);
out.textHead = text.slice(0, 120);
out.hasInvoice = /invoice/i.test(text) && /widget/i.test(text);
const { bytes } = await app.buildPdf();
const re = await app.pdf.openPdf(bytes);
const pg = await re.getPage(1);
out.savedText = (await pg.getTextContent()).items.map((i) => i.str).join("").slice(0, 80);
return out;
