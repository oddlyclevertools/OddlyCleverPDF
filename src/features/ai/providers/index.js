// One door to every provider: start a conversation session, or test a connection.
import { createAnthropicSession, testAnthropic } from "./anthropic.js";
import { createOpenAISession, testOpenAI } from "./openai.js";
import { FriendlyError } from "./common.js";
import { providerById, isLocalUrl } from "../presets.js";

function needKey(p, apiKey) {
  if (!p.noKey && !apiKey && p.kind === "anthropic") throw new FriendlyError("Paste your Claude API key first.", { hint: "Get one at console.anthropic.com → API keys." });
  if (!p.noKey && !apiKey && p.id !== "custom") throw new FriendlyError(`Paste your ${p.name} API key first.`);
}

/** A key must never travel unencrypted over the internet (plain http is fine only on this computer). */
function needSafeUrl(url, apiKey) {
  if (apiKey && /^http:\/\//i.test(url || "") && !isLocalUrl(url)) {
    throw new FriendlyError("That address starts with http://, so your key would be sent unprotected.", { hint: "Use the https:// address instead." });
  }
}

/**
 * @param {{ id: string, kind: string, url: string, model: string, vision: boolean, effort: string }} s settings
 * @param {string} apiKey
 * @param {{ system: string, tools: object[] }} ctx
 */
export function createSession(s, apiKey, { system, tools }) {
  const p = providerById(s.id);
  needKey(p, apiKey);
  needSafeUrl(s.url, apiKey);
  if (!s.model) throw new FriendlyError("Type the model name first.", { hint: p.hint ? `For example ${p.hint}.` : "" });
  if (p.kind === "anthropic") return createAnthropicSession({ apiKey, url: s.url, model: s.model, effort: s.effort, system, tools });
  return createOpenAISession({ apiKey, url: s.url, model: s.model, vision: s.vision, effort: s.effort, providerId: p.id, system, tools });
}

/** @returns {Promise<string>} a friendly "Connected…" line, or throws a FriendlyError. */
export function testConnection(s, apiKey) {
  const p = providerById(s.id);
  needKey(p, apiKey);
  needSafeUrl(s.url, apiKey);
  if (p.kind === "anthropic") return testAnthropic({ apiKey, url: s.url, model: s.model });
  return testOpenAI({ apiKey, url: s.url, model: s.model, providerId: p.id });
}
