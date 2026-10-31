// A small Markdown -> HTML converter: headings, bold, italic, lists, code, tables, links, pictures.
import { esc } from "./ir.js";

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|~>])/g;

export function inline(src) {
  const keep = [];
  const hold = (html) => `${keep.push(html) - 1}`;
  let s = String(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.replace(ESCAPABLE, (_, c) => hold(esc(c)));
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, a, u) => hold(`<img alt="${a}" src="${u.replace(/"/g, "")}"/>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, t, u) => hold(`<a href="${u.replace(/"/g, "")}">`) + t + hold("</a>"));
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => hold(`<a href="${u}">${u}</a>`));
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "<strong>$2</strong>");
  s = s.replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/ {2,}\n/g, "<br/>");
  return s.replace(/(\d+)/g, (_, n) => keep[Number(n)]);
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    const h = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr/>"); i++; continue; }
    if (l.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (LIST.test(l)) {
      const items = [];
      const firstOrdered = /\d/.test(l.match(LIST)[2]), firstIndent = l.match(LIST)[1].length;
      while (i < lines.length && (LIST.test(lines[i]) || (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = lines[i].match(LIST);
        if (m && m[1].length <= firstIndent && /\d/.test(m[2]) !== firstOrdered) break;
        if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += " " + lines[i].trim();
        i++;
        if (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) i++;
      }
      out.push(listHtml(items));
      continue;
    }
    const buf = [l];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s{0,3}(#{1,6}\s|```|~~~|>)/.test(lines[i]) && !LIST.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.map((x, k) => (k < buf.length - 1 && / {2,}$/.test(x) ? x + "\n" : x.trim())).join(" ").replace(/\n /g, "\n"))}</p>`);
  }
  return out.join("\n");
}

function listHtml(items) {
  let html = "";
  const stack = []; // open lists: { indent, tag }
  for (const it of items) {
    const tag = it.ordered ? "ol" : "ul";
    while (stack.length && it.indent < stack[stack.length - 1].indent) { html += `</li></${stack.pop().tag}>`; }
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) { html += `<${tag}>`; stack.push({ indent: it.indent, tag }); }
    else html += "</li>";
    html += `<li>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}
