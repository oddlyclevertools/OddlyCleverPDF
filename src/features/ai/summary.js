// The open PDF as text for the AI (paste mode puts this in the prompt; chat starts with a header).
import { listFields } from "./toolkit/read.js";
import { r1 } from "./textmatch.js";

/** A short header: name, pages, current page, form fields. No page text. */
export async function docHeader(app) {
  const st = app.state;
  const fields = await listFields(app).catch(() => []);
  return [
    `File: ${st.name || "Untitled"}. ${st.pages.length} page${st.pages.length === 1 ? "" : "s"}; the user is looking at page ${(app.currentPageIndex?.() ?? 0) + 1}.`,
    fields.length ? `Form fields: ${fields.map((f) => `${f.name} (${f.type}${f.options ? `: ${f.options.join("|")}` : ""})`).join(", ")}.` : "No form fields.",
  ].join("\n");
}

/** Header plus every page's lines with boxes, cut at maxChars. */
export async function docText(app, maxChars = 24000) {
  const parts = [await docHeader(app)];
  let size = parts[0].length;
  for (const [i, p] of app.state.pages.entries()) {
    const lines = await app.pageLines(p.id);
    const body = lines.length ? lines.map((l) => `[${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.w)},${Math.round(l.h)}] ${l.text}`).join("\n") : "(no selectable text)";
    const block = `--- p.${i + 1} (${r1(p.w)} x ${r1(p.h)} pt) ---\n${body}`;
    if (size + block.length > maxChars) { parts.push(`(Text cut here to keep the prompt short: pages ${i + 1}-${app.state.pages.length} are not shown.)`); break; }
    parts.push(block);
    size += block.length;
  }
  return parts.join("\n");
}
