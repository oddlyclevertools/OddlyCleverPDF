import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as store from "../../src/core/store.js";
import { wrapText, hexToRgb } from "../../src/core/export.js";
import { groupLines, blocksOf } from "../../src/core/text.js";

describe("store undo/redo", () => {
  it("records one step per change and restores it", () => {
    store.reset("t.pdf");
    store.state.pages = [{ id: "p1", src: { fileId: "f", index: 0 }, box: [0, 0, 100, 100], w: 100, h: 100, rotate: 0, objects: [] }];
    store.addObject("p1", { type: "rect", x: 1, y: 1, w: 5, h: 5 }, "Box");
    expect(store.state.pages[0].objects).toHaveLength(1);
    expect(store.undoLabel()).toBe("Box");
    store.undo();
    expect(store.state.pages[0].objects).toHaveLength(0);
    store.redo();
    expect(store.state.pages[0].objects).toHaveLength(1);
  });
  it("begin/end makes a single step for a drag and none when nothing changed", () => {
    store.clearHistory();
    const o = store.state.pages[0].objects[0];
    store.begin(); o.x = 10; o.x = 20; store.end("Move");
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.state.pages[0].objects[0].x).toBe(1);
    store.clearHistory();
    store.begin(); store.end("Nothing");
    expect(store.canUndo()).toBe(false);
  });
  it("swaps width and height for rotated pages", () => {
    expect(store.shownSize({ w: 100, h: 200, rotate: 90 })).toEqual({ w: 200, h: 100 });
    expect(store.shownSize({ w: 100, h: 200, rotate: -180 })).toEqual({ w: 100, h: 200 });
  });
});

describe("export helpers", () => {
  it("wraps text inside a width and keeps newlines", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("hello world this is a long line\nsecond", f, 12, 80);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.at(-1)).toBe("second");
    for (const l of lines) expect(f.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(80.5);
  });
  it("breaks a single long word", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", f, 12, 50);
    expect(lines.length).toBeGreaterThan(1);
  });
  it("reads hex colours", () => {
    const c = hexToRgb("#ff0000");
    expect([c.red, c.green, c.blue]).toEqual([1, 0, 0]);
    expect(hexToRgb("nope").red).toBe(0);
  });
});

describe("text lines", () => {
  const run = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.5, h: size, size, family: "sans" });
  it("groups runs on the same line and orders lines top to bottom", () => {
    const lines = groupLines([run("world", 60, 10), run("hello", 10, 10.5), run("next", 10, 30)]);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("hello world");
    expect(lines[1].text).toBe("next");
  });
  it("splits table cells into blocks", () => {
    const [line] = groupLines([run("Widget", 10, 10), run("2", 120, 10), run("100.00", 200, 10)]);
    expect(blocksOf(line).map((b) => b.text)).toEqual(["Widget", "2", "100.00"]);
  });
  it("treats pdf.js's wide gap-filling space run as a break between cells", () => {
    const run = (str, x, w) => ({ str, x, y: 0, w, h: 13, size: 13 });
    const [line] = groupLines([run("Total due", 360, 60), run(" ", 420, 65), run("£468.00", 484, 56)]);
    const blocks = blocksOf(line);
    expect(blocks.map((b) => b.text)).toEqual(["Total due", "£468.00"]);
    expect(blocks[1].x).toBe(484);
  });
});
