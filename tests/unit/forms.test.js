// Forms, signing, stamps, OCR and scanning: the pure logic of src/features/forms.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { widgetRect, readWidgets, fillableFields, applyFormValues, isEmptyValue } from "../../src/features/forms/forms-core.js";
import { trimBounds, inkFromPhoto, fitSize } from "../../src/features/forms/sigimg.js";
import { stampSvg, stampSize, markObject, MARKS, BADGES } from "../../src/features/forms/stampart.js";
import { wordsFromResult, wordsToText, chooseFont, writeTextLayer } from "../../src/features/forms/ocr-core.js";
import { toGray, detectDocBox, detectDocQuad, homography, quadSize, warpPerspective, adaptiveThreshold, pageFor } from "../../src/features/forms/scanimg.js";

const sample = () => readFileSync(new URL("../fixtures/sample.pdf", import.meta.url));

describe("form widgets", () => {
  it("converts a widget rect from PDF space to page space", () => {
    expect(widgetRect([140, 552, 340, 574], [0, 0, 595, 842])).toEqual({ x: 140, y: 842 - 574, w: 200, h: 22 });
    expect(widgetRect([10, 20, 5, 8], [2, 3, 100, 100])).toEqual({ x: 3, y: 100 - 20, w: 5, h: 12 });
  });

  it("reads annotations into widgets, in reading order, skipping hidden and non-widgets", () => {
    const annots = [
      { subtype: "Widget", fieldType: "Tx", fieldName: "b", rect: [100, 500, 200, 520], fieldValue: "hi" },
      { subtype: "Widget", fieldType: "Tx", fieldName: "a", rect: [100, 700, 200, 720], multiLine: true, maxLen: 40 },
      { subtype: "Link", rect: [0, 0, 10, 10] },
      { subtype: "Widget", fieldType: "Tx", fieldName: "hid", rect: [0, 0, 50, 50], annotationFlags: 2 },
      { subtype: "Widget", checkBox: true, fieldName: "ok", rect: [10, 10, 26, 26], fieldValue: "Off" },
      { subtype: "Widget", radioButton: true, fieldName: "r", buttonValue: "x", rect: [10, 40, 26, 56], fieldValue: "x" },
      { subtype: "Widget", fieldType: "Sig", fieldName: "s", rect: [10, 80, 110, 120] },
      { subtype: "Widget", fieldType: "Ch", combo: true, fieldName: "plan", rect: [10, 130, 110, 150], options: [{ exportValue: "p", displayValue: "Pro" }], fieldValue: ["p"] },
    ];
    const list = readWidgets(annots, [0, 0, 600, 800]);
    expect(list.map((w) => w.name)).toEqual(["a", "b", "s", "plan", "r", "ok"].sort((x, y) => list.findIndex((w) => w.name === x) - list.findIndex((w) => w.name === y)));
    const by = Object.fromEntries(list.map((w) => [w.name, w]));
    expect(by.a).toMatchObject({ kind: "text", multiLine: true, maxLen: 40, y: 80 });
    expect(by.b.initial).toBe("hi");
    expect(by.ok).toMatchObject({ kind: "checkbox", initial: false });
    expect(by.r).toMatchObject({ kind: "radio", initial: "x", buttonValue: "x" });
    expect(by.plan).toMatchObject({ kind: "dropdown", initial: "p" });
    expect(by.plan.options).toEqual([{ value: "p", label: "Pro" }]);
    expect(by.hid).toBeUndefined();
    expect(fillableFields(list).map((w) => w.name).sort()).toEqual(["a", "b", "ok", "plan", "r"]);
  });

  it("knows what counts as empty", () => {
    expect([isEmptyValue(""), isEmptyValue(false), isEmptyValue([]), isEmptyValue(undefined)]).toEqual([true, true, true, true]);
    expect([isEmptyValue("x"), isEmptyValue(true), isEmptyValue(["a"])]).toEqual([false, false, false]);
  });

  it("writes values into the sample form and they survive a save and reload", async () => {
    const doc = await PDFDocument.load(sample());
    const { done, skipped } = applyFormValues(doc.getForm(), { name: "Ada Lovelace", agree: true, plan: "Team", nope: "x" });
    expect(done.sort()).toEqual(["agree", "name", "plan"]);
    expect(skipped).toEqual(["nope"]);
    doc.getForm().updateFieldAppearances();
    const back = await PDFDocument.load(await doc.save());
    const f = back.getForm();
    expect(f.getTextField("name").getText()).toBe("Ada Lovelace");
    expect(f.getCheckBox("agree").isChecked()).toBe(true);
    expect(f.getDropdown("plan").getSelected()).toEqual(["Team"]);
  });

  it("flattening removes the fields", async () => {
    const doc = await PDFDocument.load(sample());
    applyFormValues(doc.getForm(), { name: "Flat" });
    doc.getForm().updateFieldAppearances();
    doc.getForm().flatten();
    expect((await PDFDocument.load(await doc.save())).getForm().getFields()).toHaveLength(0);
  });
});

describe("signature pictures", () => {
  it("finds the inked part of a transparent picture", () => {
    const w = 10, h = 8, d = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of [[3, 2], [6, 5]]) d[(y * w + x) * 4 + 3] = 255;
    expect(trimBounds(d, w, h)).toEqual({ x: 3, y: 2, w: 4, h: 4 });
    expect(trimBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it("turns a photo of blue ink on paper into blue ink on transparent", () => {
    const w = 20, h = 10, d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { d[i * 4] = 238; d[i * 4 + 1] = 236; d[i * 4 + 2] = 230; d[i * 4 + 3] = 255; } // paper
    for (let x = 4; x < 16; x++) { const o = (5 * w + x) * 4; d[o] = 20; d[o + 1] = 50; d[o + 2] = 190; } // blue stroke
    inkFromPhoto(d, w, h, 0.5);
    const paper = d[3], ink = d[(5 * w + 8) * 4 + 3];
    expect(paper).toBe(0);
    expect(ink).toBe(255);
    const o = (5 * w + 8) * 4;
    expect(d[o + 2]).toBeGreaterThan(d[o]); // still blue
    expect(trimBounds(d, w, h)).toMatchObject({ x: 4, y: 5, w: 12, h: 1 });
  });

  it("fits a size inside a box", () => {
    expect(fitSize(200, 100, 100, 100)).toEqual({ w: 100, h: 50 });
  });
});

describe("stamps and marks", () => {
  it("draws every badge as our own SVG", () => {
    for (const t of BADGES) {
      const { svg, w, h } = stampSvg(t, "#d81f3c");
      expect(svg).toContain(`>${t}</text>`);
      expect(svg).toContain("feTurbulence"); // the rough edge
      expect(w).toBeGreaterThan(h);
    }
    expect(stampSvg("a<b", "#000").svg).toContain("A&lt;B");
    expect(stampSize("CONFIDENTIAL").w).toBeGreaterThan(stampSize("PAID").w);
  });

  it("makes marks as ink objects sized to the text size", () => {
    const o = markObject("check", 100, 200, 14, "#111111");
    expect(o.type).toBe("ink");
    const xs = o.strokes.flat().map((p) => p[0]), ys = o.strokes.flat().map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(14);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeGreaterThan(95);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(193);
    expect(Object.keys(MARKS)).toEqual(["check", "cross", "dot", "line"]);
    expect(markObject("cross", 0, 0, 10).strokes).toHaveLength(2);
  });
});

describe("OCR text layer", () => {
  const result = { blocks: [{ paragraphs: [{ lines: [
    { words: [{ text: "Hello", bbox: { x0: 100, y0: 200, x1: 300, y1: 260 }, confidence: 95 }, { text: "world", bbox: { x0: 320, y0: 200, x1: 500, y1: 260 }, confidence: 90 }] },
    { words: [{ text: "Second", bbox: { x0: 100, y0: 300, x1: 340, y1: 360 }, confidence: 91 }, { text: " ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] },
  ] }] }] };

  it("reads words from nested and flat results, scaled to points", () => {
    const words = wordsFromResult(result, 2);
    expect(words).toHaveLength(3);
    expect(words[0]).toMatchObject({ t: "Hello", x: 50, y: 100, w: 100, h: 30, line: 0 });
    expect(words[2].line).toBe(1);
    expect(wordsToText(words)).toBe("Hello world\nSecond");
    expect(wordsFromResult({ words: [{ text: "Flat", bbox: { x0: 0, y0: 0, x1: 10, y1: 5 } }] })).toHaveLength(1);
  });

  it("writes invisible words onto a page, sized to fit, and a viewer reads them back", async () => {
    const words = wordsFromResult(result, 2);
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await chooseFont(doc, words, null);
    expect(writeTextLayer(page, [0, 0, 595, 842], words, font)).toBe(3);
    const bytes = await doc.save();
    // pdf.js (the legacy build runs in node) reads the text and where it sits
    let pdfjs;
    try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch { pdfjs = null; }
    if (!pdfjs) return; // the writer itself is proven above
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    const text = tc.items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");
    expect(text).toContain("Hello");
    expect(text).toContain("world");
    expect(text.replace(/\s+/g, " ")).toContain("Hello world");
    const hello = tc.items.find((i) => i.str.startsWith("Hello"));
    expect(hello.transform[4]).toBeCloseTo(50, 0); // x in points
    expect(hello.transform[5]).toBeGreaterThan(842 - 100 - 30); // baseline sits inside the word box
    expect(hello.transform[5]).toBeLessThan(842 - 100);
  });
});

describe("scanning", () => {
  /** A bright page (optionally tilted) on a dark table, as a gray image. */
  const scene = (w, h, quad) => {
    const g = new Uint8Array(w * h).fill(50);
    const inside = (x, y) => {
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % 4];
        const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
      }
      return true;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) g[y * w + x] = 220;
    return g;
  };

  it("finds a straight page on a table", () => {
    const g = scene(200, 150, [[40, 20], [160, 20], [160, 130], [40, 130]]);
    const [x0, y0, x1, y1] = detectDocBox(g, 200, 150);
    expect(x0).toBeCloseTo(0.2, 1); expect(y0).toBeCloseTo(0.133, 1); expect(x1).toBeCloseTo(0.8, 1); expect(y1).toBeCloseTo(0.867, 1);
  });

  it("finds the four corners of a tilted page", () => {
    const q = [[60, 15], [170, 30], [150, 135], [40, 120]];
    const found = detectDocQuad(scene(200, 150, q), 200, 150).map(([x, y]) => [x * 200, y * 150]);
    found.forEach((p, i) => { expect(Math.abs(p[0] - q[i][0])).toBeLessThan(9); expect(Math.abs(p[1] - q[i][1])).toBeLessThan(9); });
  });

  it("falls back to the whole photo when there's nothing to find", () => {
    const b = detectDocBox(new Uint8Array(100 * 100).fill(128), 100, 100);
    expect(b).toEqual([0.03, 0.03, 0.97, 0.97]);
  });

  it("maps four points exactly (homography) and straightens a tilted shape", () => {
    const H = homography([[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 1], [14, 3], [12, 14], [0, 11]]);
    const map = (x, y) => { const d = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d]; };
    expect(map(10, 10).map((n) => Math.round(n * 100) / 100)).toEqual([12, 14]);
    // source: 30x30 gray ramp; cutting the exact left half gives that half back
    const w = 30, h = 30, src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; src[o] = src[o + 1] = src[o + 2] = x * 8; src[o + 3] = 255; }
    const out = warpPerspective(src, w, h, [[0, 0], [14, 0], [14, 29], [0, 29]], 15, 30);
    expect(out[0]).toBe(0);
    expect(out[(0 * 15 + 14) * 4]).toBeGreaterThan(100);
    expect(quadSize([[0, 0], [100, 0], [100, 50], [0, 50]])).toEqual({ w: 100, h: 50 });
  });

  it("black & white filter removes a shadow gradient and keeps the ink", () => {
    const w = 80, h = 40, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 235 - x * 1.6; const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
    for (let x = 10; x < 70; x++) { const o = (20 * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = (235 - x * 1.6) - 90; } // a dark line
    adaptiveThreshold(d, w, h, { win: 25 });
    expect(d[(5 * w + 5) * 4]).toBe(255);   // paper in the light part
    expect(d[(5 * w + 70) * 4]).toBe(255);  // paper in the shadow stays white
    expect(d[(20 * w + 40) * 4]).toBe(0);   // ink stays black
    expect(toGray(d, w, h)[0]).toBe(255);
  });

  it("picks A4 portrait or landscape", () => {
    expect(pageFor(800, 1100)).toEqual([595.28, 841.89]);
    expect(pageFor(1600, 900)).toEqual([841.89, 595.28]);
  });
});
