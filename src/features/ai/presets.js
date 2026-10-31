// Provider presets for "Choose your AI". Claude goes through the official SDK; everything else
// speaks the OpenAI chat-completions format. Model names change often, so for the OpenAI-style
// providers they are only placeholders: the user types the exact name their provider lists.
// Cost hints are rough guesses for one question (about 5–15 steps) and say so in the UI.

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Best results (recommended)", cost: "about $0.20–0.60 per question" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Faster and cheaper", cost: "about $0.10–0.30 per question" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "Cheapest", cost: "about 1–3 cents per question" },
];

/**
 * Thinking levels, quickest first. Claude takes all five but "auto" (its `output_config.effort`,
 * always sent explicitly); OpenAI-style providers list the ones they take as `reasoning_effort`
 * in `thinking`, and "auto" sends nothing so the model uses its own default.
 */
export const EFFORTS = [
  { id: "auto", name: "Auto", tip: "The model's own default" },
  { id: "minimal", name: "Minimal", tip: "Barely thinks: fastest" },
  { id: "low", name: "Quick", tip: "Thinks a little: fast and cheap" },
  { id: "medium", name: "Normal", tip: "A good balance" },
  { id: "high", name: "Deep", tip: "Thinks hard: slower, better layouts" },
  { id: "xhigh", name: "Deeper", tip: "Thinks very hard" },
  { id: "max", name: "Max", tip: "Thinks as long as it needs: slowest, costs the most" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const STANDARD = ["auto", "low", "medium", "high"];

/** The thinking levels one provider offers, in EFFORTS order. */
export function effortsFor(p) {
  const ids = p.kind === "anthropic" ? CLAUDE_EFFORTS : p.thinking || STANDARD;
  return EFFORTS.filter((e) => ids.includes(e.id));
}

/** The level a provider starts on. */
export const defaultEffort = (p) => (p.kind === "anthropic" ? "medium" : "auto");

export const PROVIDERS = [
  { id: "claude", kind: "anthropic", group: "Recommended", name: "Claude (Anthropic)", url: "https://api.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys", vision: true },
  { id: "ollama", kind: "openai", group: "Free, on this PC", name: "Ollama", url: "http://127.0.0.1:11434/v1", local: true,
    hint: "e.g. qwen3:8b", cost: "Free", noKey: true },
  { id: "lmstudio", kind: "openai", group: "Free, on this PC", name: "LM Studio", url: "http://127.0.0.1:1234/v1", local: true,
    hint: "the model you loaded", cost: "Free", noKey: true },
  { id: "llamacpp", kind: "openai", group: "Free, on this PC", name: "llama.cpp server", url: "http://127.0.0.1:8080/v1", local: true,
    hint: "any name works", cost: "Free", noKey: true },
  { id: "openai", kind: "openai", group: "Other cloud AIs", name: "OpenAI (ChatGPT API)", url: "https://api.openai.com/v1",
    hint: "a model from your OpenAI account", cost: "a few cents per question, depends on the model", keyUrl: "https://platform.openai.com/api-keys", vision: true,
    thinking: ["auto", "minimal", "low", "medium", "high", "xhigh"] },
  { id: "gemini", kind: "openai", group: "Other cloud AIs", name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai",
    hint: "a Gemini model name", cost: "free tier, then a few cents per question", keyUrl: "https://aistudio.google.com/apikey", vision: true },
  { id: "openrouter", kind: "openai", group: "Other cloud AIs", name: "OpenRouter (hundreds of models)", url: "https://openrouter.ai/api/v1",
    hint: "provider/model", cost: "depends on the model; some are free", keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", kind: "openai", group: "Other cloud AIs", name: "Groq", url: "https://api.groq.com/openai/v1",
    hint: "a Groq model name", cost: "free tier with limits", keyUrl: "https://console.groq.com/keys" },
  { id: "mistral", kind: "openai", group: "Other cloud AIs", name: "Mistral", url: "https://api.mistral.ai/v1",
    hint: "a Mistral model name", cost: "free tier for testing, then cheap", keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "deepseek", kind: "openai", group: "Other cloud AIs", name: "DeepSeek", url: "https://api.deepseek.com/v1",
    hint: "a DeepSeek model name", cost: "very cheap (around a cent per question)", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "bai", kind: "openai", group: "Other cloud AIs", name: "B.AI (Claude, GLM, Gemini, DeepSeek…)", url: "https://api.b.ai/v1",
    hint: "e.g. glm-5.3-flash", cost: "GLM Flash is very cheap (under a cent per question)", keyUrl: "https://docs.b.ai/llmservice/api/", vision: true,
    thinking: ["auto", "low", "medium", "high", "max"] },
  { id: "custom", kind: "openai", group: "Other cloud AIs", name: "Other (any OpenAI-compatible API)", url: "",
    hint: "model name", cost: "depends on the provider" },
];

// Browser CORS (checked 28 Oct 2026 with curl: OPTIONS + Origin http://localhost:5181, no key):
// Anthropic (with the SDK's headers), OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek and B.AI all
// allow web pages to call them. If one stops doing so, the provider error explains it in plain words.

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

export function hostOf(url) {
  try { return new URL(url).host; } catch { return url || "?"; }
}

export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
  } catch { return false; }
}

/** One plain line: where your PDF's text goes when the user presses Send. */
export function privacyLine(url) {
  return isLocalUrl(url)
    ? { local: true, text: "On this PC: nothing leaves your computer." }
    : { local: false, text: `Cloud: the PDF text and your request are sent to ${hostOf(url)} when you press Send.` };
}

/** The one-time setup a local server needs so a web page may call it. */
export function localSetup(providerId) {
  const origin = location.origin;
  const onLocalhost = isLocalUrl(origin);
  if (providerId === "ollama") {
    return {
      title: "Ollama: free, private, runs on your graphics card",
      steps: [
        "Install Ollama from ollama.com, then run: ollama pull qwen3:8b",
        onLocalhost
          ? "Ollama lets pages on localhost call it, so it should just work."
          : "Let this page call Ollama (one time):",
      ],
      command: onLocalhost ? `setx OLLAMA_ORIGINS "${origin}"   (only if Test connection fails)` : `setx OLLAMA_ORIGINS "${origin}"`,
      after: "Then quit Ollama from the tray and start it again.",
    };
  }
  if (providerId === "lmstudio") {
    return {
      title: "LM Studio: free, private, runs on your graphics card",
      steps: ["Download a model in LM Studio and load it.",
        "Open the Developer tab, start the server, and switch on “Enable CORS” in its settings."],
    };
  }
  if (providerId === "llamacpp") {
    return {
      title: "llama.cpp: free, private, runs on your graphics card",
      steps: ["Start it with: llama-server -m your-model.gguf --jinja -ngl 99",
        "--jinja turns on tool calls; -ngl 99 puts the model on the graphics card."],
    };
  }
  return null;
}
