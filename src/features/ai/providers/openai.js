// Any OpenAI-compatible chat API (OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, Ollama,
// LM Studio, llama.cpp, custom): POST {url}/chat/completions with function-calling `tools`.
// Pictures from tools go in a user message after the tool results, as data URLs, only when the
// user says the model can see pictures.
import { FriendlyError, StoppedError, clipText, safeImage } from "./common.js";
import { hostOf, isLocalUrl, localSetup } from "../presets.js";

const TIMEOUT_MS = 180000;
const base = (url) => url.replace(/\/+$/, "");

function headers(apiKey) {
  return { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
}

/** fetch with the user's Stop signal plus a timeout; network failures become plain English. */
async function call(url, init, { signal, providerId, timeout = TIMEOUT_MS }) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeout);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw new StoppedError();
    if (ctl.signal.aborted) throw new FriendlyError("The AI took too long to answer.", { hint: "Try again, or ask for something smaller." });
    throw networkError(url, providerId, e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function networkError(url, providerId) {
  const host = hostOf(url);
  if (isLocalUrl(url)) {
    const setup = localSetup(providerId);
    const fix = providerId === "ollama" ? "Is Ollama running? If it is, the page may need permission: see the setup box."
      : providerId === "lmstudio" ? "Is the LM Studio server started, with “Enable CORS” on?"
        : "Is the server running on this PC, and does it allow web pages (CORS)?";
    return new FriendlyError(`Couldn't reach ${setup?.title?.split(":")[0] || "the AI"} at ${host}.`, { hint: fix });
  }
  return new FriendlyError(`Couldn't reach ${host}.`, {
    hint: "Check your internet connection and the address. If both are right, this provider may not let web pages call it directly: use “Paste into any chat” instead.",
  });
}

async function httpError(res, { model }) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || (typeof body?.error === "string" ? body.error : "");
  } catch { /* not JSON */ }
  detail = String(detail || "").slice(0, 200);
  const s = res.status;
  if (s === 401 || s === 403) return new FriendlyError("The provider didn't accept that key.", { hint: "Check the key (and that it belongs to this provider), then paste it again." });
  if (s === 404) return new FriendlyError(`The provider doesn't know the model “${model}” (or the address is wrong).`, { hint: detail || "Check the model name your provider lists." });
  if (s === 429) return new FriendlyError("Too many requests, or the free allowance is used up (rate limit).", { hint: detail || "Wait a minute, then try again." });
  if (s >= 500) return new FriendlyError(`The provider had a problem on its side (error ${s}).`, { hint: detail || "Try again in a moment." });
  if (s === 400 && /tool|function/i.test(detail)) {
    return new FriendlyError("This model can't use tools.", { hint: "Pick a model that supports tool or function calling, or use “Paste into any chat”." });
  }
  return new FriendlyError(`The provider returned an error (${s}).`, { hint: detail });
}

/** Check the address and key: GET {url}/models, then look for the model name. */
export async function testOpenAI({ apiKey, url, model, providerId }) {
  if (!url) throw new FriendlyError("Type the provider's address first.");
  const res = await call(`${base(url)}/models`, { headers: headers(apiKey) }, { providerId, timeout: 15000 });
  if (!res.ok) throw await httpError(res, { model });
  let ids = [];
  try { ids = ((await res.json())?.data || []).map((m) => String(m.id)); } catch { /* some servers return nothing */ }
  if (model && ids.length && !ids.some((id) => id === model || id.endsWith(`/${model}`) || id === `models/${model}`)) {
    // Suggest names that share a word with what was typed (glm, flash…) before the rest.
    const words = model.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const score = (id) => words.filter((w) => id.toLowerCase().includes(w)).length;
    const likely = [...ids].sort((a, b) => score(b) - score(a));
    return `Connected, but “${model}” isn't in its list. Try: ${likely.slice(0, 4).join(", ")}`;
  }
  return model ? `Connected. ${model} is ready.` : "Connected. Now type a model name.";
}

/**
 * True when a 400 is about the thinking level itself (the model takes no `reasoning_effort`, or
 * not that value), so the step can be retried at the model's own default.
 */
const effortRejected = (detail) => /reasoning|effort|thinking/i.test(detail);

/** @param {{ apiKey: string, url: string, model: string, vision: boolean, effort?: string, providerId: string, system: string, tools: object[] }} opts */
export function createOpenAISession({ apiKey, url, model, vision, effort = "auto", providerId, system, tools }) {
  const messages = [{ role: "system", content: system }];
  const toolDefs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  let seq = 0;
  let thinking = effort && effort !== "auto" ? effort : null;

  return {
    kind: "openai",
    /** Set once, when the model refused the chosen thinking level and runs at its default. */
    effortNote: "",
    /** @param {string} text @param {{mediaType: string, data: string}[]} [images] style references */
    addUser(text, images = []) {
      const pics = images.map(safeImage).filter(Boolean);
      if (!pics.length) { messages.push({ role: "user", content: text }); return; }
      if (!vision) {
        messages.push({ role: "user", content: `${text}\n\n(I attached ${pics.length} reference picture${pics.length === 1 ? "" : "s"}, but this model can't see pictures. Work from the measured notes above.)` });
        return;
      }
      messages.push({ role: "user", content: [{ type: "text", text },
        ...pics.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } }))] });
    },
    addToolResults(results) {
      const pictures = [];
      for (const r of results) {
        const img = safeImage(r.image);
        let text = clipText(r.text || (r.isError ? "The tool failed." : "Done."));
        if (r.isError) text = `Error: ${text}`;
        if (img && vision) pictures.push({ name: r.name, img });
        else if (img) text += "\n(The tool made a picture, but this model can't see pictures.)";
        messages.push({ role: "tool", tool_call_id: r.id, content: text });
      }
      if (pictures.length) {
        messages.push({
          role: "user",
          content: pictures.flatMap(({ name, img }) => [
            { type: "text", text: `The picture from ${name}:` },
            { type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } },
          ]),
        });
      }
    },
    async step({ signal }) {
      const send = () => {
        const body = { model, messages, ...(toolDefs.length ? { tools: toolDefs, tool_choice: "auto" } : {}), ...(thinking ? { reasoning_effort: thinking } : {}) };
        return call(`${base(url)}/chat/completions`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body) }, { signal, providerId });
      };
      let res = await send();
      if (!res.ok && res.status === 400 && thinking) {
        const err = await httpError(res, { model });
        if (!effortRejected(`${err.message} ${err.hint || ""}`)) throw err;
        this.effortNote = `${model} doesn't take the “${thinking}” thinking level, so it uses its own default.`;
        thinking = null;
        res = await send();
      }
      if (!res.ok) throw await httpError(res, { model });
      let data;
      try { data = await res.json(); } catch { throw new FriendlyError("The provider sent back something that isn't JSON."); }
      const choice = data?.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw new FriendlyError("The provider sent back an empty answer.", { hint: data?.error?.message || "" });
      const calls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).filter((c) => c?.function?.name);
      // Keep only the standard fields (some providers reject their own extras when sent back).
      const kept = calls.map((c) => ({ id: c.id || `call_${Date.now().toString(36)}_${seq++}`, type: "function",
        function: { name: String(c.function.name), arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) } }));
      messages.push({ role: "assistant", content: typeof msg.content === "string" ? msg.content : "", ...(kept.length ? { tool_calls: kept } : {}) });
      const toolCalls = kept.map((c) => {
        let input, inputError = "";
        try { input = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { inputError = "The tool input wasn't valid JSON."; input = null; }
        return { id: c.id, name: c.function.name, input, inputError };
      });
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      const fr = choice.finish_reason;
      const stop = toolCalls.length ? "tool_use" : fr === "length" ? "max_tokens" : fr === "content_filter" ? "refusal" : "end";
      return { text, toolCalls, pendingCalls: toolCalls, stop, refusal: null };
    },
  };
}
