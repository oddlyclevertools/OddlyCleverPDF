// Tools that mark up the page: highlight_text, redact_text, add_note, draw_box, draw_arrow.
import { color, fitBox, mutate, nearLines, pageAt, pagesFrom, shorten } from "./ctx.js";
import { PII, findMatches, r1, toRegex } from "../textmatch.js";

const pagesProp = { type: ["string", "integer"], description: 'Page numbers starting at 1: "2", "1-3, 5", "current" or "all".' };
const hexProp = { type: "string", description: "A colour like #ffe14d." };

/** Find a quote/regex on pages; returns the matches per page and a count. */
async function locate(app, input, defaultPages = "current") {
  const re = toRegex(input);
  const nums = pagesFrom(app, input.pages ?? defaultPages);
  const found = [];
  let count = 0;
  for (const n of nums) {
    const page = pageAt(app, n);
    const lines = await app.pageLines(page.id);
    const matches = findMatches(lines, re);
    if (matches.length) { found.push({ n, page, matches }); count += matches.length; }
  }
  return { found, count, nums };
}

async function missHelp(app, nums, input) {
  const lines = await app.pageLines(pageAt(app, nums[0]).id);
  const where = nums.length === 1 ? `page ${nums[0]}` : `pages ${nums.slice(0, 8).join(", ")}`;
  return `No match for “${shorten(input.quote || input.regex)}” on ${where}.${nearLines(lines, input.quote || input.regex)} Use read_pages to see the exact words.`;
}

async function highlightText(app, input) {
  const { found, count, nums } = await locate(app, input);
  if (!count) throw new Error(await missHelp(app, nums, input));
  const style = input.style || "highlight";
  const col = color(input.color, style === "highlight" ? "#ffe14d" : style === "strike" ? "#d81f3c" : "#1f4fd8");
  mutate(app, `${style === "highlight" ? "Highlight" : style === "underline" ? "Underline" : "Strike out"} text`, () => {
    for (const { page, matches } of found) {
      for (const m of matches) {
        page.objects.push({
          id: app.store.uid(), type: "highlight", color: col, style, opacity: style === "highlight" ? 0.45 : 1,
          rects: m.rects.map((r) => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) })),
        });
      }
    }
  }, found.map((f) => f.page.id));
  return { text: `Marked ${count} match${count === 1 ? "" : "es"} (${style}) on page${found.length === 1 ? "" : "s"} ${found.map((f) => f.n).join(", ")}.` };
}

async function redactText(app, input) {
  const sources = [];
  if (input.quote || input.regex) sources.push({ quote: input.quote, regex: input.regex, pages: input.pages });
  for (const k of input.kinds || []) sources.push({ regex: PII[k], pages: input.pages });
  if (!sources.length) throw new Error("Give a quote, a regex, or kinds such as email or phone.");
  const plan = [];
  let total = 0;
  for (const s of sources) {
    const { found, count } = await locate(app, s, "all");
    plan.push(...found);
    total += count;
  }
  if (!total) throw new Error(`Nothing to redact: no matches for ${[input.quote, input.regex, ...(input.kinds || [])].filter(Boolean).map((x) => `“${shorten(x, 30)}”`).join(", ")}.`);
  const done = [];
  mutate(app, "Redact text", () => {
    for (const { n, page, matches } of plan) {
      for (const m of matches) {
        for (const r of m.rects) page.objects.push({ id: app.store.uid(), type: "redact", x: r1(r.x - 1), y: r1(r.y - 1), w: r1(r.w + 2), h: r1(r.h + 2) });
      }
      done.push(`p.${n}: ${matches.length}`);
    }
  }, [...new Set(plan.map((f) => f.page.id))]);
  return { text: `Added ${total} redaction box${total === 1 ? "" : "es"} (${done.join(", ")}). They become permanent when the PDF is saved; the user can still undo before that.` };
}

function addNote(app, { page, x, y, text, color: c }) {
  const p = pageAt(app, page);
  const fx = Math.min(Math.max(x, 0), Math.max(0, p.w - 20)), fy = Math.min(Math.max(y, 0), Math.max(0, p.h - 20));
  mutate(app, "Add note", () => p.objects.push({ id: app.store.uid(), type: "note", x: r1(fx), y: r1(fy), text: text.slice(0, 1000), color: color(c, "#ffd60a") }), [p.id]);
  return { text: `Added a note on page ${page} at [${r1(fx)},${r1(fy)}].` };
}

function drawBox(app, { page, x, y, w, h, shape = "rect", stroke, fill, width = 2 }) {
  const p = pageAt(app, page);
  const b = fitBox(p, { x, y, w, h });
  mutate(app, "Draw box", () => p.objects.push({ id: app.store.uid(), type: shape, x: b.x, y: b.y, w: b.w, h: b.h, stroke: color(stroke, "#d81f3c"), fill: color(fill, "none"), width, opacity: 1 }), [p.id]);
  return { text: `Drew a ${shape === "ellipse" ? "circle" : "box"} on page ${page} at [${b.x},${b.y},${b.w},${b.h}]${b.moved ? " (moved to fit inside the page)" : ""}.` };
}

function drawArrow(app, { page, x1, y1, x2, y2, stroke, width = 2 }) {
  const p = pageAt(app, page);
  const cl = (v, max) => r1(Math.min(Math.max(v, 0), max));
  const o = { x1: cl(x1, p.w), y1: cl(y1, p.h), x2: cl(x2, p.w), y2: cl(y2, p.h) };
  mutate(app, "Draw arrow", () => p.objects.push({ id: app.store.uid(), type: "arrow", ...o, stroke: color(stroke, "#d81f3c"), width, opacity: 1 }), [p.id]);
  return { text: `Drew an arrow on page ${page} from [${o.x1},${o.y1}] to [${o.x2},${o.y2}].` };
}

const num = { type: "number", minimum: 0, maximum: 5000 };
const pageNo = { type: "integer", minimum: 1, description: "Page number, starting at 1." };

export const MARK_TOOLS = [
  {
    name: "highlight_text", description: "Highlight, underline or strike out words by quoting them exactly as read_pages shows them. Finds every match on the pages (default: the current page).",
    input_schema: { type: "object", properties: { quote: { type: "string", minLength: 1, maxLength: 300 }, regex: { type: "string", maxLength: 200 }, pages: pagesProp, style: { type: "string", enum: ["highlight", "underline", "strike"] }, color: hexProp }, additionalProperties: false },
    label: (i) => `${i.style === "underline" ? "Underlining" : i.style === "strike" ? "Striking out" : "Highlighting"} “${shorten(i.quote || i.regex, 30)}”…`, run: highlightText,
  },
  {
    name: "redact_text", description: "Black out sensitive words for good when the PDF is saved. Use a quote, a regex, or kinds (email, phone, iban, card, date, postcode) to hide whole kinds of personal details. Default: every page.",
    input_schema: { type: "object", properties: { quote: { type: "string", maxLength: 300 }, regex: { type: "string", maxLength: 200 }, kinds: { type: "array", items: { type: "string", enum: Object.keys(PII) }, maxItems: 6 }, pages: pagesProp }, additionalProperties: false },
    label: (i) => `Redacting ${i.kinds?.length ? i.kinds.join(" and ") : `“${shorten(i.quote || i.regex, 30)}”`}…`, run: redactText,
  },
  {
    name: "add_note", description: "Pin a sticky note on a page.",
    input_schema: { type: "object", properties: { page: pageNo, x: num, y: num, text: { type: "string", minLength: 1, maxLength: 1000 }, color: hexProp }, required: ["page", "x", "y", "text"], additionalProperties: false },
    label: (i) => `Adding a note “${shorten(i.text, 30)}”…`, run: addNote,
  },
  {
    name: "draw_box", description: "Draw a box or circle outline (optionally filled) on a page. Coordinates are points from the top-left; it is kept inside the page.",
    input_schema: { type: "object", properties: { page: pageNo, x: num, y: num, w: { type: "number", minimum: 2, maximum: 5000 }, h: { type: "number", minimum: 2, maximum: 5000 }, shape: { type: "string", enum: ["rect", "ellipse"] }, stroke: hexProp, fill: hexProp, width: { type: "number", minimum: 0.5, maximum: 20 } }, required: ["page", "x", "y", "w", "h"], additionalProperties: false },
    label: (i) => `Drawing a ${i.shape === "ellipse" ? "circle" : "box"} on page ${i.page}…`, run: drawBox,
  },
  {
    name: "draw_arrow", description: "Draw an arrow on a page, from (x1,y1) to (x2,y2), in points from the top-left.",
    input_schema: { type: "object", properties: { page: pageNo, x1: num, y1: num, x2: num, y2: num, stroke: hexProp, width: { type: "number", minimum: 0.5, maximum: 20 } }, required: ["page", "x1", "y1", "x2", "y2"], additionalProperties: false },
    label: (i) => `Drawing an arrow on page ${i.page}…`, run: drawArrow,
  },
];
