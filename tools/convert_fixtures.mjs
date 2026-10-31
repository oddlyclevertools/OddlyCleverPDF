// Make the Convert test files in tests/fixtures/convert: docx (docx package), md, csv, xlsx (our writer),
// pptx (pptxgenjs), odt (our writer), ods, rtf, svg, html, txt, png.   node tools/convert_fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import { buildXlsx } from "../src/features/convert/write-xlsx.js";
import { buildOdt } from "../src/features/convert/write-zipdocs.js";

const dir = "tests/fixtures/convert";
mkdirSync(dir, { recursive: true });
const put = (n, d) => writeFileSync(`${dir}/${n}`, d);

// a small PNG made by hand (gradient)
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw[o + 1 + x * 3] = (x * 255) / w; raw[o + 2 + x * 3] = (y * 255) / h; raw[o + 3 + x * 3] = 160; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const pngBytes = png(120, 80);
put("sample.png", pngBytes);

// .docx with the docx package
const d = await import("docx");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, LevelFormat } = d;
const cell = (t, b) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: t, bold: b })] })] });
const doc = new Document({
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•" }] }] },
  sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Quarterly report")] }),
    new Paragraph({ children: [new TextRun("This is a "), new TextRun({ text: "bold", bold: true }), new TextRun(" and "), new TextRun({ text: "italic", italics: true }), new TextRun(" paragraph, with an accent: café.")] }),
    new Paragraph({ numbering: { reference: "b", level: 0 }, children: [new TextRun("First point")] }),
    new Paragraph({ numbering: { reference: "b", level: 0 }, children: [new TextRun("Second point")] }),
    new Table({ rows: [new TableRow({ children: [cell("Item", true), cell("Qty", true), cell("Price", true)] }), new TableRow({ children: [cell("Widget"), cell("2"), cell("100.00")] })] }),
    new Paragraph({ children: [new ImageRun({ type: "png", data: pngBytes, transformation: { width: 120, height: 80 } })] }),
    new Paragraph({ children: [new TextRun("The end.")] }),
  ] }],
});
put("sample.docx", await Packer.toBuffer(doc));

put("sample.md", "# Markdown title\n\nA paragraph with **bold**, *italic* and a [link](https://example.com).\n\n- apples\n- pears\n  - green\n\n1. first\n2. second\n\n| Item | Qty |\n| --- | --- |\n| Widget | 2 |\n\n```\nconst x = 1;\n```\n");
put("sample.csv", "Name,Qty,Price\nWidget,2,100.00\nGadget,1,50.00\n\"Thing, big\",3,9.5\n");
put("sample.txt", "Plain text file.\nSecond line with   spaces.\n");
put("sample.html", "<html><body><h1>HTML title</h1><p>Hello <b>bold</b> <i>italic</i> world.</p><ul><li>one</li><li>two</li></ul><table border=1><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><script>alert(1)</script></body></html>");
put("sample.rtf", "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard Rich {\\b text} file\\par Second paragraph\\par}");
put("sample.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ff2e7e"/><circle cx="100" cy="50" r="30" fill="#ffc83d"/></svg>');
put("sample.xlsx", buildXlsx([{ name: "Sales", rows: [[{ v: "Item", bold: true }, { v: "Qty", bold: true }, { v: "Price", bold: true }], ["Widget", 2, 100], ["Gadget", 1, 50.5]] }, { name: "Notes", rows: [["Hello"]] }]));
put("sample.odt", buildOdt([{ type: "heading", level: 1, runs: [{ t: "ODT title" }] }, { type: "p", runs: [{ t: "Plain " }, { t: "bold", b: true }, { t: " text." }] }, { type: "list", ordered: false, items: [[{ t: "one" }], [{ t: "two" }]] }, { type: "table", header: true, rows: [[[{ t: "A" }], [{ t: "B" }]], [[{ t: "1" }], [{ t: "2" }]]] }], { title: "t" }));

const odsXml = '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Score</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Ann</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>';
put("sample.ods", zipSync({ mimetype: [strToU8("application/vnd.oasis.opendocument.spreadsheet"), { level: 0 }], "content.xml": strToU8(odsXml) }));

const { default: PptxGenJS } = await import("pptxgenjs");
const p = new PptxGenJS();
const s1 = p.addSlide();
s1.addText("Big idea", { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 36, bold: true });
s1.addText([{ text: "First bullet", options: { bullet: true, breakLine: true } }, { text: "Second bullet", options: { bullet: true } }], { x: 0.5, y: 1.6, w: 9, h: 2, fontSize: 20 });
const s2 = p.addSlide();
s2.addText("Picture slide", { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 30 });
s2.addImage({ data: "image/png;base64," + pngBytes.toString("base64"), x: 1, y: 1.5, w: 3, h: 2 });
put("sample.pptx", Buffer.from(await p.write({ outputType: "nodebuffer" })));
console.log("convert fixtures written to", dir);
