// Non-secret AI settings (which provider, model, address, vision, effort), kept in localStorage so
// they survive a reload. Keys are NEVER stored here: they live in keys.js.
import { CLAUDE_MODELS, defaultEffort, effortsFor, providerById } from "./presets.js";

const STORE_KEY = "ocpdf.ai.settings";
const ALLOWED = ["model", "url", "vision", "effort"];

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

let state = read();

function write(next) {
  state = next;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage blocked: memory only */ }
}

export function currentProviderId() {
  return providerById(state.provider).id;
}

/** The full settings for one provider, with defaults filled in. */
export function providerSettings(id = currentProviderId()) {
  const p = providerById(id);
  const saved = state.per?.[p.id] || {};
  return {
    id: p.id,
    kind: p.kind,
    url: typeof saved.url === "string" && saved.url ? saved.url : p.url,
    model: typeof saved.model === "string" && saved.model ? saved.model : (p.kind === "anthropic" ? CLAUDE_MODELS[0].id : ""),
    vision: typeof saved.vision === "boolean" ? saved.vision : Boolean(p.vision),
    effort: effortsFor(p).some((e) => e.id === saved.effort) ? saved.effort : defaultEffort(p),
  };
}

export function chooseProvider(id) {
  write({ ...state, provider: providerById(id).id });
}

/** Change some settings of one provider (unknown fields are ignored). */
export function updateProviderSettings(id, patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ALLOWED.includes(k)));
  const per = { ...(state.per || {}) };
  per[id] = { ...(per[id] || {}), ...clean };
  write({ ...state, per });
}
