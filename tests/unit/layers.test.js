import { describe, it, expect } from "vitest";
import { unionBox, snapTargets, snapBox, alignDeltas, distributeDeltas, restack, moveItem, layerName } from "../../src/features/layers/logic.js";

const B = (x, y, w, h) => ({ x, y, w, h });

describe("snapping", () => {
  const page = { w: 600, h: 800 };
  it("snaps a left edge to the page margin line and reports the guide", () => {
    const t = snapTargets(page, [], [72]);
    expect(snapBox(B(75, 300, 100, 20), t, 5)).toEqual({ dx: -3, dy: 0, gx: 72, gy: null });
  });
  it("snaps centres to the page centre", () => {
    const r = snapBox(B(248, 389, 100, 20), snapTargets(page), 5);
    expect(r.dx).toBe(2); expect(r.dy).toBe(1); expect(r.gx).toBe(300); expect(r.gy).toBe(400);
  });
  it("snaps to another box's edge, picking the closest", () => {
    const r = snapBox(B(203, 500, 50, 10), snapTargets(page, [B(100, 100, 101, 40)]), 5);
    expect(r.dx).toBe(-2); expect(r.gx).toBe(201);
  });
  it("leaves the box alone when nothing is close", () => {
    expect(snapBox(B(120, 130, 10, 10), snapTargets(page), 4)).toEqual({ dx: 0, dy: 0, gx: null, gy: null });
  });
});

describe("align and distribute", () => {
  const boxes = [B(10, 10, 20, 10), B(50, 40, 40, 20), B(30, 100, 10, 10)];
  it("unions boxes", () => expect(unionBox(boxes)).toEqual(B(10, 10, 80, 100)));
  it("aligns left and right to the shared box", () => {
    expect(alignDeltas(boxes, "left").map((d) => d.dx)).toEqual([0, -40, -20]);
    expect(alignDeltas(boxes, "right").map((d) => d.dx)).toEqual([60, 0, 50]);
  });
  it("aligns middles", () => expect(alignDeltas(boxes, "middle").map((d) => d.dy)).toEqual([45, 10, -45]));
  it("aligns one box to a frame (the page)", () => {
    expect(alignDeltas([B(10, 10, 100, 20)], "center", B(0, 0, 600, 800))).toEqual([{ dx: 240, dy: 0 }]);
  });
  it("rejects unknown alignments", () => expect(() => alignDeltas(boxes, "diagonal")).toThrow());
  it("spreads three boxes with equal gaps, ends fixed", () => {
    const d = distributeDeltas([B(0, 0, 10, 10), B(80, 0, 10, 10), B(20, 0, 10, 10)], "x");
    // span 0..90, sizes 30, gaps 30: positions 0, 40, 80
    expect(d.map((x) => x.dx)).toEqual([0, 0, 20]);
  });
  it("does nothing with fewer than three", () => {
    expect(distributeDeltas([B(0, 0, 1, 1), B(9, 9, 1, 1)], "y")).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
});

describe("stacking", () => {
  const L = ["a", "b", "c", "d"].map((id) => ({ id }));
  const ids = (a) => a.map((o) => o.id).join("");
  it("front and back keep relative order", () => {
    expect(ids(restack(L, ["a", "c"], "front"))).toBe("bdac");
    expect(ids(restack(L, ["b", "d"], "back"))).toBe("bdac");
  });
  it("forward and backward move one step", () => {
    expect(ids(restack(L, ["b"], "forward"))).toBe("acbd");
    expect(ids(restack(L, ["d"], "forward"))).toBe("abcd");
    expect(ids(restack(L, ["c"], "backward"))).toBe("acbd");
    expect(ids(restack(L, ["c", "d"], "forward"))).toBe("abcd");
    expect(ids(restack(L, ["a", "c"], "forward"))).toBe("badc");
  });
  it("does not change the input", () => { restack(L, ["a"], "front"); expect(ids(L)).toBe("abcd"); });
  it("moves an item to an index", () => {
    expect(ids(moveItem(L, 0, 3))).toBe("bcda");
    expect(ids(moveItem(L, 3, 0))).toBe("dabc");
    expect(ids(moveItem(L, 1, 9))).toBe("acdb");
  });
});

describe("layer names", () => {
  it("uses the words of text, shortened", () => {
    expect(layerName({ type: "text", text: "Backend Developer with 3 years of experience building things" })).toBe("Backend Developer with 3 years …");
    expect(layerName({ type: "text", text: "  " })).toBe("Empty text");
  });
  it("names other things plainly, and keeps a rename", () => {
    expect(layerName({ type: "image" })).toBe("Picture");
    expect(layerName({ type: "highlight", style: "strike" })).toBe("Strikethrough");
    expect(layerName({ type: "vector" })).toBe("Vector");
    expect(layerName({ type: "rect", name: "Header bar" })).toBe("Header bar");
  });
});
