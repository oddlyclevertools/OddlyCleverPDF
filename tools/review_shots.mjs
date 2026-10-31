// Screenshots of the main screens (desktop + phone) into tools/_review/, plus a contact sheet.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("tools/_review", { recursive: true });
const port = process.argv[2] || "5185";
const b = await chromium.launch({ channel: "chrome" });
const shots = [];
for (const [dev, vp] of [["desk", { viewport: { width: 1280, height: 820 } }], ["phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage(vp);
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `tools/_review/${dev}-home.png` }); shots.push(`${dev}-home`);
  await p.evaluate(async () => { const r = await fetch("/tests/fixtures/sample.pdf"); await window.ocpdf.open([new File([await r.arrayBuffer()], "sample.pdf", { type: "application/pdf" })]); });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `tools/_review/${dev}-editor.png` }); shots.push(`${dev}-editor`);
  for (const id of ["pages", "doc", "convert", "ai"]) {
    await p.evaluate((id) => window.ocpdf.openPanel(id), id);
    await p.waitForTimeout(900);
    await p.screenshot({ path: `tools/_review/${dev}-${id}.png` }); shots.push(`${dev}-${id}`);
  }
  await p.evaluate(() => { window.ocpdf.closePanel(); window.ocpdf.useTool("sign"); });
  await p.close();
}
await b.close();
console.log(shots.join(" "));
