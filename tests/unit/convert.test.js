import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { explodeRuns, cellsOf, findTables, analyzeDocument, pageGrid } from "../../src/features/convert/analyze.js";
import { buildXlsx, buildCsv, asNumber, asMoney, colName } from "../../src/features/convert/write-xlsx.js";
import { xlsxToSheets, csvParse, rtfToBlocks, sheetsToBlocks } from "../../src/features/convert/readers.js";
import { markdownToHtml, inline } from "../../src/features/convert/md.js";
import { toTxt, toMarkdown, toHtml, toRtf } from "../../src/features/convert/write-text.js";
import { buildOdt, buildEpub } from "../../src/features/convert/write-zipdocs.js";
import { blocksToPdf } from "../../src/features/convert/layout-pdf.js";
import { parseRange } from "../../src/features/convert/pagedata.js";

// pdf.js-like runs for the sample: a heading, two lines, a 3-column table written as spaced text
const run = (str, x, y, size, extra = {}) => ({ str, x, y, w: str.length * size * 0.5, h: size, size, family: "sans", bold: false, italic: false, ...extra });
const line = (runs) => ({ runs, x: Math.min(...runs.map((r) => r.x)), y: runs[0].y, w: Math.max(...runs.map((r) => r.x + r.w)) - Math.min(...runs.map((r) => r.x)), h: runs[0].h, size: runs[0].size, text: runs.map((r) => r.str).join(" ") });
const samplePage = () => ({
  w: 595, h: 842,
  lines: [
    line([run("Invoice number 101", 60, 50, 24, { bold: true })]),
    line([run("Dear customer, thank you for your order.", 60, 100, 12)]),
    line([run("The total amount due is 250.00 GBP by 30 November 2026.", 60, 118, 12)]),
    line([run("Item        Qty     Price", 60, 160, 12, { w: 24 * 6 })]),
    line([run("Widget      2       100.00", 60, 178, 12, { w: 26 * 6 })]),
    line([run("Gadget      1       50.00", 60, 196, 12, { w: 25 * 6 })]),
  ],
});

describe("layout analysis", () => {
  it("splits spaced text into cells", () => {
    const cells = cellsOf(samplePage().lines[3]);
    expect(cells.map((c) => c.text)).toEqual(["Item", "Qty", "Price"]);
    expect(explodeRuns([run("a   b", 0, 0, 10)]).length).toBe(2);
  });
  it("finds a 3-column table and a heading", () => {
    const t = findTables(samplePage().lines);
    expect(t.length).toBe(1);
    expect(t[0].rows.length).toBe(3);
    expect(t[0].rows[0].length).toBe(3);
    const { blocks } = analyzeDocument([samplePage()]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks.some((b) => b.type === "table" && b.rows[1][2][0].t === "100.00")).toBe(true);
    expect(blocks.filter((b) => b.type === "p").length).toBe(2);
  });
  it("makes lists and joins wrapped lines", () => {
    const L = (t, x, y) => line([run(t, x, y, 12)]);
    const page = { w: 595, h: 842, lines: [L("First paragraph that keeps going across a", 60, 100), L("second line and ends here.", 60, 114), L("• apples", 60, 150), L("• pears", 60, 164)] };
    const { blocks } = analyzeDocument([page]);
    expect(blocks[0].type).toBe("p");
    expect(blocks[0].runs.map((r) => r.t).join("")).toContain("across a second line");
    expect(blocks[1]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[1].items.length).toBe(2);
  });
  it("gives a grid for spreadsheets", () => {
    const g = pageGrid(samplePage());
    expect(g.tables.length).toBe(1);
    expect(g.rows.find((r) => r[0] === "Widget")).toEqual(["Widget", "2", "100.00"]);
  });
});

describe("spreadsheets", () => {
  it("types numbers and keeps ids as text", () => {
    expect(asNumber("1,234.50")).toBe(1234.5);
    expect(asNumber("007")).toBeNull();
    expect(asNumber("12 apples")).toBeNull();
    expect(asMoney("£1,234.50")).toEqual({ n: 1234.5, sym: "£" });
    expect(asMoney("-$5")).toEqual({ n: -5, sym: "$" });
    expect(asMoney("£ apples")).toBeNull();
    expect(colName(27)).toBe("AB");
  });
  it("writes an xlsx that reads back", () => {
    const bytes = buildXlsx([{ name: "Page 1", rows: [[{ v: "Item", bold: true }, "Qty", "Price"], ["Widget", "2", "100.00"], ["Café €", 3, ""]] }]);
    const z = unzipSync(bytes);
    expect(Object.keys(z)).toEqual(expect.arrayContaining(["xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/sharedStrings.xml", "[Content_Types].xml"]));
    expect(strFromU8(z["xl/worksheets/sheet1.xml"])).toContain("<v>100</v>");
    const back = xlsxToSheets(bytes);
    expect(back[0].name).toBe("Page 1");
    expect(back[0].rows[0]).toEqual(["Item", "Qty", "Price"]);
    expect(back[0].rows[1]).toEqual(["Widget", "2", "100"]);
    expect(back[0].rows[2][0]).toBe("Café €");
  });
  it("writes and reads csv", () => {
    const csv = buildCsv([["a", 'b,"c"'], ["1", "2"]]);
    expect(csvParse(csv)).toEqual([["a", 'b,"c"'], ["1", "2"]]);
    expect(csvParse("x;y\n1;2")).toEqual([["x", "y"], ["1", "2"]]);
  });
  it("lays sheets out landscape when wide", () => {
    const wide = sheetsToBlocks([{ name: "S", rows: [Array.from({ length: 14 }, (_, i) => `column ${i}`), Array.from({ length: 14 }, (_, i) => `value ${i}`)] }]);
    expect(wide[0].w).toBeGreaterThan(wide[0].h);
  });
});

describe("text formats", () => {
  const { blocks } = analyzeDocument([samplePage()]);
  it("txt / md / html / rtf", () => {
    expect(toTxt(blocks)).toContain("Widget\t2\t100.00");
    const md = toMarkdown(blocks);
    expect(md).toContain("# Invoice number 101");
    expect(md).toContain("| Widget | 2 | 100.00 |");
    const html = toHtml(blocks, { title: "T" });
    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
    expect(toRtf(blocks)).toContain("Widget");
  });
  it("odt and epub are zips with the text", () => {
    const odt = unzipSync(buildOdt(blocks, { title: "T" }));
    expect(Object.keys(odt)[0]).toBe("mimetype");
    expect(strFromU8(odt["content.xml"])).toContain("table:table-cell");
    expect(strFromU8(odt["content.xml"])).toContain("Invoice number 101");
    const epub = unzipSync(buildEpub([blocks, blocks], { title: "T" }));
    expect(Object.keys(epub)[0]).toBe("mimetype");
    expect(strFromU8(epub["OEBPS/page2.xhtml"])).toContain("<table>");
    expect(strFromU8(epub["OEBPS/content.opf"])).toContain("<spine>");
  });
});

describe("markdown and rtf", () => {
  it("handles inline marks", () => {
    expect(inline("**b** and *i* and `c` and [l](http://x.y)")).toBe('<strong>b</strong> and <em>i</em> and <code>c</code> and <a href="http://x.y">l</a>');
    expect(inline("5 * 3 * 2")).not.toContain("<em>");
  });
  it("builds blocks", () => {
    const h = markdownToHtml("# Title\n\nSome *text*.\n\n- a\n- b\n  - nested\n\n1. one\n2. two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```");
    expect(h).toContain("<h1>Title</h1>");
    expect(h).toContain("<ul><li>a</li><li>b<ul><li>nested</li></ul></li></ul>");
    expect(h).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(h).toContain("<th>A</th>");
    expect(h).toContain("<pre>code</pre>");
  });
  it("reads basic rtf", () => {
    const b = rtfToBlocks("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard Hello {\\b bold} world\\par Caf\\'e9 \\u8364? end\\par}");
    expect(b[0].runs.map((r) => r.t).join("")).toBe("Hello bold world");
    expect(b[0].runs.some((r) => r.b && r.t === "bold")).toBe(true);
    expect(b[1].runs.map((r) => r.t).join("")).toBe("Café € end");
  });
  it("parses page ranges", () => {
    expect(parseRange("1-3, 5", 5)).toEqual([0, 1, 2, 4]);
    expect(parseRange("9", 5)).toBeNull();
    expect(parseRange("a", 5)).toBeNull();
  });
});

describe("PDF layout engine", () => {
  const loadFont = async (fam, b, i) => {
    const f = { sans: ["Inter_400Regular", "Inter_700Bold", "Inter_400Regular_Italic", "Inter_700Bold_Italic"], mono: ["RobotoMono_400Regular", "RobotoMono_700Bold"] }[fam];
    const name = fam === "mono" ? f[b ? 1 : 0] : f[b && i ? 3 : b ? 1 : i ? 2 : 0];
    return readFileSync(`public/fonts/${name}.ttf`);
  };
  it("makes a multi-page PDF with real text and survives unknown characters", async () => {
    const blocks = [
      { type: "heading", level: 1, runs: [{ t: "A title" }] },
      { type: "p", runs: [{ t: "Plain " }, { t: "bold", b: true }, { t: " and " }, { t: "italic", i: true }, { t: " text with 日本語 and emoji 😀." }] },
      { type: "list", ordered: false, items: [[{ t: "one" }], [{ t: "two" }]] },
      { type: "table", header: true, rows: [[[{ t: "A" }], [{ t: "B" }]], [[{ t: "1" }], [{ t: "2" }]]] },
      ...Array.from({ length: 80 }, (_, i) => ({ type: "p", runs: [{ t: `Line number ${i} of a long document that needs to wrap around the page width at least once to prove the wrapping works.` }] })),
    ];
    const { bytes, skipped, notes } = await blocksToPdf(blocks, { loadFont });
    expect(skipped).toBeGreaterThan(0);
    expect(notes.join(" ")).toContain("left out");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    expect(doc.numPages).toBeGreaterThan(1);
    const t = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
    expect(t).toContain("A title");
    expect(t).toContain("bold");
    expect(t).toContain("Line number 0");
  });
});
