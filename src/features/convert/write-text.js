// Blocks -> plain text, Markdown, HTML / XHTML and RTF.
import { esc, escAttr, xmlSafe, runsText, dataUri } from "./ir.js";

// ---- plain text ---------------------------------------------------------------------------
export function toTxt(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "p") out.push(runsText(b.runs));
    else if (b.type === "list") out.push(b.items.map((r, i) => `${b.ordered ? `${i + 1}.` : "-"} ${runsText(r)}`).join("\n"));
    else if (b.type === "table") out.push(b.rows.map((r) => r.map((c) => runsText(c)).join("\t")).join("\n"));
    else if (b.type === "code") out.push(b.text);
    else if (b.type === "hr") out.push("----");
  }
  return out.filter((s) => s !== "").join("\n\n").trim() + "\n";
}

// ---- Markdown -----------------------------------------------------------------------------
const mdEsc = (s) => s.replace(/([\\`*_{}[\]#|])/g, "\\$1");
function mdRuns(runs) {
  let out = "";
  for (const r of runs) {
    if (!r.t) continue;
    let t = r.code ? `\`${r.t}\`` : mdEsc(r.t);
    const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (m[2]) {
      let core = m[2];
      if (r.b && r.i) core = `***${core}***`; else if (r.b) core = `**${core}**`; else if (r.i) core = `*${core}*`;
      if (r.href) core = `[${core}](${r.href})`;
      t = m[1] + core + m[3];
    }
    out += t;
  }
  return out;
}
export function toMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push(`${"#".repeat(Math.min(6, b.level))} ${mdRuns(b.runs.map((r) => ({ ...r, b: false })))}`);
    else if (b.type === "p") out.push(mdRuns(b.runs));
    else if (b.type === "list") out.push(b.items.map((r, i) => `${b.ordered ? `${i + 1}.` : "-"} ${mdRuns(r)}`).join("\n"));
    else if (b.type === "table" && b.rows.length) {
      const cell = (c) => mdRuns(c).replace(/\|/g, "\\|").replace(/\n/g, " ") || " ";
      const w = Math.max(...b.rows.map((r) => r.length));
      const row = (r) => `| ${Array.from({ length: w }, (_, i) => cell(r[i] || [])).join(" | ")} |`;
      out.push([row(b.rows[0]), `|${" --- |".repeat(w)}`, ...b.rows.slice(1).map(row)].join("\n"));
    } else if (b.type === "code") out.push("```\n" + b.text + "\n```");
    else if (b.type === "pagebreak" || b.type === "hr") out.push("---");
  }
  return out.join("\n\n").replace(/(---\n\n)+---/g, "---").trim() + "\n";
}

// ---- HTML / XHTML -------------------------------------------------------------------------
function htmlRuns(runs, withSize, bodySize) {
  let out = "";
  for (const r of runs) {
    if (!r.t) continue;
    let t = esc(xmlSafe(r.t));
    if (r.code) t = `<code>${t}</code>`;
    if (r.b) t = `<strong>${t}</strong>`;
    if (r.i) t = `<em>${t}</em>`;
    if (r.href && /^(https?:|mailto:|#)/i.test(r.href)) t = `<a href="${escAttr(r.href)}">${t}</a>`;
    out += t;
  }
  return out;
}

/** opts: { images: "inline" | Map-callback(img)->src, title } */
export function toHtmlBody(blocks, { imageSrc = dataUri } = {}) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push(`<h${Math.min(6, b.level)}>${htmlRuns(b.runs)}</h${Math.min(6, b.level)}>`);
    else if (b.type === "p") out.push(`<p${b.align ? ` style="text-align:${b.align}"` : ""}>${htmlRuns(b.runs)}</p>`);
    else if (b.type === "list") out.push(`<${b.ordered ? "ol" : "ul"}>${b.items.map((r) => `<li>${htmlRuns(r)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`);
    else if (b.type === "table") {
      const rows = b.rows.map((r, i) => `<tr>${r.map((c) => `<${i === 0 && b.header ? "th" : "td"}>${htmlRuns(c)}</${i === 0 && b.header ? "th" : "td"}>`).join("")}</tr>`);
      out.push(`<table>${rows.join("")}</table>`);
    } else if (b.type === "image") out.push(`<p><img src="${imageSrc(b)}" alt="" style="max-width:100%;height:auto"/></p>`);
    else if (b.type === "code") out.push(`<pre>${esc(xmlSafe(b.text))}</pre>`);
    else if (b.type === "pagebreak" || b.type === "hr") out.push("<hr/>");
  }
  return out.join("\n");
}

const CSS = "body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#16121b}" +
  "table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #bbb;padding:.35rem .6rem;text-align:left}th{background:#f3eee6}img{max-width:100%}pre{background:#f6f2ea;padding:.8rem;overflow:auto}hr{border:0;border-top:1px dashed #bbb;margin:2rem 0}";

export function toHtml(blocks, { title = "Document" } = {}) {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(xmlSafe(title))}</title><style>${CSS}</style></head><body>\n${toHtmlBody(blocks)}\n</body></html>\n`;
}

// ---- RTF ----------------------------------------------------------------------------------
const rtfEsc = (s) => {
  let o = "";
  for (const ch of xmlSafe(s)) {
    const c = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") o += "\\" + ch;
    else if (ch === "\n") o += "\\line ";
    else if (ch === "\t") o += "\\tab ";
    else if (c > 126) { const v = c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c]; for (const u of v) o += `\\u${u > 32767 ? u - 65536 : u}?`; }
    else o += ch;
  }
  return o;
};
function rtfRuns(runs, base = 0) {
  return runs.map((r) => {
    const open = `${r.b ? "\\b" : ""}${r.i ? "\\i" : ""}${r.code ? "\\f1" : ""}${base ? `\\fs${base}` : ""}`;
    return open ? `{${open} ${rtfEsc(r.t)}}` : rtfEsc(r.t);
  }).join("");
}
export function toRtf(blocks) {
  const o = ["{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fmodern Courier New;}}\\fs22"];
  for (const b of blocks) {
    if (b.type === "heading") o.push(`\\pard\\sb200\\sa100${b.align === "center" ? "\\qc" : ""}{\\b\\fs${[0, 40, 32, 26][Math.min(3, b.level)] || 26} ${rtfEsc(runsText(b.runs))}}\\par`);
    else if (b.type === "p") o.push(`\\pard\\sa120${b.align === "center" ? "\\qc" : ""} ${rtfRuns(b.runs)}\\par`);
    else if (b.type === "list") b.items.forEach((r, i) => o.push(`\\pard\\fi-300\\li600\\sa60 ${b.ordered ? `${i + 1}.` : "\\u8226?"}\\tab ${rtfRuns(r)}\\par`));
    else if (b.type === "table") for (const row of b.rows) o.push(`\\pard\\sa40 ${row.map((c) => rtfEsc(runsText(c))).join("\\tab ")}\\par`);
    else if (b.type === "code") o.push(`\\pard{\\f1 ${rtfEsc(b.text).replace(/\\line /g, "\\line ")}}\\par`);
    else if (b.type === "pagebreak") o.push("\\page");
  }
  o.push("}");
  return o.join("\n");
}
