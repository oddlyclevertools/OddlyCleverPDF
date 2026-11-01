import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, rgb } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readPage, buildFont, pickFiller, parseToUnicode, inkRatio, type3FontFor } from "../../src/core/type3.js";
import { cubicToQuads } from "../../src/core/ttf.js";
import { pageText } from "../../src/core/pdf.js";
import { groupLines, blocksOf } from "../../src/core/text.js";
import * as store from "../../src/core/store.js";

const LETTERS = ["H", "I", "L", "I", "L"]; // codes 3 and 4 are I and L again, in a second style
const WIDTHS = [0.6, 0.3, 0.5, 0.3, 0.5];

// A made-up PDF saved the way Figma saves text: an invisible Type3 font (empty glyphs, size 1,
// scaled by Tm) for search, and the letters drawn as plain vector shapes. "HIL" at 20 pt, or with
// `twoStyles` "HI" then "IL" in another style on the same line (like "Title | details").
async function figmaLike({ twoStyles = false } = {}) {
  const d = await PDFDocument.create();
  const page = d.addPage([200, 200]);
  const ctx = d.context;
  const proc = () => ctx.register(ctx.stream("0.6 0 0 0 0.6 0.7 d1"));
  const map = LETTERS.map((ch, i) => `<0${i}> <00${ch.charCodeAt(0).toString(16).toUpperCase()}>`).join("\n");
  const tu = ctx.register(ctx.stream(`begincmap\n${LETTERS.length} beginbfchar\n${map}\nendbfchar\nendcmap`));
  const font = ctx.register(ctx.obj({
    Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 0, 0], FontMatrix: [1, 0, 0, 1, 0, 0],
    CharProcs: Object.fromEntries(LETTERS.map((_, i) => [`C${i}`, proc()])),
    Encoding: { Type: "Encoding", Differences: [0, ...LETTERS.map((_, i) => `C${i}`)] },
    FirstChar: 0, LastChar: LETTERS.length - 1, Widths: WIDTHS, ToUnicode: tu, Resources: {},
  }));
  page.node.setFontDictionary(PDFName.of("F1"), font);
  const shapes = twoStyles
    ? ["q 1 0 0 1 50 100 cm 0 g", "1 0 2 14 re 9 0 2 14 re 3 6 6 2 re 13.5 0 3 14 re f", "31.5 0 3 14 re 37 0 2.5 14 re 39.5 0 5.5 2.5 re f Q"]
    : [
      "q 1 0 0 1 50 100 cm 0 g",
      "1 0 2 14 re 9 0 2 14 re 3 6 6 2 re f", // H: two stems and a bar
      "13.5 0 3 14 re f", // I
      "19 0 2.5 14 re 21.5 0 5.5 2.5 re f", // L
      "0 -3 40 1 re f Q", // an underline: too wide to be part of a letter
    ];
  const text = twoStyles
    ? "BT 20 0 0 20 50 100 Tm /F1 1 Tf [ (\\000) (\\001) ] TJ ET\nBT 20 0 0 20 80 100 Tm /F1 1 Tf [ (\\003) (\\004) ] TJ ET"
    : "BT 20 0 0 20 50 100 Tm /F1 1 Tf [ (\\000) (\\001) (\\002) ] TJ ET";
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(`${shapes.join("\n")}\n${text}`)));
  return PDFDocument.load(await d.save());
}

const box = (cmds) => {
  const pts = cmds.flatMap((c) => c.slice(1));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map(Math.round);
};
const interFile = (f) => readFileSync(new URL(`../../public/fonts/${f}.ttf`, import.meta.url));

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

  it("builds a TrueType font from them that fontkit reads and pdf-lib embeds", async () => {
    const glyphs = [...readPage(await figmaLike(), 0).styles.values()][0];
    const bytes = new Uint8Array(buildFont(glyphs, null));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("\0\x01\0\0"); // TrueType, not CFF
    const font = fontkit.create(bytes);
    const i = font.glyphForCodePoint(73);
    expect(i.advanceWidth).toBe(300);
    expect([i.bbox.minX, i.bbox.minY, i.bbox.maxX, i.bbox.maxY]).toEqual([75, 0, 225, 700]);
    expect(font.glyphForCodePoint(32).id).toBeGreaterThan(0); // a space is added when the PDF had none
    const d = await PDFDocument.create();
    d.registerFontkit(fontkit);
    const f = await d.embedFont(bytes, { subset: false });
    d.addPage([100, 100]).drawText("HI L", { x: 10, y: 50, size: 12, font: f, color: rgb(0, 0, 0) });
    expect((await d.save()).length).toBeGreaterThan(500);
  });

  it("turns curves into quadratics that stay on the curve", () => {
    const p0 = [0, 0], c1 = [0, 550], c2 = [450, 1000], p3 = [1000, 1000];
    const qs = cubicToQuads(p0, c1, c2, p3);
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.at(-1)[1]).toEqual(p3);
    const mid = qs[Math.floor(qs.length / 2) - 1][1], t = Math.floor(qs.length / 2) / qs.length;
    const exact = [0, 1].map((k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * p3[k]);
    expect(Math.hypot(mid[0] - exact[0], mid[1] - exact[1])).toBeLessThan(0.01);
  });

  it("reads Type3 text at its real size with a usable box", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: await (await figmaLike()).save(), isEvalSupported: false }).promise;
    const runs = await pageText(pdf, 0);
    expect(runs[0]).toMatchObject({ str: "HIL", type3: true });
    expect(runs[0].size).toBeCloseTo(20, 1);
    expect(runs[0].x).toBeCloseTo(50, 1);
    expect(runs[0].y).toBeCloseTo(200 - 100 - 20 * 0.8, 1);
  });

  it("edits only the part of a line in the style you tap", async () => {
    const bytes = await (await figmaLike({ twoStyles: true })).save();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    store.reset("t.pdf");
    store.state.files.set("f1", { id: "f1", name: "t.pdf", bytes, pdf });
    store.state.pages = [{ id: "p1", src: { fileId: "f1", index: 0 }, box: [0, 0, 200, 200], w: 200, h: 200, rotate: 0, objects: [] }];
    const block = blocksOf(groupLines(await pageText(pdf, 0))[0])[0];
    expect(block.text).toBe("HI IL"); // one box for the whole line...
    const was = globalThis.fetch; // Inter fills in letters; serve it from public/fonts
    globalThis.fetch = async (u) => ({ ok: true, arrayBuffer: async () => interFile(String(u).match(/fonts\/(.+)\.ttf/)[1]) });
    try {
      const left = await type3FontFor("p1", block, { x: 55, y: 90 });
      const right = await type3FontFor("p1", block, { x: 85, y: 90 });
      expect(left.runs.map((r) => r.str).join("")).toBe("HI"); // ...but a tap takes only its own style
      expect(right.runs.map((r) => r.str).join("")).toBe("IL");
      expect(left.key).not.toBe(right.key);
    } finally { globalThis.fetch = was; }
  });

  it("fills missing letters from the Inter weight with the same amount of ink", () => {
    const regular = fontkit.create(interFile("Inter_400Regular")), bold = fontkit.create(interFile("Inter_700Bold"));
    const lettersOf = (font) => new Map([..."Hamburg"].map((ch) => {
      const cmds = font.glyphForCodePoint(ch.codePointAt(0)).path.commands.map(({ command: c, args: a }) =>
        c === "closePath" ? ["Z"] : c === "quadraticCurveTo" ? ["Q", [a[0], a[1]], [a[2], a[3]]] : c === "bezierCurveTo" ? ["C", [a[0], a[1]], [a[2], a[3]], [a[4], a[5]]] : [c === "moveTo" ? "M" : "L", [a[0], a[1]]]);
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
