// HTML -> blocks (browser: uses DOMParser). No scripts run and nothing is loaded from the network.
import { mergeRuns } from "./ir.js";

const SKIP = new Set(["script", "style", "head", "noscript", "iframe", "object", "embed", "template", "link", "meta", "title", "svg", "canvas", "audio", "video", "select", "button", "input", "textarea"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "figure", "figcaption", "address", "fieldset", "form", "details", "summary", "center"]);
const HEADS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export function decodeDataUri(src) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src || "");
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  try {
    if (m[2]) { const bin = atob(m[3].replace(/\s/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return { mime, data: u }; }
    return { mime, data: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch { return null; }
}

/**
 * @param {string} html
 * @param {{ loadImage?: (data: Uint8Array, mime: string) => Promise<{data, mime, w, h}|null>, notes?: string[] }} opts
 */
export async function htmlToBlocks(html, opts = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [];
  const notes = opts.notes || [];
  let pending = [];
  const pendingImgs = [];

  const flush = () => {
    const runs = trim(mergeRuns(pending));
    pending = [];
    if (runs.length) blocks.push({ type: "p", runs });
  };
  const addImage = (el) => {
    const src = el.getAttribute("src") || "";
    const dec = decodeDataUri(src);
    if (!dec) { if (src) notes.push("A picture lives on the internet, so I left it out."); return; }
    const blk = { type: "image", data: dec.data, mime: dec.mime, w: Number(el.getAttribute("width")) * 0.75 || 0, h: Number(el.getAttribute("height")) * 0.75 || 0 };
    blocks.push(blk);
    pendingImgs.push(blk);
  };

  function inlineWalk(node, st, out) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.push({ t: st.pre ? n.nodeValue : n.nodeValue.replace(/[ \t\r\n\f]+/g, " "), b: st.b, i: st.i, code: st.code, href: st.href }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (SKIP.has(tag)) continue;
      if (tag === "br") { out.push({ t: "\n" }); continue; }
      if (tag === "img") continue; // handled by the block walker
      const s = { ...st };
      if (tag === "b" || tag === "strong" || tag in HEADS || tag === "th") s.b = true;
      if (tag === "i" || tag === "em" || tag === "cite" || tag === "dfn" || tag === "var") s.i = true;
      if (tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") s.code = true;
      if (tag === "a" && n.getAttribute("href")) s.href = n.getAttribute("href");
      const fw = n.style?.fontWeight; if (fw === "bold" || Number(fw) >= 600) s.b = true;
      if (n.style?.fontStyle === "italic") s.i = true;
      if (tag === "ul" || tag === "ol") continue;
      const blockish = BLOCK.has(tag) || tag === "li" || tag in HEADS || tag === "tr" || tag === "blockquote";
      if (blockish && out.length && !/\n$/.test(out[out.length - 1].t)) out.push({ t: "\n" });
      inlineWalk(n, s, out);
      if (blockish && out.length && !/\n$/.test(out[out.length - 1].t)) out.push({ t: "\n" });
    }
  }
  const runsOf = (node, st = {}) => { const out = []; inlineWalk(node, st, out); return trim(tidy(mergeRuns(out))); };

  function walk(node, ctx = {}) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { pending.push({ t: n.nodeValue.replace(/[ \t\r\n\f]+/g, " "), b: ctx.b, i: ctx.i }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (SKIP.has(tag)) continue;
      const style = n.getAttribute?.("style") || "";
      if (/page-break-before\s*:\s*always|break-before\s*:\s*page/i.test(style)) { flush(); blocks.push({ type: "pagebreak" }); }
      if (tag in HEADS) { flush(); const runs = runsOf(n); if (runs.length) blocks.push({ type: "heading", level: HEADS[tag], runs }); }
      else if (tag === "p") {
        flush();
        const hasImg = n.querySelector("img");
        if (hasImg) { walkMixed(n); } else { const runs = runsOf(n, ctx); if (runs.length) blocks.push({ type: "p", runs, align: n.style?.textAlign === "center" ? "center" : undefined }); }
      }
      else if (tag === "ul" || tag === "ol") { flush(); list(n, 0); }
      else if (tag === "table") { flush(); table(n); }
      else if (tag === "pre") { flush(); blocks.push({ type: "code", text: n.textContent.replace(/^\n/, "").replace(/\n$/, "") }); }
      else if (tag === "hr") { flush(); blocks.push({ type: "hr" }); }
      else if (tag === "img") { flush(); addImage(n); }
      else if (tag === "blockquote") { flush(); walk(n, { ...ctx, i: true }); flush(); }
      else if (tag === "br") pending.push({ t: "\n" });
      else if (BLOCK.has(tag) || tag === "body" || tag === "html" || tag === "li") { flush(); walk(n, ctx); flush(); }
      else { // inline element at block level
        if (n.querySelector?.("img, ul, ol, table, p, div, h1, h2, h3, pre")) { flush(); walk(n, ctx); flush(); }
        else { const part = []; inlineWalk({ childNodes: [n] }, { b: ctx.b, i: ctx.i }, part); pending.push(...part); }
      }
      if (/page-break-after\s*:\s*always|break-after\s*:\s*page/i.test(style)) { flush(); blocks.push({ type: "pagebreak" }); }
    }
  }
  // a paragraph holding both text and pictures
  function walkMixed(p) {
    const saved = pending; pending = [];
    for (const c of p.childNodes) {
      if (c.nodeType === 1 && c.localName === "img") { flush(); addImage(c); }
      else if (c.nodeType === 1 && c.querySelector?.("img")) { flush(); walkMixed(c); }
      else if (c.nodeType === 1) { const part = []; inlineWalk({ childNodes: [c] }, {}, part); pending.push(...part); }
      else if (c.nodeType === 3) pending.push({ t: c.nodeValue.replace(/[ \t\r\n\f]+/g, " ") });
    }
    flush();
    pending = saved;
  }
  function list(el, level) {
    const ordered = el.localName === "ol";
    let items = [];
    let start = Number(el.getAttribute("start")) || 1;
    const emit = () => { if (items.length) { blocks.push({ type: "list", ordered, items, level, start }); start += items.length; items = []; } };
    for (const li of el.children) {
      if (li.localName !== "li") continue;
      const runs = runsOf(li);
      if (runs.length) items.push(runs);
      const imgs = li.querySelectorAll(":scope > img, :scope > p > img");
      const nested = [...li.children].filter((c) => c.localName === "ul" || c.localName === "ol");
      if (nested.length || imgs.length) { emit(); nested.forEach((c) => list(c, level + 1)); imgs.forEach(addImage); }
    }
    emit();
  }
  function table(el) {
    const rows = [];
    let header = !!el.querySelector("thead");
    for (const tr of el.querySelectorAll("tr")) {
      if (tr.closest("table") !== el) continue;
      const cells = [...tr.children].filter((c) => c.localName === "td" || c.localName === "th");
      if (!cells.length) continue;
      if (!rows.length && cells.every((c) => c.localName === "th")) header = true;
      rows.push(cells.map((c) => runsOf(c)));
    }
    if (rows.length) blocks.push({ type: "table", rows, header });
  }

  walk(doc.body || doc.documentElement);
  flush();

  if (opts.loadImage) {
    for (const blk of pendingImgs) {
      const res = await opts.loadImage(blk.data, blk.mime).catch(() => null);
      if (res) { blk.data = res.data; blk.mime = res.mime; if (!blk.w || !blk.h) { blk.w = res.w * 0.75; blk.h = res.h * 0.75; } else if (res.w && res.h && !(blk.w && blk.h)) { blk.h = blk.w * (res.h / res.w); } }
      else { blk.dead = true; notes.push("A picture couldn't be read, so I left it out."); }
    }
  }
  for (const blk of pendingImgs) { if (!blk.w) blk.w = 200; if (!blk.h) blk.h = 150; }
  return blocks.filter((b) => !b.dead);
}

function tidy(runs) { // collapse double spaces made by tags, and spaces around line breaks
  const out = runs.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    out[i].t = out[i].t.replace(/ *\n */g, "\n").replace(/ {2,}/g, " ");
    if (i && /[ \n]$/.test(out[i - 1].t) && out[i].t.startsWith(" ")) out[i].t = out[i].t.slice(1);
  }
  return out.filter((r) => r.t !== "");
}
function trim(runs) {
  if (!runs.length) return runs;
  const t = tidy(runs);
  if (!t.length) return t;
  t[0].t = t[0].t.replace(/^[ \n]+/, "");
  t[t.length - 1].t = t[t.length - 1].t.replace(/[ \n]+$/, "");
  return t.filter((r) => r.t !== "");
}
