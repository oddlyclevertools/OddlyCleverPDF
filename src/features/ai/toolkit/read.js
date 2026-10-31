// Tools that only look: get_document, read_pages, search_text, look_at_page.
import { clip, nearLines, needDoc, pageAt, pagesFrom, shorten } from "./ctx.js";
import { findMatches, r1, toRegex } from "../textmatch.js";

/** Form fields of the open PDF as { name, type, page, options, default }, read from the widgets on each page. */
export async function listFields(app) {
  const out = [];
  const byName = new Map();
  for (const [i, p] of app.state.pages.entries()) {
    const f = app.state.files.get(p.src.fileId);
    if (!f?.pdf) continue;
    let anns = [];
    try { anns = await (await f.pdf.getPage(p.src.index + 1)).getAnnotations(); } catch { anns = []; }
    for (const w of anns) {
      if (w.subtype !== "Widget" || !w.fieldName || w.pushButton || w.fieldType === "Sig") continue;
      const type = w.fieldType === "Tx" ? "text" : w.fieldType === "Ch" ? (w.combo ? "combobox" : "listbox")
        : w.radioButton ? "radiobutton" : "checkbox";
      let field = byName.get(w.fieldName);
      if (!field) {
        field = { name: w.fieldName, type, page: i + 1, options: null, default: Array.isArray(w.fieldValue) ? w.fieldValue.join(", ") : (w.fieldValue === "Off" ? "" : w.fieldValue ?? "") };
        byName.set(w.fieldName, field);
        out.push(field);
      }
      if (type === "radiobutton" && w.buttonValue != null) field.options = [...(field.options || []), w.buttonValue];
      if (Array.isArray(w.options) && w.options.length) field.options = w.options.map((o) => o.exportValue ?? o.displayValue).filter((o) => o != null);
    }
  }
  return out;
}

async function getDocument(app) {
  needDoc(app);
  const st = app.state;
  const fields = await listFields(app);
  const sel = st.selection.map((id) => {
    const hit = app.store.findObject(id);
    return hit ? { id, type: hit.obj.type, page: st.pages.indexOf(hit.page) + 1 } : null;
  }).filter(Boolean).slice(0, 10);
  const lines = [`Name: ${st.name || "Untitled"}`, `Pages: ${st.pages.length}. Current page: ${(app.currentPageIndex?.() ?? 0) + 1}.`];
  st.pages.forEach((p, i) => {
    const sz = app.store.shownSize(p);
    lines.push(`p.${i + 1}: ${r1(sz.w)} x ${r1(sz.h)} pt${p.rotate ? `, rotated ${p.rotate}` : ""}, ${p.objects.length} edit${p.objects.length === 1 ? "" : "s"}`);
  });
  if (fields.length) {
    lines.push("Form fields (use these exact names with fill_form):");
    for (const f of fields.slice(0, 80)) {
      const v = st.form[f.name];
      lines.push(`- ${f.name} (${f.type}, p.${f.page}${f.options ? `, options: ${f.options.join(" | ")}` : ""})${v != null && v !== "" ? ` = ${JSON.stringify(v)}` : ""}`);
    }
  } else lines.push("Form fields: none.");
  lines.push(sel.length ? `Selected: ${sel.map((s) => `${s.type} on p.${s.page}`).join(", ")}` : "Nothing selected.");
  if (st.meta?.title) lines.push(`Title: ${st.meta.title}`);
  return { text: lines.join("\n") };
}

async function readPages(app, { pages, boxes = true }) {
  needDoc(app);
  const nums = pagesFrom(app, pages ?? "current");
  const parts = [];
  let size = 0;
  for (const n of nums) {
    const page = pageAt(app, n);
    const lines = await app.pageLines(page.id);
    const body = lines.length
      ? lines.map((l) => (boxes ? `[${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.w)},${Math.round(l.h)}] ` : "") + l.text).join("\n")
      : "(no selectable text on this page: it may be a scan or a picture. Use look_at_page.)";
    const block = `--- p.${n} (${r1(page.w)} x ${r1(page.h)} pt) ---\n${body}`;
    if (size + block.length > 14000 && parts.length) { parts.push(`(Stopped before p.${n} to keep this short. Ask for the next pages.)`); break; }
    parts.push(block);
    size += block.length;
  }
  return { text: clip(parts.join("\n")) };
}

async function searchText(app, { query, regex = false, pages }) {
  needDoc(app);
  const re = toRegex(regex ? { regex: query } : { quote: query });
  const nums = pagesFrom(app, pages ?? "all");
  const hits = [];
  for (const n of nums) {
    const lines = await app.pageLines(pageAt(app, n).id);
    for (const m of findMatches(lines, re, { max: 20 })) {
      const r = m.rects[0];
      hits.push(`p.${n} [${Math.round(r.x)},${Math.round(r.y)}] “${shorten(m.text, 60)}”`);
      if (hits.length >= 50) break;
    }
    if (hits.length >= 50) break;
  }
  if (!hits.length) {
    const lines = await app.pageLines(pageAt(app, nums[0]).id);
    return { text: `No match for “${shorten(query)}”.${nearLines(lines, query)}` };
  }
  return { text: `${hits.length}${hits.length >= 50 ? "+" : ""} match${hits.length === 1 ? "" : "es"}:\n${hits.join("\n")}` };
}

async function lookAtPage(app, { page }) {
  needDoc(app);
  const p = pageAt(app, page);
  const out = await app.outputPdf();
  const canvas = await app.pdf.pageToCanvas(out.pdf, app.state.pages.indexOf(p), { width: 1000 });
  const data = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  return { text: `A picture of p.${page}, with your edits so far (${canvas.width} x ${canvas.height} px). Page size ${r1(p.w)} x ${r1(p.h)} pt, so 1 px is ${r1(p.w / canvas.width)} pt.`, image: { mediaType: "image/jpeg", data } };
}

const pagesProp = { type: ["string", "integer"], description: 'Page numbers starting at 1: "2", "1-3, 5", "current" or "all".' };

export const READ_TOOLS = [
  {
    name: "get_document", description: "Overview of the open PDF: page count and sizes, the page the user is on, form fields (exact names), and what is selected. Call this first.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    label: () => "Looking at the document…", run: getDocument,
  },
  {
    name: "read_pages", description: "Read the text of pages. Each line starts with its box [x,y,width,height] in points from the top-left of the page. Long answers are cut, so ask for a few pages at a time.",
    input_schema: { type: "object", properties: { pages: pagesProp, boxes: { type: "boolean", description: "Show line boxes (default true)." } }, additionalProperties: false },
    label: (i) => `Reading page ${i.pages ?? "now"}…`, run: readPages,
  },
  {
    name: "search_text", description: "Find words on the pages. Ignores case and line breaks. Set regex true to use a regular expression.",
    input_schema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 200 }, regex: { type: "boolean" }, pages: pagesProp }, required: ["query"], additionalProperties: false },
    label: (i) => `Searching for “${shorten(i.query, 30)}”…`, run: searchText,
  },
  {
    name: "look_at_page", description: "Get a picture of one page as it looks now, with your edits. Use it to check your work, or to read scans, charts and layouts.",
    input_schema: { type: "object", properties: { page: { type: "integer", minimum: 1 } }, required: ["page"], additionalProperties: false },
    label: (i) => `Looking at page ${i.page}…`, run: lookAtPage,
  },
];
