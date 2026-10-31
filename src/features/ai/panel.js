// The "Ask AI" panel: a chat about the open PDF with starter chips, live progress with Stop,
// "Undo the AI", the choose-your-AI settings and the no-key paste mode.
import { el, icon, toast } from "../../ui/kit.js";
import { renderPaste } from "./paste-ui.js";
import { chosenLabel, renderSettings } from "./settings-ui.js";
import { providerById, privacyLine } from "./presets.js";
import { providerSettings } from "./settings.js";
import { hasKey } from "./keys.js";
import { renderAnswer } from "./answer.js";

/** One-click starters. `fill` ones end with a gap and wait for the user to finish the sentence. */
export const STARTERS = [
  { label: "Summarise this", text: "Summarise this PDF in a few short bullet points. Cite the pages.", icon: "ScrollText" },
  { label: "Explain it simply", text: "Explain this PDF in simple words, as if I had never seen it before. Cite the pages.", icon: "Lightbulb" },
  { label: "Find the key dates and money", text: "List every important date and amount of money in this PDF, with the page for each.", icon: "CalendarClock" },
  { label: "Fix spelling and grammar", text: "Find spelling and grammar mistakes in this PDF and fix each one in place. Change nothing else, and tell me what you changed.", icon: "SpellCheck" },
  { label: "Translate to…", text: "Translate this PDF into ", fill: true, icon: "Languages" },
  { label: "Fill this form for me", text: "Fill in the form fields in this PDF. Ask me for anything you don't know instead of guessing. My details: ", fill: true, icon: "ClipboardPen" },
  { label: "Highlight the important parts", text: "Highlight the most important sentences and numbers in this PDF, then tell me what you marked.", icon: "Highlighter" },
  { label: "Redact personal details", text: "Redact personal details in this PDF: email addresses, phone numbers, bank numbers and card numbers. Tell me what you covered.", icon: "EyeOff" },
  { label: "Turn this into a one-page summary page", text: "Write a one-page summary of this PDF and add it as a new first page.", icon: "FilePlus2" },
];

let lastTab = "ask";

function needsSetup() {
  const s = providerSettings();
  const p = providerById(s.id);
  return (!p.noKey && p.id !== "custom" && !hasKey(s.id)) || !s.model || !s.url;
}

export function renderAiPanel(box, app, ctrl, opts = {}) {
  const cleanups = [];
  const body = el("div.ai-body");
  const tabs = el("div.ai-tabs", { role: "tablist" }, [["ask", "Ask AI", "Sparkles"], ["paste", "No key? Paste", "ClipboardPaste"]].map(([id, label, ic]) =>
    el("button.ai-tab", { type: "button", role: "tab", dataset: { tab: id }, on: { click: () => show(id) } }, icon(ic, 15), label)));
  box.append(el("div.ai-wrap", {}, tabs, body));

  function show(id) {
    lastTab = id;
    for (const b of tabs.children) {
      const on = b.dataset.tab === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    while (cleanups.length) cleanups.pop()?.();
    body.replaceChildren();
    if (id === "ask") renderAsk(body); else renderPasteTab(body);
  }

  function jump(n) {
    app.viewer.scrollToPage(n - 1);
    if (app.isPhone()) app.closePanel();
  }

  function entryNode(e) {
    if (e.kind === "user") return el("div.ai-msg.user", {}, e.text);
    if (e.kind === "ai") return el("div.ai-msg.ai", { class: e.live ? "live" : null }, ...renderAnswer(e.text, { onJump: jump, pageCount: app.state.pages.length }));
    if (e.kind === "step") {
      const ic = e.state === "ok" ? "Check" : e.state === "bad" ? "X" : "LoaderCircle";
      return el("div.ai-step", { class: e.state }, el("span.ai-step-ico", {}, icon(ic, 13)), el("span", {}, e.text, e.detail ? el("small", {}, e.detail) : null));
    }
    if (e.kind === "error") return el("div.ai-msg.err", { role: "alert" }, icon("TriangleAlert", 15), el("p", {}, e.text, e.hint ? el("small", {}, e.hint) : null));
    return el("div.ai-msg.note", {}, icon("Info", 14), el("p", {}, e.text));
  }

  // ---- Ask tab -------------------------------------------------------------------------------
  function renderAsk(host) {
    const chipName = el("b");
    const chipWhere = el("span.ai-where");
    const settings = renderSettings({ onChange: () => { ctrl.resetConversation?.(); syncChip(); drawState(); } });
    const settingsBox = el("div.ai-settings-box", { hidden: !needsSetup() }, settings);
    const chip = el("button.ai-chip", { type: "button", title: "Choose your AI", "aria-expanded": String(!settingsBox.hidden),
      on: { click: () => { settingsBox.hidden = !settingsBox.hidden; chip.setAttribute("aria-expanded", String(!settingsBox.hidden)); } } },
    icon("Bot", 16), chipName, chipWhere, el("span.grow"), el("span.ai-change", {}, "Change"), icon("ChevronDown", 14));
    function syncChip() {
      const s = providerSettings();
      chipName.textContent = chosenLabel();
      const local = privacyLine(s.url).local;
      chipWhere.textContent = local ? "On this PC" : "Cloud";
      chipWhere.className = `ai-where ${local ? "local" : "cloud"}`;
    }
    syncChip();

    const log = el("div.ai-log", { "aria-live": "polite" });
    const nodes = new Map();
    const starters = el("div.ai-starters", {}, STARTERS.map((st) => el("button.ai-starter", { type: "button", on: { click: () => starter(st) } }, icon(st.icon, 15), st.label)));
    const empty = el("div.ai-empty", {}, el("h4", {}, "Ask about this PDF"), el("p", {}, "Pick an idea or type your own. The AI can read it, answer, and make changes you can undo."), starters);
    const typing = el("div.ai-typing", { "aria-hidden": "true" }, el("span.ai-typing-dots", {}, el("i"), el("i"), el("i")));

    const input = el("textarea.ai-input", { rows: 2, placeholder: "Ask anything about this PDF…", "aria-label": "Ask the AI",
      on: { keydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } } } });
    const sendBtn = el("button.btn.primary.ai-send", { type: "button", title: "Send (Enter)", "aria-label": "Send", on: { click: () => submit() } }, icon("SendHorizontal", 18));
    const stopBtn = el("button.btn.ai-stop", { type: "button", title: "Stop the AI", "aria-label": "Stop", on: { click: () => ctrl.stop() } }, icon("Square", 16), "Stop");
    const status = el("div.ai-status", { role: "status" }, el("span.ai-dot"), el("span.ai-status-text"));
    const undoBtn = el("button.btn.small.ai-undo", { type: "button", title: "Put the PDF back to how it was before the AI's last run", on: { click: () => ctrl.undoAI() } }, icon("Undo2", 15), "Undo the AI");
    const newBtn = el("button.btn.small.ghost.ai-new", { type: "button", title: "Start a new chat (the PDF stays as it is)", on: { click: () => ctrl.newChat() } }, icon("MessageSquarePlus", 15), "New chat");
    const starterRow = el("div.ai-starters.mini", {}, STARTERS.map((st) => el("button.ai-starter", { type: "button", on: { click: () => starter(st) } }, st.label)));
    const composer = el("div.ai-composer", {}, input, el("div.ai-actions", {}, sendBtn, stopBtn));

    host.append(...[chip, settingsBox, opts.hint ? el("p.ai-tip", {}, icon("Info", 14), opts.hint) : null, log, status, composer, el("div.ai-runbar", {}, undoBtn, el("span.grow"), newBtn), starterRow,
      el("p.ai-privacy-line", {}, icon("Lock", 13), "Your PDF's text goes only to the AI you pick. Nothing else leaves this device.")].filter(Boolean));

    function starter(st) {
      input.value = st.text;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      if (!st.fill && !ctrl.running) submit();
    }

    async function submit() {
      const text = input.value.trim();
      if (!text || ctrl.running) return;
      if (!app.state.pages.length) { toast("Open a PDF first.", { error: true }); return; }
      if (needsSetup()) {
        settingsBox.hidden = false;
        chip.setAttribute("aria-expanded", "true");
        toast(providerById(providerSettings().id).noKey ? "Type the model name first." : "Paste your API key first, or use “No key? Paste”.", { error: true });
        return;
      }
      const before = ctrl.entries.length;
      input.value = "";
      settingsBox.hidden = true;
      chip.setAttribute("aria-expanded", "false");
      await ctrl.send(text);
      if (ctrl.entries.length === before) input.value = text; // cancelled before sending: give the words back
    }

    function drawLog() {
      const entries = ctrl.entries;
      const keep = new Set(entries.map((e) => e.id));
      for (const [id, n] of nodes) if (!keep.has(id)) { n.node.remove(); nodes.delete(id); }
      for (const e of entries) {
        const have = nodes.get(e.id);
        if (have && have.entry === e) continue;
        const node = entryNode(e);
        if (have) have.node.replaceWith(node); else log.append(node);
        nodes.set(e.id, { entry: e, node });
      }
      empty.remove();
      if (!entries.length) log.append(empty);
      placeTyping();
      log.scrollTop = log.scrollHeight;
    }
    function drawState() {
      const busy = ctrl.running;
      sendBtn.hidden = busy;
      stopBtn.hidden = !busy;
      status.classList.toggle("on", busy);
      status.querySelector(".ai-status-text").textContent = ctrl.status || (busy ? "Working…" : "");
      undoBtn.disabled = !ctrl.canUndo();
      newBtn.disabled = busy || !ctrl.entries.length;
      starterRow.hidden = !ctrl.entries.length || busy;
      placeTyping();
    }
    function placeTyping() {
      const last = ctrl.entries.at(-1);
      if (!(ctrl.running && !(last?.kind === "ai" && last.live))) { typing.remove(); return; }
      if (log.lastElementChild !== typing) { log.append(typing); log.scrollTop = log.scrollHeight; }
    }
    drawLog();
    drawState();
    cleanups.push(ctrl.onChange((ev) => {
      if (ev.type === "entry" || ev.type === "all") drawLog();
      if (ev.type === "needs-settings") { settingsBox.hidden = false; chip.setAttribute("aria-expanded", "true"); }
      drawState();
    }));
    cleanups.push(app.store.on((e) => { if (e.type === "change") drawState(); }));
    if (opts.prefill) { input.value = opts.prefill; }
    if (opts.prefill || !needsSetup()) requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  }

  function renderPasteTab(host) {
    host.append(renderPaste(app, ctrl, { initial: opts.prefill || "" }));
    const log = el("div.ai-log.compact", { "aria-live": "polite" });
    const draw = () => log.replaceChildren(...ctrl.entries.slice(-30).map(entryNode));
    draw();
    host.append(log);
    cleanups.push(ctrl.onChange(draw));
  }

  show(opts.tab || lastTab);
  return () => { while (cleanups.length) cleanups.pop()?.(); };
}
