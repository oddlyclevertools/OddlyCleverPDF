// Claude through the official SDK: Messages API, streaming, tool use, adaptive thinking with an
// explicit effort, and server-side refusal fallbacks on the Claude API. The conversation history is
// append-only: each assistant turn's `content` (thinking blocks included) goes back unchanged.
import { FriendlyError, StoppedError, clipText, safeImage } from "./common.js";
import { hostOf } from "../presets.js";

const MAX_TOKENS = 64000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Server-side fallbacks exist on the Claude API for Opus and Sonnet (Haiku has none).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

let sdk = null;
async function loadSdk() {
  if (!sdk) sdk = await import("@anthropic-ai/sdk");
  return sdk;
}

function makeClient(Anthropic, { apiKey, url }) {
  return new Anthropic({ apiKey, baseURL: url.replace(/\/+$/, "").replace(/\/v1$/, ""), dangerouslyAllowBrowser: true, maxRetries: 2 });
}

const isOfficial = (url) => hostOf(url) === "api.anthropic.com";

/** Turn an SDK error into a plain-English FriendlyError (or a StoppedError for Stop). */
function friendly(e, { model, url }, mod) {
  const A = mod.default;
  if (e instanceof A.APIUserAbortError || e?.name === "AbortError") return new StoppedError();
  const host = hostOf(url);
  const type = e?.error?.error?.type || e?.error?.type || "";
  if (e instanceof A.AuthenticationError) {
    return new FriendlyError("Claude didn't accept that key.", { hint: "Copy a fresh key from console.anthropic.com → API keys and paste it again." });
  }
  if (e instanceof A.PermissionDeniedError) return new FriendlyError(`This key isn't allowed to use ${model}.`, { hint: "Pick another model, or check your Anthropic account." });
  if (e instanceof A.NotFoundError) return new FriendlyError(`Claude doesn't know the model “${model}”.`, { hint: "Pick one from the list." });
  if (e instanceof A.RateLimitError) return new FriendlyError("Too many requests right now (rate limit).", { hint: "Wait a minute, then try again." });
  if (type === "overloaded_error" || e?.status === 529) return new FriendlyError("Claude is very busy right now (overloaded).", { hint: "Try again in a minute, or pick a smaller model." });
  if (e instanceof A.InternalServerError) return new FriendlyError(`Claude had a problem on its side (error ${e.status}).`, { hint: "Try again in a moment." });
  if (e instanceof A.BadRequestError) {
    const msg = e?.error?.error?.message || e.message || "";
    if (/credit balance/i.test(msg)) return new FriendlyError("Your Anthropic account is out of credit.", { hint: "Add credit at console.anthropic.com → Billing." });
    return new FriendlyError("Claude couldn't take this request.", { hint: msg.slice(0, 200) });
  }
  if (e instanceof A.APIConnectionTimeoutError) return new FriendlyError("Claude took too long to answer.", { hint: "Try again, or ask for something smaller." });
  if (e instanceof A.APIConnectionError) {
    return new FriendlyError(`Couldn't reach ${host}.`, { hint: "Check your internet connection (or the address under More settings)." });
  }
  if (e instanceof A.APIError) return new FriendlyError(`Claude returned an error${e.status ? ` (${e.status})` : ""}.`, { hint: (e.message || "").slice(0, 200) });
  return e instanceof Error ? e : new Error(String(e));
}

/** Check the key and the model without spending tokens (GET /v1/models/{model}). */
export async function testAnthropic({ apiKey, url, model }) {
  const mod = await loadSdk();
  try {
    const info = await makeClient(mod.default, { apiKey, url }).models.retrieve(model, { timeout: 15000, maxRetries: 0 });
    return `Connected. ${info?.display_name || model} is ready.`;
  } catch (e) {
    throw friendly(e, { model, url }, mod);
  }
}

/**
 * A Claude conversation. `step()` sends the history and returns what Claude did this turn.
 * @param {{ apiKey: string, url: string, model: string, effort: string, system: string, tools: object[] }} opts
 */
export function createAnthropicSession({ apiKey, url, model, effort, system, tools }) {
  const messages = [];
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true }));
  const fallbacks = isOfficial(url) && FALLBACK_MODELS.has(model);

  return {
    kind: "anthropic",
    /** @param {string} text @param {{mediaType: string, data: string}[]} [images] style references, shown before the words */
    addUser(text, images = []) {
      const pics = images.map(safeImage).filter(Boolean).map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }));
      messages.push({ role: "user", content: [...pics, { type: "text", text }] });
    },
    addToolResults(results) {
      messages.push({
        role: "user",
        content: results.map((r) => {
          const img = safeImage(r.image);
          const text = clipText(r.text || (r.isError ? "The tool failed." : "Done."));
          return {
            type: "tool_result",
            tool_use_id: r.id,
            content: img ? [{ type: "text", text }, { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }] : text,
            ...(r.isError ? { is_error: true } : {}),
          };
        }),
      });
    },
    async step({ signal, onText }) {
      const mod = await loadSdk();
      const client = makeClient(mod.default, { apiKey, url });
      const params = {
        model,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: system }],
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort },
        cache_control: { type: "ephemeral" },
        ...(toolDefs.length ? { tools: toolDefs, tool_choice: { type: "auto" } } : {}),
        ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
      };
      let msg;
      try {
        const stream = client.beta.messages.stream(params, { signal });
        stream.on("text", (delta) => onText?.(delta));
        msg = await stream.finalMessage();
      } catch (e) {
        throw friendly(e, { model, url }, mod);
      }
      // Append-only: the assistant content goes back exactly as it came (thinking blocks included).
      messages.push({ role: "assistant", content: msg.content });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      const toolCalls = msg.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const stop = msg.stop_reason === "tool_use" ? "tool_use"
        : msg.stop_reason === "refusal" ? "refusal"
          : msg.stop_reason === "max_tokens" ? "max_tokens"
            : msg.stop_reason === "pause_turn" ? "pause" : "end";
      return { text, toolCalls: stop === "max_tokens" || stop === "refusal" ? [] : toolCalls, pendingCalls: toolCalls, stop,
        refusal: stop === "refusal" ? (msg.stop_details || null) : null };
    },
  };
}
