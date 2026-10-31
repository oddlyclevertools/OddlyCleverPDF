// Smoke script for node tools/smoke.mjs <port> tools/ai_smoke_chat.js: the Ask AI panel against a
// scripted OpenAI-compatible mock (fetch to http://127.0.0.1:5999/v1/* is routed in the page).
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (name, args) => ({ id: `c_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => ({ choices: [{ finish_reason: tool_calls?.length ? "tool_calls" : "stop", message: { role: "assistant", content: content || "", ...(tool_calls?.length ? { tool_calls } : {}) } }] });

const queue = [];
const seen = { requests: 0, auth: false, toolNames: [], system: "" };
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => {
  if (String(url).startsWith("http://127.0.0.1:5999/v1/")) {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "mock" }] }), { headers: { "content-type": "application/json" } });
    const body = JSON.parse(init.body);
    seen.requests++;
    seen.auth = seen.auth || Boolean(init.headers?.authorization);
    seen.toolNames = body.tools.map((t) => t.function.name);
    seen.system = body.messages[0].content;
    const next = queue.shift();
    const msg = typeof next === "function" ? next(body) : next;
    return new Response(JSON.stringify(msg || reply("(nothing scripted)")), { headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};

const settings = await import("/src/features/ai/settings.js");
settings.chooseProvider("custom");
settings.updateProviderSettings("custom", { url: "http://127.0.0.1:5999/v1", model: "mock", vision: false });

const textOf = async (bytes) => {
  const pdf = await app.pdf.openPdf(bytes);
  return app.pdf.pagePlainText(pdf, 0);
};
const click = async (sel, text) => {
  const b = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.includes(text));
  if (!b) throw new Error(`no ${sel} ${text || ""}`);
  b.click();
  await sleep(50);
};
const waitIdle = async () => { await sleep(250); for (let i = 0; i < 100 && app.ai.running; i++) await sleep(100); await sleep(100); };

app.openPanel("ai");
await sleep(300);

// ---- A: summarise (read_pages, then an answer with page chips) --------------------------------
queue.push(reply("", [call("read_pages", { pages: "1-3", boxes: false })]),
  reply("This is an invoice for **250.00 GBP**, due by 30 November 2026 (p. 1). The same letter repeats on p. 2 and p. 3."));
await click(".ai-starter", "Summarise this");
await waitIdle();
const chips = [...document.querySelectorAll(".ai-cite")].map((c) => c.textContent);
out.summarise = { chips, steps: [...document.querySelectorAll(".ai-step")].map((s) => s.textContent), requests: seen.requests, tools: seen.toolNames.length };
document.querySelectorAll(".ai-cite")[2]?.click();
await sleep(600);
out.summarise.pageAfterChip = app.currentPageIndex() + 1;
out.noKeyAuthHeader = seen.auth;
out.systemMentionsCite = /Cite pages/.test(seen.system);

// ---- B: edits in one run (highlight, replace, fill form) ---------------------------------------
const labelBefore = app.store.undoLabel();
queue.push(
  reply("", [call("highlight_text", { quote: "250.00", pages: 1 })]),
  reply("", [call("replace_text", { page: 1, find: "250.00", replace: "199.00" }), call("fill_form", { values: { name: "Ada Lovelace" } })]),
  reply("", [call("read_pages", { pages: 1, boxes: false })]),
  reply("Done: I changed the total to 199.00 (p. 1) and filled your name."));
await sleep(100);
document.querySelector(".ai-input").value = "Change the total to 199.00 and fill my name as Ada Lovelace";
document.querySelector(".ai-send").click();
await waitIdle();
const objs = app.state.pages[0].objects;
out.edit = {
  types: objs.map((o) => o.type),
  highlightX: Math.round(objs.find((o) => o.type === "highlight")?.rects[0].x),
  textObj: objs.find((o) => o.type === "text")?.text,
  cover: Boolean(objs.find((o) => o.type === "text")?.cover),
  form: app.state.form.name,
  undoLabel: app.store.undoLabel(),
  stepsShown: [...document.querySelectorAll(".ai-step")].map((s) => s.textContent).slice(-5),
};
const built = await app.buildPdf({ skipSteps: ["security"] });
out.edit.savedHas199 = (await textOf(built.bytes)).includes("199.00");
out.edit.undoBtnEnabled = !document.querySelector(".ai-undo").disabled;
// one "Undo the AI" removes the whole run
document.querySelector(".ai-undo").click();
await sleep(200);
out.undo = { objects: app.state.pages[0].objects.length, formName: app.state.form.name ?? null, backToBefore: app.store.undoLabel() === labelBefore };
app.store.redo();

// ---- B2: redact (objects only) ----------------------------------------------------------------
queue.push(reply("", [call("redact_text", { quote: "Gadget", pages: 2 }), call("redact_text", { kinds: ["email"], pages: "all" })]), reply("Covered the word on p. 2."));
document.querySelector(".ai-input").value = "Redact the word Gadget";
document.querySelector(".ai-send").click();
await waitIdle();
out.redact = { page2: app.state.pages[1].objects.filter((o) => o.type === "redact").length, steps: [...document.querySelectorAll(".ai-step")].map((s) => s.className + ":" + s.textContent).slice(-2) };
document.querySelector(".ai-undo").click();
await sleep(200);
out.redact.afterUndo = app.state.pages[1].objects.length;
app.store.redo();

// ---- C: summary page ------------------------------------------------------------------------
queue.push(reply("", [call("add_summary_page", { title: "Summary", text: "- Invoice 101 for 199.00 GBP\n- Due 30 November 2026", after: 0 })]), reply("I added a summary page at the start (p. 1)."));
document.querySelector(".ai-input").value = "Turn this into a one-page summary page";
document.querySelector(".ai-send").click();
await waitIdle();
out.summaryPage = { pages: app.state.pages.length };
out.summaryPage.firstIsNew = app.state.pages[0].src.fileId !== app.state.pages[1].src.fileId;

out.lastEntries = app.ai.entries.slice(-4).map((e) => `${e.kind}: ${(e.text || "").slice(0, 100)} ${e.detail || ""}`);
out.errors = [...document.querySelectorAll(".ai-msg.err")].map((e) => e.textContent);
return out;
