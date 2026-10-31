// Opens the showcase recording profile in a normal Chrome window so you can paste your own AI key
// into the app (Ask AI → Remember on this device). The recorder reuses this profile, so the key
// is there when the clips are made. Nothing here reads or prints the key.
// Usage: node tools/showcase_keys.mjs [port]   (the dev server must be running)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const port = process.argv[2] || "5185";
const profile = "showcase/.chrome-profile";
mkdirSync(profile, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chrome", headless: false, viewport: null, args: ["--start-maximized"],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  // a document must be open for the Ask AI panel
  const r = await fetch("/tests/fixtures/sample.pdf");
  await window.ocpdf.open([new File([await r.arrayBuffer()], "sample.pdf", { type: "application/pdf" })]);
  window.ocpdf.openPanel("ai");
});
console.log("The Ask AI panel is open. Paste your key, tick 'Remember on this device', press Test connection, then close the window.");
await new Promise((resolve) => ctx.on("close", resolve));
console.log("Saved. You can close this terminal.");
