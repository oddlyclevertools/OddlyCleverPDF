// Browser-side readers (DOMParser): PPTX slides, ODS sheets and ODT documents.
import { unzipSync, strFromU8 } from "fflate";
import { esc, escAttr, bytesToBase64 } from "./ir.js";

const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const kids = (n, name) => [...n.childNodes].filter((c) => c.nodeType === 1 && (name ? c.nodeName === name : true));
const all = (n, name) => [...n.getElementsByTagName(name)];
const MIMES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf" };
const mimeOf = (p) => MIMES[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
const unz = (b) => unzipSync(b instanceof Uint8Array ? b : new Uint8Array(b));
const read = (z, p) => (z[p] ? strFromU8(z[p]) : "");
const resolve = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
};
const relsOf = (z, part) => {
  const dir = part.split("/").slice(0, -1).join("/");
  const file = part.split("/").pop();
  const rels = read(z, `${dir}/_rels/${file}.rels`);
  const map = new Map();
  if (rels) for (const r of all(xml(rels), "Relationship")) map.set(r.getAttribute("Id"), resolve(part, r.getAttribute("Target")));
  return map;
};

// ---- PPTX ---------------------------------------------------------------------------------
/** @returns {Promise<{ blocks: any[], size: {w,h} }>} one pagebreak (with size) per slide */
export async function pptxToBlocks(bytes, { loadImage, notes = [] } = {}) {
  const z = unz(bytes);
  const pres = xml(read(z, "ppt/presentation.xml"));
  const sz = all(pres, "p:sldSz")[0];
  const size = { w: (Number(sz?.getAttribute("cx")) || 9144000) / 12700, h: (Number(sz?.getAttribute("cy")) || 5143500) / 12700 };
  const rels = relsOf(z, "ppt/presentation.xml");
  const slidePaths = all(pres, "p:sldId").map((s) => rels.get(s.getAttribute("r:id"))).filter(Boolean);
  const blocks = [];
  let n = 0;
  for (const path of slidePaths) {
    n++;
    const doc = xml(read(z, path));
    const srels = relsOf(z, path);
    blocks.push({ type: "pagebreak", w: size.w, h: size.h });
    const before = blocks.length;
    const tree = all(doc, "p:spTree")[0];
    const shapes = [];
    const collect = (node) => { for (const c of kids(node)) { if (c.nodeName === "p:grpSp") collect(c); else if (["p:sp", "p:pic", "p:graphicFrame"].includes(c.nodeName)) shapes.push(c); } };
    if (tree) collect(tree);
    for (const sh of shapes) {
      if (sh.nodeName === "p:sp") {
        const ph = all(sh, "p:ph")[0];
        const type = ph?.getAttribute("type") || "";
        const isTitle = type === "title" || type === "ctrTitle";
        for (const p of all(sh, "a:p")) {
          const runs = [];
          for (const c of kids(p)) {
            if (c.nodeName === "a:r") { const t = all(c, "a:t").map((x) => x.textContent).join(""); const rp = all(c, "a:rPr")[0]; if (t) runs.push({ t, b: rp?.getAttribute("b") === "1", i: rp?.getAttribute("i") === "1" }); }
            else if (c.nodeName === "a:br") runs.push({ t: "\n" });
            else if (c.nodeName === "a:fld") { const t = all(c, "a:t").map((x) => x.textContent).join(""); if (t) runs.push({ t }); }
          }
          if (!runs.length || !runs.map((r) => r.t).join("").trim()) continue;
          if (isTitle) blocks.push({ type: "heading", level: 1, runs });
          else if (type === "sldNum" || type === "dt" || type === "ftr") continue;
          else {
            const ppr = all(p, "a:pPr")[0];
            const bullet = ppr && (all(ppr, "a:buChar").length || all(ppr, "a:buAutoNum").length);
            const level = Number(ppr?.getAttribute("lvl") || 0);
            const isBody = type === "body" || type === "" && !!ph;
            if (bullet || isBody) blocks.push({ type: "list", ordered: !!(ppr && all(ppr, "a:buAutoNum").length), items: [runs], level });
            else blocks.push({ type: "p", runs });
          }
        }
      } else if (sh.nodeName === "p:pic") {
        const blip = all(sh, "a:blip")[0];
        const target = blip && srels.get(blip.getAttribute("r:embed"));
        if (!target || !z[target]) continue;
        const ext = all(sh, "a:ext").find((e) => e.getAttribute("cx"));
        let img = { data: z[target], mime: mimeOf(target) };
        const res = loadImage ? await loadImage(img.data, img.mime).catch(() => null) : { ...img, w: 0, h: 0 };
        if (!res) { notes.push("A picture on a slide was in a format I couldn't read."); continue; }
        const w = ext ? Number(ext.getAttribute("cx")) / 12700 : res.w * 0.75, h = ext ? Number(ext.getAttribute("cy")) / 12700 : res.h * 0.75;
        blocks.push({ type: "image", data: res.data, mime: res.mime, w: w || 300, h: h || 200 });
      } else if (sh.nodeName === "p:graphicFrame") {
        const tbl = all(sh, "a:tbl")[0];
        if (!tbl) continue;
        const rows = all(tbl, "a:tr").map((tr) => kids(tr, "a:tc").map((tc) => [{ t: all(tc, "a:t").map((x) => x.textContent).join(" ") }]));
        if (rows.length) blocks.push({ type: "table", rows, header: true });
      }
    }
    if (blocks.length === before) blocks.push({ type: "p", runs: [{ t: " " }] });
  }
  return { blocks: mergeSlideLists(blocks), size, count: n };
}
function mergeSlideLists(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === "list" && last?.type === "list" && last.level === b.level && last.ordered === b.ordered) last.items.push(...b.items);
    else out.push(b);
  }
  return out;
}

// ---- ODS ----------------------------------------------------------------------------------
export function odsToSheets(bytes) {
  const z = unz(bytes);
  const doc = xml(read(z, "content.xml"));
  const sheets = [];
  for (const t of all(doc, "table:table")) {
    const rows = [];
    for (const tr of all(t, "table:table-row")) {
      const repeat = Math.min(Number(tr.getAttribute("table:number-rows-repeated") || 1), 50);
      const cells = [];
      for (const c of kids(tr)) {
        if (c.nodeName !== "table:table-cell" && c.nodeName !== "table:covered-table-cell") continue;
        let text = kids(c, "text:p").map((p) => p.textContent).join("\n");
        if (!text) { const v = c.getAttribute("office:value") ?? c.getAttribute("office:date-value") ?? c.getAttribute("office:string-value"); if (v != null) text = v; }
        const rep = Math.min(Number(c.getAttribute("table:number-columns-repeated") || 1), text ? 50 : 1);
        for (let i = 0; i < rep; i++) cells.push(text);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) for (let i = 0; i < repeat; i++) rows.push(cells);
    }
    sheets.push({ name: t.getAttribute("table:name") || `Sheet${sheets.length + 1}`, rows });
  }
  return sheets;
}

// ---- ODT -> HTML --------------------------------------------------------------------------
export function odtToHtml(bytes) {
  const z = unz(bytes);
  const doc = xml(read(z, "content.xml"));
  const style = new Map();
  const ordered = new Map();
  for (const s of all(doc, "style:style")) {
    const tp = all(s, "style:text-properties")[0], pp = all(s, "style:paragraph-properties")[0];
    style.set(s.getAttribute("style:name"), {
      b: tp?.getAttribute("fo:font-weight") === "bold", i: tp?.getAttribute("fo:font-style") === "italic",
      center: pp?.getAttribute("fo:text-align") === "center", brk: pp?.getAttribute("fo:break-before") === "page",
    });
  }
  for (const ls of all(doc, "text:list-style")) ordered.set(ls.getAttribute("style:name"), !!all(ls, "text:list-level-style-number").length);
  const span = (inner, st) => { let h = inner; if (st?.b) h = `<strong>${h}</strong>`; if (st?.i) h = `<em>${h}</em>`; return h; };
  const inl = (node) => [...node.childNodes].map((c) => {
    if (c.nodeType === 3) return esc(c.nodeValue);
    if (c.nodeType !== 1) return "";
    switch (c.nodeName) {
      case "text:span": return span(inl(c), style.get(c.getAttribute("text:style-name")));
      case "text:s": return " ".repeat(Number(c.getAttribute("text:c") || 1));
      case "text:tab": return "\t";
      case "text:line-break": return "<br/>";
      case "text:a": return `<a href="${escAttr(c.getAttribute("xlink:href") || "")}">${inl(c)}</a>`;
      case "draw:frame": {
        const img = all(c, "draw:image")[0];
        const href = img?.getAttribute("xlink:href");
        const data = href && z[href];
        if (!data) return "";
        const w = parseFloat(c.getAttribute("svg:width") || "0") * (/cm/.test(c.getAttribute("svg:width") || "") ? 28.35 : /mm/.test(c.getAttribute("svg:width") || "") ? 2.835 : 72);
        const h = parseFloat(c.getAttribute("svg:height") || "0") * (/cm/.test(c.getAttribute("svg:height") || "") ? 28.35 : /mm/.test(c.getAttribute("svg:height") || "") ? 2.835 : 72);
        return `<img src="data:${mimeOf(href)};base64,${bytesToBase64(data)}"${w ? ` width="${Math.round(w / 0.75)}"` : ""}${h ? ` height="${Math.round(h / 0.75)}"` : ""}/>`;
      }
      default: return c.nodeName.startsWith("text:") ? inl(c) : "";
    }
  }).join("");
  const block = (n) => {
    switch (n.nodeName) {
      case "text:h": return `<h${Math.min(6, Number(n.getAttribute("text:outline-level") || 1))}>${inl(n)}</h${Math.min(6, Number(n.getAttribute("text:outline-level") || 1))}>`;
      case "text:p": { const st = style.get(n.getAttribute("text:style-name")); return `${st?.brk ? '<div style="page-break-before:always"></div>' : ""}<p${st?.center ? ' style="text-align:center"' : ""}>${span(inl(n), st)}</p>`; }
      case "text:list": {
        const tag = ordered.get(n.getAttribute("text:style-name")) ? "ol" : "ul";
        return `<${tag}>${kids(n, "text:list-item").map((li) => `<li>${[...li.childNodes].filter((c) => c.nodeType === 1).map((c) => (c.nodeName === "text:p" ? inl(c) : block(c))).join("")}</li>`).join("")}</${tag}>`;
      }
      case "table:table": return `<table>${all(n, "table:table-row").map((tr) => `<tr>${kids(tr).filter((c) => c.nodeName.endsWith("table-cell")).map((c) => `<td>${[...c.childNodes].filter((x) => x.nodeType === 1).map((x) => (x.nodeName === "text:p" ? inl(x) + " " : "")).join("")}</td>`).join("")}</tr>`).join("")}</table>`;
      case "text:section": return kids(n).map(block).join("");
      default: return "";
    }
  };
  const body = all(doc, "office:text")[0];
  return body ? kids(body).map(block).join("\n") : "";
}
