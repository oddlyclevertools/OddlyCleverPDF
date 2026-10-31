import { describe, it, expect, beforeEach } from "vitest";
import * as store from "../../src/core/store.js";
import { groupLines } from "../../src/core/text.js";
import { TOOLS, runTool, beginRun, endRun } from "../../src/features/ai/toolkit/index.js";
import { validateInput } from "../../src/features/ai/validate.js";
import { parsePlan } from "../../src/features/ai/paste.js";
import { findCites } from "../../src/features/ai/answer.js";
import { findMatches, parsePages, quoteRegex, toRegex, PII } from "../../src/features/ai/textmatch.js";
import { effortsFor, providerById, PROVIDERS, CLAUDE_MODELS } from "../../src/features/ai/presets.js";

const run = (str, x, y, w) => ({ str, x, y, w, h: 12, size: 12, family: "sans", bold: false, italic: false });
const LINES = groupLines([
  run("The total amount due is ", 60, 100, 130), run("250.00", 190, 100, 36), run(" GBP", 226, 100, 24),
  run("Email ann@example.com or call +44 7700 900123", 60, 120, 250),
]);

function fakeApp() {
  store.reset("t.pdf");
  store.state.pages = [{ id: "p1", src: { fileId: "f", index: 0 }, box: [0, 0, 595, 842], w: 595, h: 842, rotate: 0, objects: [] }];
  return { state: store.state, store, currentPageIndex: () => 0, pageLines: async () => LINES, exporters: () => [] };
}

describe("tool schemas", () => {
  it("every tool has a name, description, object schema, label and run", () => {
    const names = new Set();
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe("object");
      expect(typeof t.label({})).toBe("string");
      expect(typeof t.run).toBe("function");
    }
    for (const n of ["get_document", "read_pages", "search_text", "look_at_page", "add_text", "replace_text", "highlight_text", "add_note", "draw_box", "draw_arrow", "redact_text", "fill_form", "pages", "add_summary_page", "export_as", "undo"]) {
      expect(names.has(n)).toBe(true);
    }
  });
  it("rejects bad inputs with a readable list", () => {
    const def = (n) => TOOLS.find((t) => t.name === n).input_schema;
    expect(validateInput(def("replace_text"), { page: 1, find: "a" })[0]).toMatch(/replace is missing/);
    expect(validateInput(def("add_text"), { page: 0, x: 1, y: 1, text: "x" })[0]).toMatch(/at least 1/);
    expect(validateInput(def("pages"), { action: "explode" })[0]).toMatch(/one of/);
    expect(validateInput(def("highlight_text"), { quote: "a", extra: 1 })[0]).toMatch(/isn't allowed/);
    expect(validateInput(def("draw_box"), { page: 1, x: 0, y: 0, w: 10, h: 10, stroke: 5 })[0]).toMatch(/string/);
    expect(validateInput(def("read_pages"), { pages: "1-3" })).toEqual([]);
    expect(validateInput(def("read_pages"), { pages: 2 })).toEqual([]);
  });
  it("runTool refuses unknown tools and invalid input", async () => {
    const app = fakeApp();
    await expect(runTool(app, "rm_rf", {})).rejects.toThrow(/no tool/);
    await expect(runTool(app, "highlight_text", { quote: 5 })).rejects.toThrow(/doesn't fit/);
  });
});

describe("text matching", () => {
  it("finds a quote across runs and returns tight boxes", () => {
    const [m] = findMatches(LINES, quoteRegex("250.00"));
    expect(m.text).toBe("250.00");
    expect(m.rects[0].x).toBeCloseTo(190, 0);
    expect(m.rects[0].w).toBeCloseTo(36, 0);
    expect(findMatches(LINES, quoteRegex("amount  DUE"))).toHaveLength(1);
  });
  it("matches emails and phone numbers", () => {
    expect(findMatches(LINES, toRegex({ regex: PII.email }))[0].text).toBe("ann@example.com");
    expect(findMatches(LINES, toRegex({ regex: PII.phone }))[0].text).toMatch(/^\+44 7700/);
  });
  it("explains a bad regex or empty input", () => {
    expect(() => toRegex({ regex: "(" })).toThrow(/isn't valid/);
    expect(() => toRegex({})).toThrow(/quote or a regex/);
  });
  it("reads page lists", () => {
    expect(parsePages("1-3, 5", 6)).toEqual([1, 2, 3, 5]);
    expect(parsePages(2, 3)).toEqual([2]);
    expect(parsePages("all", 3)).toEqual([1, 2, 3]);
    expect(parsePages("current", 5, 4)).toEqual([4]);
    expect(() => parsePages("9", 3)).toThrow(/Page 9 doesn't exist/);
    expect(() => parsePages("x", 3)).toThrow(/can't read/);
    expect(() => parsePages("3-1", 5)).toThrow(/backwards/);
  });
});

describe("tools through the store", () => {
  beforeEach(() => endRun());
  it("highlight_text puts a highlight on the right words as one undo step", async () => {
    const app = fakeApp();
    const r = await runTool(app, "highlight_text", { quote: "250.00" });
    expect(r.text).toMatch(/Marked 1 match/);
    const o = store.state.pages[0].objects[0];
    expect(o.type).toBe("highlight");
    expect(o.rects[0].x).toBeCloseTo(190, 0);
    store.undo();
    expect(store.state.pages[0].objects).toHaveLength(0);
  });
  it("redact_text by kind makes redact objects", async () => {
    const app = fakeApp();
    await runTool(app, "redact_text", { kinds: ["email", "phone"] });
    const reds = store.state.pages[0].objects.filter((o) => o.type === "redact");
    expect(reds).toHaveLength(2);
  });
  it("a run groups many tool calls into one undo step and the undo tool resets the run", async () => {
    const app = fakeApp();
    beginRun(app);
    store.begin();
    await runTool(app, "highlight_text", { quote: "250.00" });
    await runTool(app, "add_note", { page: 1, x: 10, y: 10, text: "check" });
    expect(store.state.pages[0].objects).toHaveLength(2);
    await runTool(app, "undo", {});
    expect(store.state.pages[0].objects).toHaveLength(0);
    await runTool(app, "add_note", { page: 1, x: 10, y: 10, text: "again" });
    store.end("AI: test");
    endRun();
    expect(store.undoLabel()).toBe("AI: test");
    store.undo();
    expect(store.state.pages[0].objects).toHaveLength(0);
  });
  it("tells the AI what to try when a quote is missing", async () => {
    const app = fakeApp();
    await expect(runTool(app, "highlight_text", { quote: "amount owed" })).rejects.toThrow(/No match.*similar words/);
  });
  it("keeps boxes inside the page", async () => {
    const app = fakeApp();
    const r = await runTool(app, "draw_box", { page: 1, x: 500, y: 800, w: 300, h: 300 });
    expect(r.text).toMatch(/inside the page/);
    const o = store.state.pages[0].objects[0];
    expect(o.x + o.w).toBeLessThanOrEqual(595);
    expect(o.y + o.h).toBeLessThanOrEqual(842);
  });
  it("pages tool refuses to delete every page and rotates", async () => {
    const app = fakeApp();
    await expect(runTool(app, "pages", { action: "delete", pages: "all" })).rejects.toThrow(/every page/);
    await runTool(app, "pages", { action: "rotate", pages: 1, degrees: 90 });
    expect(store.state.pages[0].rotate).toBe(90);
  });
  it("export_as explains when no exporters exist", async () => {
    await expect(runTool(fakeApp(), "export_as", { format: "docx" })).rejects.toThrow(/No export formats/);
  });
});

describe("paste mode", () => {
  const tk = { TOOLS };
  it("parses a fenced plan and counts steps", () => {
    const reply = 'Sure!\n```json\n{"plan":[{"tool":"highlight_text","input":{"quote":"x"}},{"tool":"add_note","input":{"page":1,"x":1,"y":2,"text":"hi"}}],"note":"Done."}\n```';
    const p = parsePlan(reply, tk);
    expect(p.steps).toHaveLength(2);
    expect(p.counts).toEqual({ highlight_text: 1, add_note: 1 });
    expect(p.note).toBe("Done.");
  });
  it("skips steps with unknown tools or bad input and says why", () => {
    const p = parsePlan('{"plan":[{"tool":"nope","input":{}},{"tool":"replace_text","input":{"page":1}},{"tool":"undo","input":{}}]}', tk);
    expect(p.steps.map((s) => s.tool)).toEqual(["undo"]);
    expect(p.problems).toHaveLength(2);
  });
  it("rejects replies with no plan", () => {
    expect(() => parsePlan("I think you should summarise", tk)).toThrow(/JSON/);
    expect(() => parsePlan('{"hello":1}', tk)).toThrow(/plan/);
  });
});

describe("answers and providers", () => {
  it("finds page citations", () => {
    const c = findCites("See (p. 3) and pp. 4-5, also page 12.");
    expect(c.map((x) => x.page)).toEqual([3, 4, 12]);
  });
  it("lists every provider, Claude first with three models", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["claude", "ollama", "lmstudio", "llamacpp", "openai", "gemini", "openrouter", "groq", "mistral", "deepseek", "bai", "custom"]);
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(effortsFor(providerById("claude")).map((e) => e.id)).toContain("max");
  });
});
