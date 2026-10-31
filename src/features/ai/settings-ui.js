// "Choose your AI": provider, model, effort, address, key (memory by default, opt-in remember,
// Forget key), "can see pictures", local-model setup help, a rough cost hint, the privacy line and
// Test connection.
import { el, icon, toggle, toast } from "../../ui/kit.js";
import { CLAUDE_MODELS, effortsFor, PROVIDERS, localSetup, privacyLine, providerById } from "./presets.js";
import { chooseProvider, providerSettings, updateProviderSettings } from "./settings.js";
import { forgetKey, getKey, isRemembered, setKey } from "./keys.js";
import { testConnection } from "./providers/index.js";

/** A one-line label for the chosen AI ("Claude Opus 5.5", "Ollama · qwen3:8b"). */
export function chosenLabel() {
  const s = providerSettings();
  const p = providerById(s.id);
  if (p.kind === "anthropic") return CLAUDE_MODELS.find((m) => m.id === s.model)?.name || s.model;
  return `${p.name.replace(/\s*\(.*\)$/, "")}${s.model ? ` · ${s.model}` : ""}`;
}

export function costHint(s = providerSettings()) {
  const p = providerById(s.id);
  if (p.kind === "anthropic") return CLAUDE_MODELS.find((m) => m.id === s.model)?.cost || "depends on the model";
  return p.cost || "depends on the provider";
}

function field(label, control, hint) {
  return el("label.ai-field", {}, el("span.ai-label", {}, label), control, hint ? el("span.ai-hint", {}, hint) : null);
}

/**
 * @param {{ onChange: () => void }} opts  called after any change that alters the chosen AI
 * @returns {HTMLElement}
 */
export function renderSettings({ onChange }) {
  const root = el("div.ai-settings");
  const changed = () => { onChange(); draw(); };

  function draw() {
    const s = providerSettings();
    const p = providerById(s.id);
    const groups = [...new Set(PROVIDERS.map((x) => x.group))];
    const providerSel = el("select.sel.ai-provider", { "aria-label": "Choose your AI", on: { change: () => { chooseProvider(providerSel.value); changed(); } } },
      groups.map((g) => el("optgroup", { label: g }, PROVIDERS.filter((x) => x.group === g).map((x) =>
        el("option", { value: x.id, selected: x.id === s.id }, x.id === "claude" ? "Claude (Anthropic) · best" : x.name)))));

    let modelCtl;
    if (p.kind === "anthropic") {
      modelCtl = el("div.ai-models", { role: "radiogroup", "aria-label": "Claude model" }, CLAUDE_MODELS.map((m) =>
        el("button.ai-model", { type: "button", role: "radio", "aria-checked": String(m.id === s.model), class: m.id === s.model ? "on" : null,
          on: { click: () => { updateProviderSettings(s.id, { model: m.id }); changed(); } } },
        el("b", {}, m.name.replace("Claude ", "")), el("span", {}, m.note))));
    } else {
      const input = el("input.ai-model-input", { type: "text", value: s.model, placeholder: p.hint || "model name", spellcheck: false, autocomplete: "off",
        "aria-label": "Model name", on: { change: () => { updateProviderSettings(s.id, { model: input.value.trim() }); changed(); } } });
      modelCtl = input;
    }

    // Thinking level, for every provider (each lists the levels it takes).
    const levels = effortsFor(p);
    const chosen = levels.find((e) => e.id === s.effort) || levels[0];
    const effort = field("Thinking", el("div.ai-seg.ai-effort", { role: "radiogroup", "aria-label": "How much it thinks" }, levels.map((e) =>
      el("button", { type: "button", role: "radio", title: e.tip, "aria-checked": String(e.id === chosen.id), class: e.id === chosen.id ? "on" : null,
        on: { click: () => { updateProviderSettings(s.id, { effort: e.id }); changed(); } } }, e.name))),
    `${chosen.tip}.${p.kind === "anthropic" ? "" : " If a model can't take a level, it runs at its own default and tells you."}`);

    // Key: in memory unless the user ticks Remember.
    const keyInput = el("input.ai-key", { type: "password", value: getKey(s.id), placeholder: "paste your key",
      autocomplete: "off", spellcheck: false, "aria-label": "API key",
      on: { change: async () => {
        try { await setKey(s.id, keyInput.value, { remember: isRemembered(s.id) }); } catch (e) { toast(e.message, { error: true }); }
        onChange();
        draw();
      } } });
    const remember = toggle({ label: "Remember on this device", value: isRemembered(s.id), onChange: async (on) => {
      try {
        await setKey(s.id, keyInput.value, { remember: on });
        toast(on ? "Key saved in this browser only (never in your PDF)." : "Key no longer saved. It's kept until you close the tab.");
      } catch (e) { toast(`Couldn't save the key: ${e.message}`, { error: true }); }
      draw();
    } });
    const forget = el("button.btn.small.ghost.ai-forget", { type: "button", title: "Remove the key from this browser",
      on: { click: async () => { await forgetKey(s.id); onChange(); draw(); toast("Key forgotten."); } } }, icon("Trash2", 14), "Forget key");
    const keyBox = p.noKey ? null : el("div.ai-keybox", {},
      field("Your key (API key)", keyInput, getKey(s.id) ? (isRemembered(s.id) ? "Saved in this browser." : "Kept in memory only: gone when you close the tab.") : null),
      el("div.row", {}, remember, el("span.grow"), getKey(s.id) ? forget : null),
      p.keyUrl ? el("a.ai-link", { href: p.keyUrl, target: "_blank", rel: "noopener noreferrer" }, icon("KeyRound", 13), "Get a key") : null);

    const urlInput = el("input.ai-url", { type: "text", value: s.url, placeholder: "https://…/v1", spellcheck: false, autocomplete: "off",
      "aria-label": "Address", on: { change: () => { updateProviderSettings(s.id, { url: urlInput.value.trim() }); changed(); } } });
    const vision = p.kind === "anthropic" ? null : toggle({ label: "This model can see pictures", value: s.vision,
      onChange: (on) => { updateProviderSettings(s.id, { vision: on }); onChange(); } });
    // the rarely needed bits stay folded away
    const more = el("details.ai-more", { open: p.id === "custom" || !s.url },
      el("summary", {}, "More settings"), effort, field("Address", urlInput, p.kind === "anthropic" ? "Leave as is unless you use a proxy." : null), vision);

    const setup = localSetup(p.id);
    const setupBox = setup ? el("div.ai-setup", {}, el("b", {}, icon("Cpu", 14), setup.title),
      el("ol", {}, setup.steps.map((t) => el("li", {}, t))),
      setup.command ? el("code.ai-cmd", {}, setup.command) : null,
      setup.after ? el("p", {}, setup.after) : null) : null;

    const priv = privacyLine(s.url);
    const result = el("div.ai-test-result", { role: "status" });
    const testBtn = el("button.btn.small.ai-test", { type: "button", on: { click: async () => {
      testBtn.disabled = true;
      result.className = "ai-test-result busy";
      result.textContent = "Checking…";
      try {
        const msg = await testConnection(providerSettings(), getKey(s.id));
        result.className = "ai-test-result ok";
        result.replaceChildren(icon("CircleCheck", 14), msg);
      } catch (e) {
        result.className = "ai-test-result bad";
        result.replaceChildren(icon("CircleX", 14), el("span", {}, e.message, e.hint ? el("small", {}, e.hint) : null));
      } finally { testBtn.disabled = false; }
    } } }, icon("Plug", 14), "Test connection");

    root.replaceChildren(...[
      field("Choose your AI", providerSel),
      keyBox,
      field(p.kind === "anthropic" ? "Model" : "Model name", modelCtl),
      setupBox, more,
      el("div.ai-facts", {},
        el("div", { class: `ai-privacy ${priv.local ? "local" : "cloud"}` }, icon(priv.local ? "Monitor" : "Cloud", 14), priv.text),
        el("div.ai-cost", {}, icon("Info", 14), `Cost: ${costHint(s)} (rough guess).`)),
      el("div.row", {}, testBtn, result)].filter(Boolean));
  }

  draw();
  root.redraw = draw;
  return root;
}

