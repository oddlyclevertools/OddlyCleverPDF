// Smoke check for the desktop app: start the exe with a PDF, check the page loaded inside WebView2,
// that the file opened, and that "Save PDF" writes a file to Downloads. Talks raw DevTools protocol,
// so WebView2's own download handling is what gets tested.
//   node desktop/tools/smoke_desktop.mjs "<path to OddlyClever PDF.exe>" [file.pdf]
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const [exe, pdf = "tests/fixtures/sample.pdf"] = process.argv.slice(2);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const downloads = join(homedir(), "Downloads");
const listPdfs = () => new Map(readdirSync(downloads).filter((f) => f.endsWith(".pdf")).map((f) => [f, statSync(join(downloads, f)).mtimeMs]));

const child = spawn(exe, pdf === "none" ? [] : [resolve(pdf)], {
  detached: true, stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
});
child.unref();

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page" && t.url.includes("oddlycleverpdf.local")); } catch { /* not up yet */ }
}
if (!target) { console.log(JSON.stringify({ ok: false, error: "no app page on the debug port" })); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

const until = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
const out = { ok: false, url: target.url };
out.appReady = await until("!!window.ocpdf");
out.webview = await evaluate("!!window.chrome?.webview");
out.secure = await evaluate("isSecureContext");
out.title = await evaluate("document.title");
if (pdf !== "none") {
  out.opened = await until("(window.ocpdf?.state?.pages?.length || 0) > 0");
  out.pages = await evaluate("window.ocpdf.state.pages.length");
  out.name = await evaluate("window.ocpdf.state.name");
  const before = listPdfs();
  await evaluate("document.querySelector('.save-btn')?.click(), true");
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    await sleep(500);
    for (const [f, t] of listPdfs()) if (!before.has(f) || before.get(f) !== t) saved = f;
  }
  out.saved = saved && join(downloads, saved);
  if (saved) await sleep(1000);
  out.savedBytes = saved ? statSync(join(downloads, saved)).size : 0;
}
out.sw = await evaluate("navigator.serviceWorker.getRegistration().then((r) => r ? (r.active ? 'active' : 'installing') : 'none')");
out.ok = !!(out.appReady && out.webview && out.secure && (pdf === "none" || (out.opened && out.savedBytes > 0)));
console.log(JSON.stringify(out, null, 1));
ws.close();
process.exit(out.ok ? 0 : 1);
