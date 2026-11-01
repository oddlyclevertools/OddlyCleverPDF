import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import opentype from "opentype.js";
import { readPage, buildFont, pickFiller, parseToUnicode, inkRatio } from "../../src/core/type3.js";
import { pageText } from "../../src/core/pdf.js";

// A made-up PDF saved the way Figma saves text: an invisible Type3 font (empty glyphs, size 1,
// scaled by Tm) for search, and the letters drawn as plain vector shapes. "HIL" at 20 pt.
async function figmaLike() {
  const d = await PDFDocument.create();
  const page = d.addPage([200, 200]);
  const ctx = d.context;
  const proc = () => ctx.register(ctx.stream("0.6 0 0 0 0.6 0.7 d1"));
  const tu = ctx.register(ctx.stream("begincmap\n3 beginbfchar\n<00> <0048>\n<01> <0049>\n<02> <004C>\nendbfchar\nendcmap"));
  const font = ctx.register(ctx.obj({
    Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 0, 0], FontMatrix: [1, 0, 0, 1, 0, 0],
    CharProcs: { C0: proc(), C1: proc(), C2: proc() }, Encoding: { Type: "Encoding", Differences: [0, "C0", "C1", "C2"] },
    FirstChar: 0, LastChar: 2, Widths: [0.6, 0.3, 0.5], ToUnicode: tu, Resources: {},
  }));
  page.node.setFontDictionary(PDFName.of("F1"), font);
  const shapes = [
    "q 1 0 0 1 50 100 cm 0 g",
    "1 0 2 14 re 9 0 2 14 re 3 6 6 2 re f", // H: two stems and a bar
    "13.5 0 3 14 re f", // I
    "19 0 2.5 14 re 21.5 0 5.5 2.5 re f", // L
    "0 -3 40 1 re f Q", // an underline: too wide to be part of a letter
  ].join("\n");
  const text = "BT 20 0 0 20 50 100 Tm /F1 1 Tf [ (\\000) (\\001) (\\002) ] TJ ET";
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(`${shapes}\n${text}`)));
  return PDFDocument.load(await d.save());
}

const box = (cmds) => {
  const pts = cmds.flatMap((c) => c.slice(1));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map(Math.round);
};

describe("Figma Type3 text", () => {
  it("rebuilds each letter from the vector shapes drawn over the invisible text", async () => {
    const { styles, shows } = readPage(await figmaLike(), 0);
    expect(styles.size).toBe(1);
    const glyphs = [...styles.values()][0];
    expect([...glyphs.keys()].join("")).toBe("HIL");
    expect(glyphs.get("H").cmds.filter((c) => c[0] === "M")).toHaveLength(3);
    expect(Math.round(glyphs.get("H").adv)).toBe(600);
    expect(box(glyphs.get("I").cmds)).toEqual([75, 0, 225, 700]); // 1.5..4.5 of 20 pt, 14 pt tall
    expect(box(glyphs.get("L").cmds)).toEqual([50, 0, 450, 700]); // the underline wasn't taken
    expect(shows).toEqual([expect.objectContaining({ x0: 50, x1: 78, base: 100, size: 20 })]);
  });

  it("builds a working font from them", async () => {
    const glyphs = [...readPage(await figmaLike(), 0).styles.values()][0];
    const font = opentype.parse(await buildFont(glyphs, null));
    const i = font.charToGlyph("I");
    expect(i.advanceWidth).toBe(300);
    const bb = i.getBoundingBox();
    expect([bb.x1, bb.y1, bb.x2, bb.y2].map(Math.round)).toEqual([75, 0, 225, 700]);
    expect(font.charToGlyph(" ").index).toBeGreaterThan(0); // a space is added when the PDF had none
  });

  it("reads Type3 text at its real size with a usable box", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await figmaLike();
    const pdf = await pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false }).promise;
    const runs = await pageText(pdf, 0);
    expect(runs[0]).toMatchObject({ str: "HIL", type3: true });
    expect(runs[0].size).toBeCloseTo(20, 1);
    expect(runs[0].x).toBeCloseTo(50, 1);
    expect(Number.isFinite(runs[0].y)).toBe(true);
    expect(runs[0].y).toBeCloseTo(200 - 100 - 20 * 0.8, 1);
  });

  it("fills missing letters from the Inter weight with the same amount of ink", () => {
    const load = (f) => opentype.parse(readFileSync(new URL(`../../public/fonts/${f}.ttf`, import.meta.url)).buffer);
    const regular = load("Inter_400Regular"), bold = load("Inter_700Bold");
    const lettersOf = (font) => new Map([..."Hamburg"].map((ch) => {
      const cmds = font.charToGlyph(ch).path.commands.map((c) => (c.type === "Z" ? ["Z"] : c.type === "Q" ? ["Q", [c.x1, c.y1], [c.x, c.y]] : c.type === "C" ? ["C", [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]] : [c.type, [c.x, c.y]]));
      return [ch, { cmds, adv: 500 }];
    }));
    expect(pickFiller(lettersOf(bold), regular, bold)).toBe(bold);
    expect(pickFiller(lettersOf(regular), regular, bold)).toBe(regular);
    expect(inkRatio([["M", [0, 0]], ["L", [10, 0]], ["L", [10, 10]], ["L", [0, 10]], ["Z"]])).toBeCloseTo(1, 5);
  });

  it("reads ToUnicode ranges", () => {
    const m = parseToUnicode("beginbfrange\n<10> <12> <0041>\n<20> <21> [<0078> <0079>]\nendbfrange");
    expect([m.get(0x10), m.get(0x12), m.get(0x20), m.get(0x21)]).toEqual(["A", "C", "x", "y"]);
  });
});
