// The "No key? Paste into any chat" tab: copy a prompt, paste the reply, check it, run it.
import { el, icon, toast } from "../../ui/kit.js";
import { buildPastePrompt, parsePlan } from "./paste.js";

async function copyText(text) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000));
  try { await Promise.race([navigator.clipboard.writeText(text), timeout]); return true; } catch { return false; }
}

export function renderPaste(app, ctrl, { initial = "" } = {}) {
  const ask = el("textarea.ai-paste-ask", { rows: 3, placeholder: "What should it do? e.g. Summarise this in five bullets", "aria-label": "What should the AI do?" });
  ask.value = initial;
  const promptBox = el("textarea.ai-paste-prompt", { rows: 5, readOnly: true, hidden: true, "aria-label": "The prompt to copy" });
  const reply = el("textarea.ai-paste-reply", { rows: 5, placeholder: 'Paste the reply here, e.g. {"plan": [...], "note": "..."}', "aria-label": "The AI's reply" });
  const preview = el("div.ai-preview", { role: "status" });

  const copy = el("button.btn.ai-copy", { type: "button", on: { click: async () => {
    const text = await buildPastePrompt(app, await ctrl.toolkitReady(), ask.value);
    if (await copyText(text)) {
      promptBox.hidden = true;
      toast("Prompt copied. Paste it into any AI chat, then paste its reply below.");
    } else {
      promptBox.value = text;
      promptBox.hidden = false;
      promptBox.focus();
      promptBox.select();
      toast("Couldn't reach the clipboard. The prompt is selected: copy it by hand.");
    }
  } } }, icon("Copy", 16), "Copy prompt");

  const check = el("button.btn.ai-check", { type: "button", on: { click: async () => {
    if (!reply.value.trim()) { toast("Paste the AI's reply first.", { error: true }); return; }
    let plan;
    try { plan = parsePlan(reply.value, await ctrl.toolkitReady()); } catch (e) {
      preview.className = "ai-preview bad";
      preview.replaceChildren(icon("CircleX", 14), e.message);
      return;
    }
    const kinds = Object.entries(plan.counts).map(([k, n]) => `${k.replace(/_/g, " ")} ×${n}`).join(", ");
    const run = el("button.btn.primary.ai-run-plan", { type: "button", disabled: !plan.steps.length || ctrl.running, on: { click: async () => {
      run.disabled = true;
      await ctrl.runPlan(plan.steps, plan.note);
    } } }, icon("Play", 16), plan.steps.length ? `Run ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}` : "Nothing to run");
    preview.className = `ai-preview ${plan.problems.length ? "warn" : "ok"}`;
    preview.replaceChildren(...[
      el("b", {}, `${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} ready`),
      kinds ? el("span", {}, kinds) : null,
      plan.note ? el("em", {}, plan.note) : null,
      plan.problems.length ? el("details", {}, el("summary", {}, `${plan.problems.length} step${plan.problems.length === 1 ? "" : "s"} skipped`),
        el("ul", {}, plan.problems.slice(0, 12).map((p) => el("li", {}, p)))) : null,
      run].filter(Boolean));
  } } }, icon("ClipboardCheck", 16), "Check reply");

  return el("div.ai-paste", {},
    el("p.ai-lede", {}, "No key needed. This works with your normal ChatGPT or Claude.ai chat."),
    el("div.ai-stepnum", {}, el("span", {}, "1"), "Say what you want, then copy the prompt"), ask, el("div.row", {}, copy), promptBox,
    el("div.ai-stepnum", {}, el("span", {}, "2"), "Paste it into any AI chat"),
    el("div.ai-stepnum", {}, el("span", {}, "3"), "Paste its reply here"), reply, el("div.row", {}, check),
    preview);
}
