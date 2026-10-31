// Tools for the whole document: pages (rotate/delete/move/duplicate/insert blank), export_as, undo.
import { insertGeneratedPages } from "./edit.js";
import { mutate, needDoc, pagesFrom, run } from "./ctx.js";

const pagesProp = { type: ["string", "integer"], description: 'Page numbers starting at 1: "2", "1-3, 5".' };

/** Deep copy a page with fresh ids (for duplicate). */
function cloneWith(app, page) {
  const copy = JSON.parse(JSON.stringify(page));
  copy.id = app.store.uid("p");
  for (const o of copy.objects) o.id = app.store.uid();
  return copy;
}

async function pagesTool(app, { action, pages, degrees = 90, to, after }) {
  needDoc(app);
  const st = app.state;
  const total = st.pages.length;
  if (action === "insert_blank") {
    const at = after == null ? total : Math.min(Math.max(after, 0), total);
    const ref = st.pages[Math.max(0, at - 1)] || st.pages[0];
    const { w, h } = app.store.shownSize(ref);
    await insertGeneratedPages(app, { name: "Blank page.pdf", at, draw: ({ doc }) => { doc.addPage([w, h]); } });
    return { text: `Added a blank page after page ${at}. The document has ${st.pages.length} pages.` };
  }
  if (pages == null) throw new Error("Say which pages with the pages input, for example “2” or “1-3”.");
  const nums = pagesFrom(app, pages);
  const chosen = nums.map((n) => st.pages[n - 1]);
  if (action === "rotate") {
    if (![90, 180, 270].includes(degrees)) throw new Error("degrees must be 90, 180 or 270.");
    mutate(app, "Turn pages", () => { for (const p of chosen) p.rotate = (((p.rotate || 0) + degrees) % 360 + 360) % 360; });
    return { text: `Turned page${nums.length === 1 ? "" : "s"} ${nums.join(", ")} by ${degrees} degrees clockwise.` };
  }
  if (action === "delete") {
    if (chosen.length >= total) throw new Error("That would delete every page. Keep at least one.");
    mutate(app, "Delete pages", () => { st.pages = st.pages.filter((p) => !chosen.includes(p)); });
    return { text: `Deleted page${nums.length === 1 ? "" : "s"} ${nums.join(", ")}. ${st.pages.length} left; later pages moved up.` };
  }
  if (action === "duplicate") {
    mutate(app, "Duplicate pages", () => {
      const out = [];
      for (const p of st.pages) { out.push(p); if (chosen.includes(p)) out.push(cloneWith(app, p)); }
      st.pages = out;
    });
    return { text: `Duplicated page${nums.length === 1 ? "" : "s"} ${nums.join(", ")}. The document has ${st.pages.length} pages.` };
  }
  if (action === "move") {
    if (to == null) throw new Error("Say where to move them with to (the new page number of the first moved page).");
    mutate(app, "Move pages", () => {
      const rest = st.pages.filter((p) => !chosen.includes(p));
      const at = Math.min(Math.max(to - 1, 0), rest.length);
      rest.splice(at, 0, ...chosen);
      st.pages = rest;
    });
    return { text: `Moved page${nums.length === 1 ? "" : "s"} ${nums.join(", ")} so they start at page ${Math.min(Math.max(to, 1), total - chosen.length + 1)}.` };
  }
  throw new Error(`Unknown action “${action}”.`);
}

async function exportAs(app, { format }) {
  needDoc(app);
  const list = app.exporters?.() || [];
  if (!list.length) throw new Error("No export formats are installed yet. The user can still save the PDF with Save PDF.");
  if (!format || format === "list") return { text: `Formats: ${list.map((e) => `${e.id} (${e.label})`).join(", ")}.` };
  const ex = list.find((e) => e.id === format || e.label.toLowerCase() === String(format).toLowerCase());
  if (!ex) throw new Error(`There's no format “${format}”. Formats: ${list.map((e) => e.id).join(", ")}.`);
  const out = await ex.run(app, { progress() {}, signal: undefined });
  const files = Array.isArray(out) ? out : [out];
  for (const f of files) await app.deliver(f.blob, f.filename);
  return { text: `Exported as ${ex.label}: ${files.map((f) => f.filename).join(", ")} (the user's browser saves it).` };
}

/** Put the document back to how it was when this AI run began. */
function undoTool(app) {
  if (!run.active || !run.snapshot) {
    if (!app.store.canUndo()) throw new Error("There is nothing to undo.");
    app.store.undo();
    return { text: `Undid the last change (${app.store.redoLabel()}).` };
  }
  const v = JSON.parse(run.snapshot);
  const st = app.state;
  st.pages = v.pages; st.form = v.form; st.meta = v.meta; st.extras = v.extras || {};
  st.selection = st.selection.filter((id) => app.store.findObject(id));
  app.store.emit("change", { label: "AI: undo", pages: "all" });
  return { text: "Undid everything changed so far in this run. The document is as it was before I started." };
}

export const PAGE_TOOLS = [
  {
    name: "pages", description: "Rotate, delete, move or duplicate pages, or insert a blank page. Page numbers start at 1 and are the numbers before this call.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["rotate", "delete", "move", "duplicate", "insert_blank"] }, pages: pagesProp, degrees: { type: "integer", enum: [90, 180, 270] }, to: { type: "integer", minimum: 1, description: "move: the new page number of the first moved page." }, after: { type: "integer", minimum: 0, description: "insert_blank: insert after this page (0 = the start). Default: the end." } }, required: ["action"], additionalProperties: false },
    label: (i) => ({ rotate: "Turning pages…", delete: "Deleting pages…", move: "Moving pages…", duplicate: "Copying pages…", insert_blank: "Adding a blank page…" }[i.action] || "Changing pages…"), run: pagesTool,
  },
  {
    name: "export_as", description: "Convert and download the document in another format (for example Word or text). Call with format \"list\" to see what is available. Only do this when the user asks.",
    input_schema: { type: "object", properties: { format: { type: "string", maxLength: 40 } }, required: ["format"], additionalProperties: false },
    label: (i) => `Exporting as ${i.format}…`, run: exportAs,
  },
  {
    name: "undo", description: "Throw away everything you changed in this conversation turn and start again from how the document was.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    label: () => "Undoing my changes…", run: undoTool,
  },
];
