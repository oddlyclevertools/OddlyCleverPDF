// The agent loop, provider-neutral: ask the AI, run the tools it asks for (one at a time, through
// the toolkit runTool), send the results back, repeat until it answers in words. Tool errors go
// back to the AI as error results so it can recover. Capped at MAX_STEPS and stoppable at any time.
import { isStop, throwIfStopped } from "./providers/common.js";
import { validateInput } from "./validate.js";

export const MAX_STEPS = 40;

/** A friendly progress line for a tool call: the tool's own label if it has one. */
export function stepLabel(name, input, toolkit) {
  const def = toolkit?.TOOLS?.find((t) => t.name === name);
  try { const l = def?.label?.(input || {}); if (l) return l; } catch { /* fall back */ }
  return `${String(name || "tool").replace(/_/g, " ")}…`;
}

/**
 * Check one tool call and run it. Never throws except for Stop.
 * @returns {Promise<{ id, name, text, image?, isError }>}
 */
export async function runOneTool(app, toolkit, call, signal) {
  const tools = toolkit.TOOLS || [];
  const def = tools.find((t) => t.name === call.name);
  const fail = (text) => ({ id: call.id, name: call.name, text, isError: true });
  if (call.inputError) return fail(call.inputError);
  if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) return fail("The tool input must be a JSON object.");
  // While the toolkit is still empty every name is passed through, so its own error shows.
  if (tools.length && !def) return fail(`There's no tool called “${call.name}”. Use one of: ${tools.map((t) => t.name).join(", ")}.`);
  if (def) {
    const problems = validateInput(def.input_schema, call.input);
    if (problems.length) return fail(`The input doesn't fit the tool: ${problems.join("; ")}.`);
  }
  try {
    const out = await toolkit.runTool(app, call.name, call.input, { signal });
    return { id: call.id, name: call.name, text: typeof out?.text === "string" ? out.text : "Done.", image: out?.image, isError: false };
  } catch (e) {
    if (isStop(e) || signal?.aborted) throw e;
    return fail(e?.message || String(e));
  }
}

/**
 * Run the loop on a session that already has the user's message.
 * @param {{ app, session, toolkit, signal: AbortSignal, onEvent?: (e: object) => void, maxSteps?: number }} o
 * @returns {Promise<{ status: "done"|"refused"|"cut"|"cap"|"stopped", text: string, steps: number, refusal?: object, errors: number }>}
 */
export async function runAgent({ app, session, toolkit, signal, onEvent = () => {}, maxSteps = MAX_STEPS }) {
  let steps = 0, errors = 0, lastText = "";
  try {
    for (let turn = 0; turn < maxSteps; turn++) {
      throwIfStopped(signal);
      onEvent({ type: "turn", turn });
      const res = await session.step({ signal, onText: (d) => onEvent({ type: "text", delta: d }) });
      if (res.text) lastText = res.text;
      onEvent({ type: "said", text: res.text, hasTools: res.toolCalls.length > 0 });
      if (res.stop === "refusal") return { status: "refused", text: res.text, refusal: res.refusal, steps, errors };
      if (res.stop === "max_tokens" || (!res.toolCalls.length && res.pendingCalls?.length)) {
        // Unrun calls still get answers, so the conversation stays valid for the next message.
        if (res.pendingCalls?.length) {
          session.addToolResults(res.pendingCalls.map((c) => ({ id: c.id, name: c.name, text: "Not run: the answer was cut off.", isError: true })));
        }
        return { status: "cut", text: lastText, steps, errors };
      }
      if (res.stop === "pause") continue;
      if (!res.toolCalls.length) return { status: "done", text: lastText, steps, errors };

      const results = [];
      for (const call of res.toolCalls) {
        if (signal?.aborted) {
          results.push({ id: call.id, name: call.name, text: "Cancelled: the user pressed Stop.", isError: true });
          continue;
        }
        steps++;
        const label = stepLabel(call.name, call.input, toolkit);
        onEvent({ type: "tool", call, label });
        try {
          const r = await runOneTool(app, toolkit, call, signal);
          if (r.isError) errors++;
          onEvent({ type: "tool-done", call, label, ok: !r.isError, error: r.isError ? r.text : "" });
          results.push(r);
        } catch (e) {
          if (!isStop(e) && !signal?.aborted) throw e;
          results.push({ id: call.id, name: call.name, text: "Cancelled: the user pressed Stop.", isError: true });
          onEvent({ type: "tool-done", call, label, ok: false, error: "Stopped" });
        }
      }
      session.addToolResults(results);
      if (signal?.aborted) return { status: "stopped", text: lastText, steps, errors };
    }
    return { status: "cap", text: lastText, steps, errors };
  } catch (e) {
    if (isStop(e) || signal?.aborted) return { status: "stopped", text: lastText, steps, errors };
    throw e;
  }
}
