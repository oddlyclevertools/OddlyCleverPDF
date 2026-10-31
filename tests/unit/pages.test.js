import { describe, it, expect } from "vitest";
import { parseRanges, everyN, describePages, reorder, fillFormat, scopeIndexes, marginsToPage, shownToPage, pageToShown, placeItem, spotCenter, shiftObject, rangeIndexes } from "../../src/features/pages/logic.js";

describe("ranges", () => {
  it("reads 1-3, 5, 8-", () => {
    expect(parseRanges("1-3, 5, 8-", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
  });
  it("rejects nonsense and out of range", () => {
    expect(() => parseRanges("abc", 5)).toThrow();
    expect(() => parseRanges("9", 5)).toThrow(/only has 5/);
    expect(() => parseRanges("4-2", 5)).toThrow(/backwards/);
    expect(() => parseRanges("", 5)).toThrow();
  });
  it("de-duplicates", () => expect(rangeIndexes("1-2, 2-3", 5)).toEqual([0, 1, 2]));
  it("every N", () => expect(everyN(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]));
  it("describes", () => expect(describePages([0, 1, 2, 4])).toBe("1-3, 5"));
});

describe("reorder", () => {
  const L = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("moves to the start and end", () => {
    expect(reorder(L, ["c"], 0).map((x) => x.id).join("")).toBe("cabd");
    expect(reorder(L, ["a", "b"], 2).map((x) => x.id).join("")).toBe("cdab");
    expect(reorder(L, ["b"], 99).map((x) => x.id).join("")).toBe("acdb");
  });
});

describe("text and scopes", () => {
  it("fills the format", () => expect(fillFormat("Page {n} of {total}", { n: 2, total: 9 })).toBe("Page 2 of 9"));
  it("scopes", () => {
    expect(scopeIndexes("odd", "", 5)).toEqual([0, 2, 4]);
    expect(scopeIndexes("even", "", 5)).toEqual([1, 3]);
    expect(scopeIndexes("range", "2-3", 5)).toEqual([1, 2]);
    expect(scopeIndexes("current", "", 5, { current: 3 })).toEqual([3]);
  });
});

describe("rotation maths", () => {
  it("round trips", () => {
    for (const rotate of [0, 90, 180, 270]) {
      const p = { w: 200, h: 100, rotate };
      const s = pageToShown(p, 30, 10);
      const b = shownToPage(p, s.x, s.y);
      expect(b.x).toBeCloseTo(30); expect(b.y).toBeCloseTo(10);
    }
  });
  it("margins follow the rotation", () => {
    expect(marginsToPage({ l: 1, t: 2, r: 3, b: 4 }, 90)).toEqual({ l: 2, t: 3, r: 4, b: 1 });
    expect(marginsToPage({ l: 1, t: 2, r: 3, b: 4 }, 180)).toEqual({ l: 3, t: 4, r: 1, b: 2 });
  });
  it("places an upright item at the bottom of a rotated page", () => {
    const p = { w: 200, h: 100, rotate: 90 }; // shown 100 wide, 200 tall
    const area = { x: 0, y: 0, w: 200, h: 100 };
    const c = spotCenter("bottom-center", 100, 200, 40, 10, 20);
    const it = placeItem(p, area, c, 40, 10, 0);
    expect(it.angle).toBe(90);
    expect(it.ox).toBeGreaterThan(150); // the shown bottom is page-space x near the right
  });
});

describe("shiftObject", () => {
  it("moves every kind of coordinate", () => {
    const o = shiftObject({ x: 10, y: 10, strokes: [[[1, 1]]], rects: [{ x: 1, y: 2, w: 3, h: 4 }], cover: { x: 5, y: 5, w: 1, h: 1 } }, -2, -3);
    expect(o.x).toBe(8); expect(o.strokes[0][0]).toEqual([-1, -2]); expect(o.rects[0].y).toBe(-1); expect(o.cover.x).toBe(3);
  });
});
