import { describe, it, expect } from "vitest";
import { groupLines, blockNear, paragraphOf, caretIndexAt } from "../../src/core/text.js";

// a run of text: each letter is half the font size wide
const run = (str, x, y, size = 10, more = {}) => ({ str, x, y, w: str.length * size * 0.5, h: size, size, family: "sans", bold: false, italic: false, type3: false, ...more });

describe("blockNear", () => {
  const lines = groupLines([run("Hello world", 50, 100), run("Total", 300, 100), run("Next line", 50, 114)]);
  it("hits the words under a tap", () => {
    const p = blockNear(lines, { x: 60, y: 105 });
    expect(p.block.text).toBe("Hello world");
    expect(p.hit).toBe(true);
  });
  it("snaps a tap a little past a line's end to that line", () => {
    const p = blockNear(lines, { x: 50 + 55 + 25, y: 105 });
    expect(p.block.text).toBe("Hello world");
    expect(p.hit).toBe(false);
  });
  it("snaps a tap in a column gap to the nearer phrase", () => {
    expect(blockNear(lines, { x: 280, y: 104 }).block.text).toBe("Total");
    expect(blockNear(lines, { x: 120, y: 104 }).block.text).toBe("Hello world");
  });
  it("prefers the same row over the next line", () => {
    expect(blockNear(lines, { x: 70, y: 113 }).block.text).toBe("Next line");
    expect(blockNear(lines, { x: 70, y: 109 }).block.text).toBe("Hello world");
  });
  it("finds nothing when no text is near", () => {
    expect(blockNear(lines, { x: 200, y: 300 })).toBeNull();
    expect(blockNear(lines, { x: 500, y: 104 })).toBeNull();
  });
});

describe("paragraphOf", () => {
  const texts = (bs) => bs.map((b) => b.text);
  // a wrapped paragraph 50 letters wide, 14 pt line steps, then a short last line and a new paragraph
  const prose = [
    run("Lorem ipsum dolor sit amet consectetur adipiscing elit ut", 50, 100),
    run("sed do eiusmod tempor incididunt ut labore et dolore magna", 50, 114),
    run("aliqua ut enim ad minim.", 50, 128),
    run("Another paragraph starts here and keeps on going far", 50, 142),
  ];
  it("joins wrapped lines into one paragraph from any line", () => {
    const lines = groupLines(prose);
    const want = [prose[0].str, prose[1].str, prose[2].str];
    expect(texts(paragraphOf(lines, blockNear(lines, { x: 60, y: 105 }).block))).toEqual(want);
    expect(texts(paragraphOf(lines, blockNear(lines, { x: 60, y: 133 }).block))).toEqual(want);
  });
  it("stops at a line that ended early (a new paragraph)", () => {
    const lines = groupLines(prose);
    expect(texts(paragraphOf(lines, blockNear(lines, { x: 60, y: 147 }).block))).toEqual([prose[3].str]);
  });
  it("stops at a real line break (two list items with the same spacing)", () => {
    const lines = groupLines([{ ...prose[0], str: prose[0].str + "\n" }, prose[1]]);
    expect(paragraphOf(lines, blockNear(lines, { x: 60, y: 105 }).block)).toHaveLength(1);
  });
  it("keeps table rows and other styles apart", () => {
    const rows = groupLines([run("Widget", 50, 100), run("Gadget", 50, 114), run("Sprocket", 50, 128)]);
    expect(paragraphOf(rows, blockNear(rows, { x: 55, y: 105 }).block)).toHaveLength(1);
    const mixed = groupLines([prose[0], { ...prose[1], bold: true }]);
    expect(paragraphOf(mixed, blockNear(mixed, { x: 60, y: 105 }).block)).toHaveLength(1);
  });
  it("keeps side-by-side columns apart", () => {
    const cols = groupLines([
      run("Left column text that goes on and on wrapping", 50, 100), run("Right column words here and more", 400, 100),
      run("over to its second line with more words", 50, 114), run("right side second line", 400, 114),
    ]);
    expect(texts(paragraphOf(cols, blockNear(cols, { x: 60, y: 105 }).block))).toEqual(["Left column text that goes on and on wrapping", "over to its second line with more words"]);
  });
});

describe("caretIndexAt", () => {
  // two rows of three 10 px letters: "abc" on top, "def" below
  const rects = [0, 1, 2, 3, 4, 5].map((i) => ({ left: (i % 3) * 10, right: (i % 3) * 10 + 10, top: i < 3 ? 0 : 20, bottom: i < 3 ? 16 : 36 }));
  it("puts the caret at the nearest letter edge", () => {
    expect(caretIndexAt(rects, 2, 8)).toBe(0);
    expect(caretIndexAt(rects, 13, 8)).toBe(1);
    expect(caretIndexAt(rects, 18, 8)).toBe(2);
  });
  it("goes to the end of the row for a tap past it, on the nearest row", () => {
    expect(caretIndexAt(rects, 80, 8)).toBe(3);
    expect(caretIndexAt(rects, 80, 30)).toBe(6);
    expect(caretIndexAt(rects, 12, 19)).toBe(4);
  });
  it("handles an empty box", () => expect(caretIndexAt([], 5, 5)).toBe(0));
});
