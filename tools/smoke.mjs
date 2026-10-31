// Headless smoke check in system Chrome: open the app, load a fixture, run a script in the page,
// print its JSON result and any console errors. Usage:
//   node tools/smoke.mjs <port> <script.js> [fixture=tests/fixtures/sample.pdf | none] [--phone] [--shot out.png]
// The script is the body of an async function with `app` (window.ocpdf) in scope; return a value.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const argv = process.argv.slice(2);
const shotAt = argv.indexOf("--shot");
const shot = shotAt >= 0 ? argv.splice(shotAt, 2)[1] : null;
const [port = "5185", script, fixture = "tests/fixtures/sample.pdf"] = argv.filter((a) => !a.startsWith("--"));
const phone = process.argv.includes("--phone");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.ocpdf);
if (fixture !== "none") {
  await page.evaluate(async (fx) => {
    const b = await fetch(`/${fx}`).then((r) => r.arrayBuffer());
    await window.ocpdf.open([new File([b], fx.split("/").pop(), { type: "application/pdf" })]);
  }, fixture);
}
let result = null;
if (script) {
  const body = readFileSync(script, "utf8");
  try { result = await page.evaluate(`(async (app) => { ${body} })(window.ocpdf)`); } catch (e) { result = { scriptError: String(e).slice(0, 500) }; }
}
if (shot) { await page.waitForTimeout(600); await page.screenshot({ path: shot }); }
console.log(JSON.stringify({ result, errors }, null, 1).slice(0, 4000));
await browser.close();
