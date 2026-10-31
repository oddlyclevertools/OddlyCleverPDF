// The AI run controller: one conversation per open PDF, the chat log, Stop and "Undo the AI".
// A run opens ONE undo step (store.begin ... store.end) and the tools change the document directly
// inside it, so the whole run is a single Ctrl+Z.
import { confirmDialog, toast } from "../../ui/kit.js";
import { runAgent, runOneTool, stepLabel } from "./loop.js";
import { createSession } from "./providers/index.js";
import { isStop } from "./providers/common.js";
import { hostOf, isLocalUrl } from "./presets.js";
import { getKey } from "./keys.js";
import { providerSettings } from "./settings.js";
import { docHeader } from "./summary.js";
import * as toolkit from "./toolkit/index.js";

let entrySeq = 0;

export function createController(app) {
  let tk = toolkit; // tests may swap it
  let entries = [];
  let running = false, abort = null, status = "";
  let conv = null; // { session, key }
  let lastRun = null; // { label }
  const consented = new Set(); // cloud hosts the user agreed to send to (this session only)
  const listeners = new Set();
  const emit = (e = { type: "all" }) => { for (const fn of listeners) fn(e); };

  const add = (entry) => {
    const e = { id: ++entrySeq, ...entry };
    entries = [...entries, e];
    emit({ type: "entry", entry: e });
    return e.id;
  };
  const patch = (id, change) => {
    entries = entries.map((e) => (e.id === id ? { ...e, ...change } : e));
    emit({ type: "entry", entry: entries.find((e) => e.id === id) });
  };
  const setStatus = (s) => { status = s; emit({ type: "status" }); };

  /** Run `fn(signal)` as one undoable AI run. */
  async function asRun(label, fn) {
    const before = JSON.stringify({ pages: app.state.pages, form: app.state.form, meta: app.state.meta, extras: app.state.extras });
    running = true;
    abort = new AbortController();
    emit({ type: "running" });
    tk.beginRun(app);
    app.store.begin();
    try {
      return await fn(abort.signal);
    } finally {
      const after = JSON.stringify({ pages: app.state.pages, form: app.state.form, meta: app.state.meta, extras: app.state.extras });
      app.store.end(label);
      tk.endRun();
      lastRun = after !== before ? { label } : null;
      running = false;
      abort = null;
      setStatus("");
      emit({ type: "running" });
    }
  }

  async function okToSend(s) {
    if (isLocalUrl(s.url)) return true;
    const host = hostOf(s.url);
    if (consented.has(host)) return true;
    const ok = await confirmDialog(`Send this PDF's text to ${host}?`,
      `The text of your PDF (and pictures of pages if the AI asks to look) goes to ${host}, and nothing else leaves this device. Your key stays in this browser. Continue?`, "Send");
    if (ok) consented.add(host);
    return ok;
  }

  const sessionKey = (s) => `${s.id}|${s.url}|${s.model}|${s.effort}|${s.vision}|${getKey(s.id).length}`;
  const showError = (e) => add({ kind: "error", text: e?.message || String(e), hint: e?.hint || "" });

  async function send(text) {
    const request = String(text || "").trim();
    if (!request || running) return null;
    if (!app.state.pages.length) { toast("Open a PDF first.", { error: true }); return null; }
    const s = providerSettings();
    if (!(await okToSend(s))) return null;
    let first = false;
    if (!conv || conv.key !== sessionKey(s)) {
      try {
        const system = `${tk.GUIDE}\n\n## The PDF when this chat started\n${await docHeader(app)}`;
        conv = { session: createSession(s, getKey(s.id), { system, tools: tk.TOOLS }), key: sessionKey(s) };
        first = true;
      } catch (e) {
        add({ kind: "user", text: request });
        showError(e);
        emit({ type: "needs-settings" });
        return null;
      }
    }
    add({ kind: "user", text: request });
    conv.session.addUser(first ? request : `${request}\n\n(Now: ${app.state.pages.length} pages; the user is on page ${(app.currentPageIndex?.() ?? 0) + 1}.)`);
    const session = conv.session;
    return asRun(`AI: ${request.slice(0, 40)}`, async (signal) => {
      let bubble = null, bubbleText = "", shown = false;
      const stepEntries = new Map();
      const onEvent = (ev) => {
        if (ev.type === "turn") setStatus("Thinking…");
        else if (ev.type === "text") {
          bubbleText += ev.delta;
          if (!bubble) bubble = add({ kind: "ai", text: bubbleText, live: true });
          else patch(bubble, { text: bubbleText });
          shown = true;
        } else if (ev.type === "said") {
          if (ev.text && !bubble) { add({ kind: "ai", text: ev.text }); shown = true; }
          else if (bubble) patch(bubble, { text: ev.text || bubbleText, live: false });
          bubble = null;
          bubbleText = "";
        } else if (ev.type === "tool") {
          setStatus(ev.label);
          stepEntries.set(ev.call.id, add({ kind: "step", text: ev.label, state: "busy" }));
        } else if (ev.type === "tool-done") {
          patch(stepEntries.get(ev.call.id), { state: ev.ok ? "ok" : "bad", detail: ev.ok ? "" : String(ev.error || "").slice(0, 160) });
        }
      };
      try {
        const r = await runAgent({ app, session, toolkit: tk, signal, onEvent });
        if (session.effortNote && !session.effortNoteShown) { session.effortNoteShown = true; add({ kind: "note", text: session.effortNote }); }
        if (r.status === "done" && !shown) add({ kind: "ai", text: "Done." });
        if (r.status === "refused") add({ kind: "error", text: "The AI declined this request.", hint: r.refusal?.explanation || "Try asking in a different way." });
        if (r.status === "cut") add({ kind: "error", text: "The answer got too long and was cut off.", hint: "Ask for a smaller change at a time, or fewer pages." });
        if (r.status === "cap") add({ kind: "note", text: `Paused after ${r.steps} steps to keep things quick. Say “keep going” for more.` });
        if (r.status === "stopped") add({ kind: "note", text: "Stopped. What it already did stays; “Undo the AI” removes it." });
        return r;
      } catch (e) {
        conv = null;
        if (!isStop(e)) showError(e);
        return { status: "error", error: e };
      }
    });
  }

  /** Run a checked paste-mode plan, one step at a time. */
  async function runPlan(steps, note = "") {
    if (running || !steps?.length) return null;
    if (!app.state.pages.length) { toast("Open a PDF first.", { error: true }); return null; }
    add({ kind: "user", text: `Run the pasted plan (${steps.length} step${steps.length === 1 ? "" : "s"}).` });
    return asRun("AI: pasted plan", async (signal) => {
      let ok = 0, bad = 0, i = 0;
      for (const s of steps) {
        if (signal.aborted) break;
        const label = stepLabel(s.tool, s.input, tk);
        setStatus(label);
        const id = add({ kind: "step", text: label, state: "busy" });
        try {
          const r = await runOneTool(app, tk, { id: `plan_${i++}`, name: s.tool, input: s.input }, signal);
          if (r.isError) bad++; else ok++;
          patch(id, { state: r.isError ? "bad" : "ok", detail: r.isError ? r.text.slice(0, 160) : "" });
        } catch (e) {
          patch(id, { state: "bad", detail: isStop(e) ? "Stopped" : String(e?.message || e).slice(0, 160) });
          break;
        }
      }
      const stopped = signal.aborted;
      add({ kind: stopped ? "note" : "ai", text: stopped ? "Stopped. What it already did stays; “Undo the AI” removes it."
        : `${note ? `${note}\n\n` : ""}Ran ${ok} step${ok === 1 ? "" : "s"}${bad ? `, ${bad} failed` : ""}.` });
      return { ok, bad, stopped };
    });
  }

  const stop = () => abort?.abort();
  const canUndo = () => Boolean(lastRun && !running && app.store.canUndo() && app.store.undoLabel() === lastRun.label);

  /** Undo the whole last run: it is exactly one step on the undo stack. */
  function undoAI() {
    if (running) return false;
    if (!canUndo()) { toast("You've changed the PDF since. Use Undo at the top to go back step by step.", { error: true }); return false; }
    app.store.undo();
    lastRun = null;
    add({ kind: "note", text: "Undid the AI's changes. Redo at the top brings them back." });
    emit({ type: "running" });
    return true;
  }

  function newChat() {
    if (running) return;
    conv = null;
    entries = [];
    lastRun = null;
    emit({ type: "all" });
  }

  return {
    send, runPlan, stop, undoAI, newChat, canUndo,
    resetConversation: () => { conv = null; },
    get toolkit() { return tk; },
    toolkitReady: async () => tk,
    setToolkit(x) { tk = x || toolkit; conv = null; },
    get entries() { return entries; },
    get running() { return running; },
    get status() { return status; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
