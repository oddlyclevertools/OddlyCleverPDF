// Readers for file types that need no browser: CSV, XLSX, RTF. They give plain data / blocks.
import { unzipSync, strFromU8 } from "fflate";
import { mergeRuns } from "./ir.js";

const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ""; } }
  return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()];
});

// ---- CSV ----------------------------------------------------------------------------------
export function csvParse(text, delim) {
  text = String(text).replace(/^﻿/, "");
  if (!delim) {
    const head = text.split(/\r?\n/).slice(0, 5).join("\n");
    const count = (d) => (head.match(new RegExp(d === "\t" ? "\\t" : `\\${d}`, "g")) || []).length;
    delim = [",", ";", "\t", "|"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

// ---- XLSX ---------------------------------------------------------------------------------
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const attr = (s, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(s); return m ? unent(m[1]) : null; };
const textsOf = (xml) => [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unent(m[1])).join("");
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function dateStyles(z) {
  const xml = z["xl/styles.xml"] ? strFromU8(z["xl/styles.xml"]) : "";
  const custom = new Map([...xml.matchAll(/<numFmt\s([^>]*?)\/>/g)].map((m) => [Number(attr(m[1], "numFmtId")), attr(m[1], "formatCode") || ""]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const flags = [];
  if (xfs) for (const m of xfs[1].matchAll(/<xf\s([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attr(m[1], "numFmtId") || 0);
    const code = (custom.get(id) || "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    flags.push(BUILTIN_DATE.has(id) || (custom.has(id) && /[ymdhs]/i.test(code) && !/^general$/i.test(code)));
  }
  return flags;
}
const pad2 = (n) => String(n).padStart(2, "0");
export function serialToText(serial) {
  const ms = Math.round(serial * 86400000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return serial % 1 ? `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : date;
}
const niceNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? String(+n.toPrecision(12)) : v; };

/** @returns {{ name: string, rows: string[][] }[]} */
export function xlsxToSheets(bytes) {
  const z = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const get = (p) => (z[p] ? strFromU8(z[p]) : "");
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? textsOf(m[1]) : ""));
  const dates = dateStyles(z);
  const rels = new Map([...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s([^>]*?)\/?>/g)].map((m) => [attr(m[1], "Id"), attr(m[1], "Target")]));
  const out = [];
  for (const m of get("xl/workbook.xml").matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const name = attr(m[1], "name") || `Sheet${out.length + 1}`;
    let target = rels.get(attr(m[1], "r:id")) || `worksheets/sheet${out.length + 1}.xml`;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = get(target);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1], body = cm[2] || "";
        const ref = attr(a, "r");
        const col = ref ? colIndex(ref) : cells.length;
        const t = attr(a, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = "";
        if (t === "s" && v != null) text = shared[Number(v)] ?? "";
        else if (t === "inlineStr") text = textsOf(body);
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) {
          text = unent(v);
          if (t !== "str" && t !== "e" && dates[Number(attr(a, "s") || 0)] && Number.isFinite(Number(text))) text = serialToText(Number(text));
          else if (!t || t === "n") text = niceNumber(text);
        }
        while (cells.length < col) cells.push("");
        cells[col] = text;
      }
      if (cells.some((c) => c !== "")) rows.push(cells);
    }
    out.push({ name, rows });
  }
  return out;
}

// ---- tables as pages ------------------------------------------------------------------------
const textual = (v) => v !== "" && !/^[-+]?[\d.,]+%?$/.test(v);
export const MAX_ROWS = 20000;

/** Sheets -> blocks: a heading and a table per sheet, landscape when it is wide. */
export function sheetsToBlocks(sheets, { portrait = { w: 595.28, h: 841.89 } } = {}) {
  const blocks = [];
  sheets.forEach((s, si) => {
    const cols = Math.max(1, ...s.rows.map((r) => r.length));
    const widest = Array.from({ length: cols }, (_, c) => Math.min(40, Math.max(3, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? "").length))));
    const approx = widest.reduce((a, b) => a + b, 0) * 5.2 + cols * 8;
    const wide = approx > portrait.w - 112;
    blocks.push({ type: "pagebreak", ...(wide ? { w: portrait.h, h: portrait.w } : { w: portrait.w, h: portrait.h }) });
    if (sheets.length > 1 || s.name) blocks.push({ type: "heading", level: 2, runs: [{ t: s.name }] });
    const rows = s.rows.slice(0, MAX_ROWS).map((r) => Array.from({ length: cols }, (_, c) => [{ t: String(r[c] ?? "") }]));
    const header = s.rows.length > 1 && s.rows[0].filter((c) => c !== "").length > 1 && s.rows[0].every((c) => c === "" || textual(c));
    if (rows.length) blocks.push({ type: "table", rows, header });
    else blocks.push({ type: "p", runs: [{ t: "(This sheet is empty.)", i: true }] });
    void si;
  });
  return blocks;
}

// ---- RTF ----------------------------------------------------------------------------------
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote", "themedata", "colorschememapping", "latentstyles", "datastore", "generator", "listtable", "listoverridetable", "rsidtbl", "fldinst", "object", "bkmkstart", "bkmkend"]);

/** Basic RTF -> paragraph blocks (bold and italic kept, nothing else). */
export function rtfToBlocks(src) {
  const blocks = [];
  let runs = [];
  const stack = [];
  let st = { b: false, i: false, skip: false, uc: 1 };
  let buf = "";
  let skipChars = 0;
  const flushText = () => { if (buf) { if (!st.skip) runs.push({ t: buf, b: st.b, i: st.i }); buf = ""; } };
  const endPara = () => { flushText(); const m = mergeRuns(runs); runs = []; if (m.length) blocks.push({ type: "p", runs: m }); else if (blocks.length && blocks[blocks.length - 1].type !== "gap") blocks.push({ type: "gap" }); };
  const s = String(src);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") { flushText(); stack.push({ ...st }); }
    else if (c === "}") { flushText(); st = stack.pop() || st; }
    else if (c === "\\") {
      const n = s[i + 1];
      if (n === "'") { const hex = s.slice(i + 2, i + 4); if (skipChars > 0) skipChars--; else if (!st.skip) buf += String.fromCharCode(parseInt(hex, 16) || 63); i += 3; continue; }
      if (n === "\\" || n === "{" || n === "}") { if (skipChars > 0) skipChars--; else if (!st.skip) buf += n; i++; continue; }
      if (n === "~") { buf += " "; i++; continue; }
      if (n === "-" || n === "_") { if (n === "_") buf += "-"; i++; continue; }
      if (n === "*") { st.skip = true; i++; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      const w = m[1], arg = m[2] != null ? Number(m[2]) : null;
      if (RTF_SKIP.has(w)) st.skip = true;
      else if (w === "par" || w === "sect" || w === "page") endPara();
      else if (w === "line") buf += "\n";
      else if (w === "tab") buf += "\t";
      else if (w === "b") { flushText(); st.b = arg !== 0; }
      else if (w === "i") { flushText(); st.i = arg !== 0; }
      else if (w === "pard" || w === "plain") { flushText(); if (w === "plain") { st.b = false; st.i = false; } }
      else if (w === "uc") st.uc = arg ?? 1;
      else if (w === "u") { let cp = arg < 0 ? arg + 65536 : arg; if (!st.skip) buf += String.fromCharCode(cp); skipChars = st.uc; }
      else if (w === "emdash") buf += "—"; else if (w === "endash") buf += "–"; else if (w === "bullet") buf += "•";
      else if (w === "lquote") buf += "‘"; else if (w === "rquote") buf += "’"; else if (w === "ldblquote") buf += "“"; else if (w === "rdblquote") buf += "”";
    } else if (c === "\n" || c === "\r") continue;
    else if (skipChars > 0) skipChars--;
    else if (!st.skip) buf += c;
  }
  endPara();
  return blocks.filter((b, i, a) => b.type !== "gap");
}
