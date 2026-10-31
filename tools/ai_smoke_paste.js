// Paste mode: build the prompt, paste a plan back, check it, run it. Plus: keys stay out of storage.
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { buildPastePrompt } = await import("/src/features/ai/paste.js");
const tk = await import("/src/features/ai/toolkit/index.js");
const prompt = await buildPastePrompt(app, { ...tk, GUIDE: tk.GUIDE }, "Highlight the total");
out.prompt = { hasDocText: prompt.includes("The total amount due is 250.00"), hasTools: prompt.includes('"name":"highlight_text"'), hasFields: prompt.includes("name (text)"), chars: prompt.length };

app.openPanel("ai", { tab: "paste", prefill: "Highlight the total" });
await sleep(300);
out.prefilled = document.querySelector(".ai-paste-ask").value;
const plan = { plan: [
  { tool: "highlight_text", input: { quote: "250.00", pages: 1 } },
  { tool: "fill_form", input: { values: { name: "Grace Hopper", agree: true, plan: "pro" } } },
  { tool: "replace_text", input: { page: 1, find: "no such words", replace: "x" } },
  { tool: "bogus", input: {} },
], note: "Marked the total." };
document.querySelector(".ai-paste-reply").value = "Sure! ```json\n" + JSON.stringify(plan) + "\n```";
document.querySelector(".ai-check").click();
await sleep(200);
out.preview = document.querySelector(".ai-preview").textContent.slice(0, 200);
const before = app.store.undoLabel();
document.querySelector(".ai-run-plan").click();
await sleep(200);
for (let i = 0; i < 50 && app.ai.running; i++) await sleep(100);
out.run = { objects: app.state.pages[0].objects.map((o) => o.type), form: { ...app.state.form }, label: app.store.undoLabel(), changed: app.store.undoLabel() !== before,
  steps: app.ai.entries.filter((e) => e.kind === "step").map((e) => e.state) };
app.store.undo();
out.run.afterOneUndo = { objects: app.state.pages[0].objects.length, form: { ...app.state.form } };

// keys stay out of storage unless "remember" is ticked
const keys = await import("/src/features/ai/keys.js");
await keys.setKey("openai", "FAKE-TEST-KEY-123");
const dump = JSON.stringify({ ...localStorage }) + JSON.stringify(location.href);
const dbs = (await indexedDB.databases?.()) || [];
let inDb = false;
if (dbs.some((d) => d.name === "oddlyclever-pdf-ai")) {
  inDb = await new Promise((res) => { const r = indexedDB.open("oddlyclever-pdf-ai"); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("keys")) return res(false); const q = db.transaction("keys").objectStore("keys").getAll(); q.onsuccess = () => res(q.result.length > 0); }; r.onerror = () => res(false); });
}
out.keys = { inMemory: keys.hasKey("openai"), inLocalStorage: dump.includes("FAKE-TEST-KEY"), inIndexedDb: inDb, settingsKey: Object.keys(localStorage).filter((k) => k.includes("ai")) };
await keys.forgetKey("openai");
return out;
