// Ask AI: chat with the open PDF, bring your own AI (Claude, OpenAI-style, local, or paste into any
// chat). The AI calls the PDF toolkit; every run is one undo step.
import "./ai.css";
import { createController } from "./controller.js";
import { renderAiPanel } from "./panel.js";
import { loadRememberedKeys } from "./keys.js";

export function install(app) {
  const ctrl = createController(app);
  app.ai = ctrl; // for tests and other features
  loadRememberedKeys();
  app.store.on((e) => { if (e.type === "doc") ctrl.newChat(); });

  let dispose = null;
  app.registerPanel({
    id: "ai", title: "Ask AI", label: "Ask AI", icon: "Sparkles", order: 60, belt: true, accent: true,
    render(box, opts = {}) {
      dispose?.();
      dispose = renderAiPanel(box, app, ctrl, opts);
    },
  });

  const TASKS = [
    { id: "ai-chat", title: "Chat with a PDF", blurb: "Ask questions, get answers with page links", icon: "MessageCircleQuestion", color: "violet", popular: true, order: 8,
      prefill: "", cmd: "Chat with this PDF" },
    { id: "ai-summarise", title: "Summarise a PDF", blurb: "The short version, with page links", icon: "ScrollText", color: "mint", order: 10,
      prefill: "Summarise this PDF in a few short bullet points. Cite the pages.", cmd: "Summarise this PDF" },
    { id: "ai-translate", title: "Translate a PDF", blurb: "Retype it in another language, in place", icon: "Languages", color: "cyan", order: 12,
      prefill: "Translate this PDF into ", cmd: "Translate this PDF",
      hint: "Short PDFs are retyped in place, page by page, over the original words. Long or crowded ones get the translation on new pages instead. Either way you can undo it in one go." },
    { id: "ai-form", title: "Fill a form with AI", blurb: "Tell it your details, it fills the fields", icon: "ClipboardPen", color: "pink", order: 14,
      prefill: "Fill in the form fields in this PDF. Ask me for anything you don't know instead of guessing. My details: ", cmd: "Fill this form with AI" },
  ];

  const openAsk = (t) => app.openPanel("ai", { tab: "ask", prefill: t.prefill, hint: t.hint });
  for (const t of TASKS) {
    app.registerTask({
      id: t.id, title: t.title, blurb: t.blurb, icon: t.icon, color: t.color, group: "ai", popular: t.popular, order: t.order,
      files: "one", accept: "application/pdf,.pdf", usesOpenDoc: true,
      run: async (a, files) => {
        if (files?.length && !(await a.open(files))) return;
        openAsk(t);
      },
    });
  }
  app.registerCommands((a) => [
    ...TASKS.map((t) => ({
      id: `ai:${t.id}`, label: t.cmd, group: "Ask AI", icon: t.icon, keywords: `ai chat ask ${t.title} ${t.blurb}`,
      run: () => (a.state.pages.length ? openAsk(t) : a.runTask(t.id)),
    })),
    { id: "ai:paste", label: "Use any chat (no key)", group: "Ask AI", icon: "ClipboardPaste", keywords: "paste chatgpt claude no key", run: () => a.openPanel("ai", { tab: "paste" }) },
  ]);
}
