// ODT (OpenDocument text) and EPUB writers: zipped XML made with fflate.
import { zipSync, strToU8 } from "fflate";
import { esc, xmlSafe, runsText, extFromMime } from "./ir.js";

const X = (s) => esc(xmlSafe(s));
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

// ---- ODT ----------------------------------------------------------------------------------
function odtRuns(runs) {
  return runs.map((r) => {
    if (!r.t) return "";
    const style = r.code ? "Tcode" : r.b && r.i ? "Tbi" : r.b ? "Tb" : r.i ? "Ti" : "";
    const t = X(r.t).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`).replace(/\n/g, "<text:line-break/>").replace(/\t/g, "<text:tab/>");
    return style ? `<text:span text:style-name="${style}">${t}</text:span>` : t;
  }).join("");
}

export function buildOdt(blocks, { title = "Document" } = {}) {
  const pics = {};
  let n = 0, tn = 0;
  const body = [];
  for (const b of blocks) {
    if (b.type === "heading") body.push(`<text:h text:style-name="H${Math.min(3, b.level)}" text:outline-level="${Math.min(6, b.level)}">${odtRuns(b.runs.map((r) => ({ ...r, b: false })))}</text:h>`);
    else if (b.type === "p") body.push(`<text:p text:style-name="${b.align === "center" ? "Pc" : "P"}">${odtRuns(b.runs)}</text:p>`);
    else if (b.type === "list") body.push(`<text:list text:style-name="${b.ordered ? "Lnum" : "Lbul"}">${b.items.map((r) => `<text:list-item><text:p text:style-name="P">${odtRuns(r)}</text:p></text:list-item>`).join("")}</text:list>`);
    else if (b.type === "code") body.push(...b.text.split("\n").map((l) => `<text:p text:style-name="Code">${odtRuns([{ t: l }])}</text:p>`));
    else if (b.type === "table") {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const name = `Table${++tn}`;
      body.push(`<table:table table:name="${name}" table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>${b.rows.map((r, ri) => `<table:table-row>${Array.from({ length: cols }, (_, i) => `<table:table-cell table:style-name="Cell" office:value-type="string"><text:p text:style-name="P">${odtRuns((r[i] || []).map((x) => ri === 0 && b.header ? { ...x, b: true } : x))}</text:p></table:table-cell>`).join("")}</table:table-row>`).join("")}</table:table>`);
    } else if (b.type === "image") {
      const path = `Pictures/img${++n}.${extFromMime(b.mime)}`;
      pics[path] = b.data;
      const w = Math.min(b.w, 451), h = b.h * (w / b.w);
      body.push(`<text:p text:style-name="P"><draw:frame draw:name="Image${n}" text:anchor-type="as-char" svg:width="${(w / 72).toFixed(3)}in" svg:height="${(h / 72).toFixed(3)}in"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`);
    } else if (b.type === "pagebreak") body.push('<text:p text:style-name="Pbreak"/>');
  }
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  const auto = `<office:automatic-styles>
<style:style style:name="P" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.08in"/></style:style>
<style:style style:name="Pc" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.08in" fo:text-align="center"/></style:style>
<style:style style:name="Pbreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="Code" style:family="paragraph"><style:text-properties style:font-name="Courier New" fo:font-size="10pt"/></style:style>
<style:style style:name="H1" style:family="paragraph"><style:text-properties fo:font-size="22pt" fo:font-weight="bold"/></style:style>
<style:style style:name="H2" style:family="paragraph"><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style>
<style:style style:name="H3" style:family="paragraph"><style:text-properties fo:font-size="13pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Tb" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Ti" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Tbi" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>
<style:style style:name="Tcode" style:family="text"><style:text-properties style:font-name="Courier New"/></style:style>
<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="6.2in" table:align="left"/></style:style>
<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #888888"/></style:style>
<text:list-style style:name="Lbul"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.25in" text:min-label-width="0.25in"/></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="Lnum"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:space-before="0.25in" text:min-label-width="0.3in"/></text:list-level-style-number></text:list-style>
</office:automatic-styles>`;
  const content = `${HEAD}<office:document-content ${ns} office:version="1.2">${auto}<office:body><office:text>${body.join("")}</office:text></office:body></office:document-content>`;
  const manifest = `${HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${Object.keys(pics).map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="image/${p.split(".").pop() === "jpg" ? "jpeg" : p.split(".").pop()}"/>`).join("")}</manifest:manifest>`;
  const files = {
    mimetype: [strToU8("application/vnd.oasis.opendocument.text"), { level: 0 }],
    "content.xml": strToU8(content),
    "meta.xml": strToU8(`${HEAD}<office:document-meta ${ns} office:version="1.2"><office:meta><dc:title>${X(title)}</dc:title></office:meta></office:document-meta>`),
    "META-INF/manifest.xml": strToU8(manifest),
  };
  for (const [p, d] of Object.entries(pics)) files[p] = [d, { level: 0 }];
  return zipSync(files);
}

// ---- EPUB ---------------------------------------------------------------------------------
function xhtmlRuns(runs) {
  return runs.map((r) => {
    if (!r.t) return "";
    let t = X(r.t);
    if (r.code) t = `<code>${t}</code>`;
    if (r.b) t = `<strong>${t}</strong>`;
    if (r.i) t = `<em>${t}</em>`;
    return t;
  }).join("");
}

/** pages: array of block arrays (one chapter each). */
export function buildEpub(pages, { title = "Document", id = "oc-" + Math.random().toString(36).slice(2, 10) } = {}) {
  const imgs = {};
  let n = 0;
  const chapters = pages.map((blocks, pi) => {
    const out = [];
    for (const b of blocks) {
      if (b.type === "heading") out.push(`<h${Math.min(6, b.level)}>${xhtmlRuns(b.runs)}</h${Math.min(6, b.level)}>`);
      else if (b.type === "p") out.push(`<p>${xhtmlRuns(b.runs)}</p>`);
      else if (b.type === "list") out.push(`<${b.ordered ? "ol" : "ul"}>${b.items.map((r) => `<li>${xhtmlRuns(r)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`);
      else if (b.type === "table") out.push(`<table>${b.rows.map((r, i) => `<tr>${r.map((c) => `<${i === 0 && b.header ? "th" : "td"}>${xhtmlRuns(c)}</${i === 0 && b.header ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`);
      else if (b.type === "code") out.push(`<pre>${X(b.text)}</pre>`);
      else if (b.type === "image") { const path = `images/img${++n}.${extFromMime(b.mime)}`; imgs[path] = { data: b.data, mime: b.mime }; out.push(`<p><img src="${path}" alt=""/></p>`); }
    }
    const first = blocks.find((b) => b.type === "heading");
    return { file: `page${pi + 1}.xhtml`, title: first ? runsText(first.runs) : `Page ${pi + 1}`, xhtml: `${HEAD}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${X(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${out.join("\n") || "<p> </p>"}</body></html>` };
  });
  const css = "body{font-family:serif;line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.25em .5em}img{max-width:100%}pre{white-space:pre-wrap}";
  const nav = `${HEAD}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((c) => `<li><a href="${c.file}">${X(c.title)}</a></li>`).join("")}</ol></nav></body></html>`;
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`),
    ...Object.entries(imgs).map(([p, v], i) => `<item id="i${i + 1}" href="${p}" media-type="${v.mime}"/>`),
  ].join("");
  const opf = `${HEAD}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${X(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta></metadata><manifest>${manifest}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`;
  const files = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(nav),
    "OEBPS/style.css": strToU8(css),
  };
  chapters.forEach((c) => { files[`OEBPS/${c.file}`] = strToU8(c.xhtml); });
  for (const [p, v] of Object.entries(imgs)) files[`OEBPS/${p}`] = [v.data, { level: 0 }];
  return zipSync(files);
}
