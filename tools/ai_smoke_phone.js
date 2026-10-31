// Phone view of the Ask AI panel with a short scripted chat (screenshot: --phone --shot tools/_ai_phone.png).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (name, args) => ({ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tc) => ({ choices: [{ finish_reason: tc ? "tool_calls" : "stop", message: { role: "assistant", content: content || "", ...(tc ? { tool_calls: tc } : {}) } }] });
const queue = [reply("", [call("read_pages", { pages: "1" })]), reply("", [call("highlight_text", { quote: "250.00" })]),
  reply("This is an invoice: the total due is **250.00 GBP** by 30 November 2026 (p. 1). I highlighted the amount for you. Pages 2 and 3 repeat it (p. 2, p. 3).")];
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:5999/") ? new Response(JSON.stringify(queue.shift())) : realFetch(url, init);
const settings = await import("/src/features/ai/settings.js");
settings.chooseProvider("custom"); settings.updateProviderSettings("custom", { url: "http://127.0.0.1:5999/v1", model: "mock" });
app.openPanel("ai");
await sleep(300);
document.querySelector(".ai-input").value = "Summarise this and highlight the amount";
document.querySelector(".ai-send").click();
await sleep(800);
for (let i = 0; i < 50 && app.ai.running; i++) await sleep(100);
const small = [...document.querySelectorAll(".panel button, .panel textarea, .panel select")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40 && !b.classList.contains("ai-cite")).map((b) => `${b.className}:${Math.round(b.getBoundingClientRect().height)}`);
const input = document.querySelector(".ai-input").getBoundingClientRect();
return { small: small.slice(0, 10), inputBottom: Math.round(input.bottom), vh: innerHeight, scrollW: document.documentElement.scrollWidth, panelH: Math.round(document.querySelector(".panel").getBoundingClientRect().height) };
