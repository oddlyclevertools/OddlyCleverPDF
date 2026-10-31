// Tools that change words: add_text, replace_text, fill_form, add_summary_page.
import { color, fitBox, mutate, nearLines, needDoc, pageAt, sampleColors, shorten } from "./ctx.js";
import { listFields } from "./read.js";
import { findMatches, quoteRegex, r1 } from "../textmatch.js";

const hexProp = { type: "string", description: "A colour like #111111." };
const pageNo = { type: "integer", minimum: 1, description: "Page number, starting at 1." };
const FONTS = ["sans", "serif", "mono", "hand", "script"];

/** A rough height for wrapped text, so a new text box starts about the right size. */
function guessHeight(text, size, w) {
  const perLine = Math.max(4, Math.floor(w / (size * 0.52)));
  const lines = String(text).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * size * 1.25 + size * 0.2;
}

function addText(app, { page, x, y, text, size = 12, color: c, font = "sans", bold = false, italic = false, width, align = "left" }) {
  const p = pageAt(app, page);
  const w = Math.min(width || Math.max(80, Math.min(p.w * 0.6, p.w - x - 12)), p.w);
  const h = guessHeight(text, size, w);
  const b = fitBox(p, { x, y, w, h }, { minW: 20, minH: size });
  mutate(app, "Add text", () => p.objects.push({
    id: app.store.uid(), type: "text", x: b.x, y: b.y, w: b.w, h: b.h, text, font, size, color: color(c, "#111111"),
    bold, italic, underline: false, align, lineHeight: 1.2,
  }), [p.id]);
  return { text: `Added text on page ${page} at [${b.x},${b.y}], box ${b.w} wide${b.moved ? " (moved to fit inside the page)" : ""}.` };
}

async function replaceText(app, { page, find, replace, all = true }) {
  const p = pageAt(app, page);
  const lines = await app.pageLines(p.id);
  const matches = findMatches(lines, quoteRegex(find), { max: all ? 30 : 1 });
  if (!matches.length) throw new Error(`I can't find “${shorten(find, 50)}” on page ${page}.${nearLines(lines, find)} Use read_pages to copy the exact words.`);
  const multi = matches.filter((m) => !m.singleLine);
  if (multi.length === matches.length) throw new Error(`“${shorten(find, 50)}” runs over more than one line. Replace each line's words separately.`);
  const todo = matches.filter((m) => m.singleLine);
  const prepared = [];
  for (const m of todo) {
    const r = m.rects[0];
    const { bg, ink } = await sampleColors(app, p, r);
    prepared.push({ r, run: m.first, bg, ink });
  }
  let wide = false;
  mutate(app, "Replace text", () => {
    for (const { r, run, bg, ink } of prepared) {
      const size = Math.round(run.size * 10) / 10;
      const old = p.objects.find((o) => o.type === "text" && o.cover && Math.abs(o.cover.x - (r.x - 1)) < 2 && Math.abs(o.cover.y - (r.y - 1)) < 2);
      if (old) { old.text = replace; continue; }
      const w = Math.min(Math.max(r.w + 2, replace.length * size * 0.56), p.w - r.x);
      if (replace.length * size * 0.56 > r.w * 1.25 + size) wide = true;
      p.objects.push({
        id: app.store.uid(), type: "text", x: r1(r.x), y: r1(r.y - size * 0.12), w: r1(w), h: r1(r.h + size * 0.2), text: replace,
        font: run.family, bold: run.bold, italic: run.italic, size, color: ink, align: "left", lineHeight: 1.2,
        cover: { x: r1(r.x - 1), y: r1(r.y - 1), w: r1(r.w + 2), h: r1(r.h + 2), color: bg }, edited: true,
      });
    }
  }, [p.id]);
  const skipped = matches.length - todo.length;
  return { text: `Replaced ${todo.length} “${shorten(find, 40)}” with “${shorten(replace, 40)}” on page ${page}${skipped ? ` (skipped ${skipped} that run over a line break)` : ""}.${wide ? " The new words are wider than the old ones; check the page with look_at_page." : ""}` };
}

/** What a form field accepts, checked against the fields the PDF really has. */
function coerce(field, value) {
  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value;
    const t = String(value).trim().toLowerCase();
    if (["true", "yes", "on", "1", "checked", "x"].includes(t)) return true;
    if (["false", "no", "off", "0", "unchecked", ""].includes(t)) return false;
    throw new Error(`“${field.name}” is a tick box: use true or false.`);
  }
  if (field.options && (field.type === "combobox" || field.type === "listbox" || field.type === "radiobutton")) {
    const hit = field.options.find((o) => String(o).toLowerCase() === String(value).trim().toLowerCase());
    if (hit == null) throw new Error(`“${field.name}” only accepts: ${field.options.join(", ")}.`);
    return hit;
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value).slice(0, 2000);
}

async function fillForm(app, { values }) {
  needDoc(app);
  const fields = await listFields(app);
  if (!fields.length) throw new Error("This PDF has no fillable form fields. Use add_text to type onto the page instead.");
  const set = {}, problems = [];
  for (const [name, value] of Object.entries(values)) {
    const field = fields.find((f) => f.name === name) || fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!field) { problems.push(`There's no field “${shorten(name, 30)}”. Fields: ${fields.slice(0, 20).map((f) => f.name).join(", ")}.`); continue; }
    try { set[field.name] = coerce(field, value); } catch (e) { problems.push(e.message); }
  }
  const names = Object.keys(set);
  if (!names.length) throw new Error(problems.join(" "));
  mutate(app, "Fill form", () => { for (const n of names) app.state.form[n] = set[n]; });
  return { text: `Filled ${names.map((n) => `${n} = ${JSON.stringify(set[n])}`).join(", ")}.${problems.length ? ` Not filled: ${problems.join(" ")}` : ""}` };
}

/**
 * Make a PDF in memory with the app's fonts (whole faces, no subsetting) and add its pages to the
 * document. `draw({ doc, fonts, lib, wrap })` fills it. Returns how many pages were added.
 */
export async function insertGeneratedPages(app, { name, at, draw }) {
  const { PDFDocument } = app.pdfLib;
  const [{ default: fontkit }, { fontBytes, fontFile }] = await Promise.all([import("@pdf-lib/fontkit"), import("../../../core/fonts.js")]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const face = async (bold) => doc.embedFont(await fontBytes(fontFile("sans", bold, false)), { subset: false });
  const fonts = { regular: await face(false), bold: await face(true) };
  await draw({ doc, fonts, lib: app.pdfLib, wrap: app.wrapText });
  const rec = await app.addPdfBytes(new Uint8Array(await doc.save()), name);
  if (!rec) throw new Error("I couldn't add the new page.");
  const newPages = await app.pagesOf(rec);
  mutate(app, "Add page", () => { app.state.pages.splice(at, 0, ...newPages); });
  return newPages.length;
}

async function addSummaryPage(app, { title, text, after }) {
  needDoc(app);
  const pages = app.state.pages;
  const at = after == null ? pages.length : Math.min(Math.max(after, 0), pages.length);
  const ref = pages[Math.max(0, Math.min(at, pages.length) - 1)] || pages[0];
  const { w, h } = app.store.shownSize(ref);
  const M = 56, bodySize = 12, lead = 17;
  const added = await insertGeneratedPages(app, {
    name: "Summary page.pdf", at,
    async draw({ doc, fonts, lib, wrap }) {
      const { rgb } = lib;
      let page = doc.addPage([w, h]);
      let y = h - M;
      const tLines = wrap(title, fonts.bold, 22, w - M * 2);
      for (const l of tLines) { y -= 26; page.drawText(l, { x: M, y, size: 22, font: fonts.bold, color: rgb(0.08, 0.08, 0.14) }); }
      y -= 14;
      for (const raw of String(text).split("\n")) {
        const bullet = /^\s*[-*•]\s+/.test(raw);
        const para = bullet ? raw.replace(/^\s*[-*•]\s+/, "") : raw;
        const indent = bullet ? 16 : 0;
        const ls = para.trim() ? wrap(para, fonts.regular, bodySize, w - M * 2 - indent) : [""];
        ls.forEach((l, i) => {
          if (y - lead < M) { page = doc.addPage([w, h]); y = h - M; }
          y -= lead;
          if (bullet && i === 0) page.drawText("•", { x: M, y, size: bodySize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
          if (l) page.drawText(l, { x: M + indent, y, size: bodySize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
        });
        y -= 5;
      }
    },
  });
  return { text: `Added a ${added}-page summary after page ${at} (it is now page${added === 1 ? "" : "s"} ${at + 1}${added > 1 ? `-${at + added}` : ""}).` };
}

export const EDIT_TOOLS = [
  {
    name: "add_text", description: "Type new text onto a page at x,y (points from the top-left, the box's top-left corner). It is kept inside the page.",
    input_schema: { type: "object", properties: { page: pageNo, x: { type: "number", minimum: 0, maximum: 5000 }, y: { type: "number", minimum: 0, maximum: 5000 }, text: { type: "string", minLength: 1, maxLength: 4000 }, size: { type: "number", minimum: 6, maximum: 96 }, color: hexProp, font: { type: "string", enum: FONTS }, bold: { type: "boolean" }, italic: { type: "boolean" }, width: { type: "number", minimum: 20, maximum: 5000 }, align: { type: "string", enum: ["left", "center", "right"] } }, required: ["page", "x", "y", "text"], additionalProperties: false },
    label: (i) => `Adding text “${shorten(i.text, 30)}”…`, run: addText,
  },
  {
    name: "replace_text", description: "Change words that are already in the PDF: finds the exact words on a page, covers them, and types the new words in the same font, size and colour. Quote the words exactly as read_pages shows them. Replaces every match on the page unless all is false.",
    input_schema: { type: "object", properties: { page: pageNo, find: { type: "string", minLength: 1, maxLength: 300 }, replace: { type: "string", maxLength: 600 }, all: { type: "boolean" } }, required: ["page", "find", "replace"], additionalProperties: false },
    label: (i) => `Changing “${shorten(i.find, 30)}” to “${shorten(i.replace, 30)}”…`, run: replaceText,
  },
  {
    name: "fill_form", description: "Fill in form fields. Use the exact field names from get_document. Tick boxes take true/false; drop-downs take one of their options.",
    input_schema: { type: "object", properties: { values: { type: "object", additionalProperties: { type: ["string", "boolean", "number", "array"] } } }, required: ["values"], additionalProperties: false },
    label: (i) => `Filling in ${Object.keys(i.values || {}).slice(0, 3).join(", ") || "the form"}…`, run: fillForm,
  },
  {
    name: "add_summary_page", description: "Insert a new page made of a title and text you wrote (a summary, a translation, notes). Plain text: blank lines separate paragraphs and lines starting with - become bullets. Long text flows onto more pages.",
    input_schema: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, text: { type: "string", minLength: 1, maxLength: 20000 }, after: { type: "integer", minimum: 0, description: "Put it after this page number. 0 = the very start. Default: the end." } }, required: ["title", "text"], additionalProperties: false },
    label: (i) => `Writing a page “${shorten(i.title, 30)}”…`, run: addSummaryPage,
  },
];
