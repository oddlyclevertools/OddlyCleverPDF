// Make tests/fixtures/scan.pdf: page 1 of sample.pdf drawn as a JPEG-only page (no text), like a scan.
// Needs a dev server: node tools/make_scan_fixture.mjs <port>
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const port = process.argv[2] || "5214";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.ocpdf);
const b64 = await page.evaluate(async () => {
  const app = window.ocpdf;
  const src = await fetch("/tests/fixtures/sample.pdf").then((r) => r.arrayBuffer());
  const pdf = await app.pdf.openPdf(new Uint8Array(src));
  const canvas = await app.pdf.pageToCanvas(pdf, 0, { scale: 200 / 72 }); // 200 dpi, like a scanner
  const jpg = canvas.toDataURL("image/jpeg", 0.8);
  const bytes = Uint8Array.from(atob(jpg.split(",")[1]), (c) => c.charCodeAt(0));
  const doc = await app.pdfLib.PDFDocument.create();
  const img = await doc.embedJpg(bytes);
  const pg = doc.addPage([595.28, 841.89]);
  pg.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const out = await doc.save();
  let s = ""; for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
});
writeFileSync("tests/fixtures/scan.pdf", Buffer.from(b64, "base64"));
console.log("tests/fixtures/scan.pdf written");
await browser.close();
