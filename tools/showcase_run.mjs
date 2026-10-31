// Records one showcase clip: the real app in Chrome (the showcase profile, so a saved AI key is
// there), a visible pointer, Chrome's screencast encoded with NVENC on the RTX at 1080p30.
// Feature demos only: never record fixing or debugging.
//   node tools/showcase_run.mjs showcase/scripts/sc_edit_text.mjs [--phone] [--dry]
// --dry runs the script without recording (to check it works before the real take).
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { basename, join } from "node:path";
import { startRecorder } from "./showcase_record.mjs";

const [scriptPath, ...flags] = process.argv.slice(2);
const phone = flags.includes("--phone"), dry = flags.includes("--dry");
const port = process.env.PORT || "5185";
// SHOWCASE_PROFILE lets helpers dry-run in their own empty profile (the real one holds the AI key)
const ctx = await chromium.launchPersistentContext(process.env.SHOWCASE_PROFILE || "showcase/.chrome-profile", {
  channel: "chrome", headless: true, colorScheme: "light",
  args: ["--force-high-performance-gpu"],
  ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }),
});
await ctx.addInitScript({ path: "tools/showcase_cursor.js" });
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.ocpdf?.state, null, { timeout: 15000 });
// the same starting point for every take: Paper Desk, no saved work, nothing open
await page.evaluate(() => new Promise((done) => {
  localStorage.setItem("ocpdf.look", JSON.stringify("paper-desk"));
  const r = indexedDB.open("oddlyclever-pdf", 1); // forget autosaved work, so no "Continue" card
  r.onsuccess = () => { try { const t = r.result.transaction("session", "readwrite"); t.objectStore("session").delete("current"); t.oncomplete = done; t.onerror = done; } catch { done(); } };
  r.onerror = done;
}));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const out = join("showcase/clips", `${basename(scriptPath).replace(/\.m?js$/, "")}.mp4`);
const recorder = dry ? null : await startRecorder(page, out);
let result = null;
try {
  result = await (await import(pathToFileURL(scriptPath).href)).default({ page, phone });
  await page.waitForTimeout(600);
} finally {
  if (recorder) console.log(`recorded ${await recorder.stop()}`);
  await page.screenshot({ path: out.replace(/\.mp4$/, dry ? ".dry.png" : ".png") });
  console.log(JSON.stringify({ result, errors: errors.slice(0, 10) }, null, 1));
  await ctx.close();
}
