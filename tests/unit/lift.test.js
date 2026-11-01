import { describe, it, expect } from "vitest";
import { PDFDocument, PDFDict, PDFName, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { findItems, pageOps, without, only, setContent, cutItem } from "../../src/core/lift.js";
import { state } from "../../src/core/store.js";
import { buildPdf } from "../../src/core/export.js";

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

/** A made-up page: white background, a picture, a two-part icon, a line and some words. */
async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(1, 1, 1) });
  page.drawImage(await doc.embedPng(PNG), { x: 20, y: 200, width: 40, height: 40 });
  page.drawRectangle({ x: 150, y: 150, width: 10, height: 10, color: rgb(0, 0.4, 0.8) });
  page.drawRectangle({ x: 160, y: 150, width: 6, height: 10, color: rgb(0.9, 0.2, 0.2) });
  page.drawLine({ start: { x: 20, y: 50 }, end: { x: 280, y: 50 }, thickness: 2, color: rgb(0, 0, 0) });
  page.drawText("Hello", { x: 20, y: 100, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}
const near = (box, want) => box.every((v, i) => Math.abs(v - want[i]) < 1.5);

describe("finding pictures and shapes", () => {
  it("lists the picture, the icon as one item and the line, but not the background or text", async () => {
    const doc = await PDFDocument.load(await fixture());
    const { items } = findItems(doc, 0);
    expect(items.map((i) => i.kind)).toEqual(["picture", "shape", "shape"]);
    expect(near(items[0].box, [20, 200, 60, 240])).toBe(true);
    expect(items[1].units).toHaveLength(2);
    expect(near(items[1].box, [150, 150, 166, 160])).toBe(true);
    expect(near(items[2].box, [19, 49, 281, 51])).toBe(true);
  });

  it("cuts an item out of the content and keeps everything else", async () => {
    const doc = await PDFDocument.load(await fixture());
    const { src, ops, items } = findItems(doc, 0);
    const cut = without(src, ops, items[0].units);
    expect(cut).not.toMatch(/\sDo\b/);
    expect(cut).toMatch(/\bBT\b[\s\S]*\bET\b/);
    setContent(doc, 0, cut);
    const again = findItems(doc, 0).items;
    expect(again.map((i) => i.kind)).toEqual(["shape", "shape"]);
    expect(pageOps(doc, 0).ops.length).toBe(ops.length - (items[0].units[0][1] - items[0].units[0][0] + 1));
  });

  it("keeps only the item, with its colours and transforms", async () => {
    const doc = await PDFDocument.load(await fixture());
    const { src, ops, items } = findItems(doc, 0);
    const { text, names } = only(src, ops, items[1].units);
    expect(text).not.toMatch(/\b(Do|BT|Tj)\b/);
    expect(text.match(/\bre\b/g) || text.match(/\bl\b/g)).toBeTruthy();
    expect(text).toMatch(/\brg\b/);
    expect(names.XObject.size).toBe(0);
    expect(only(src, ops, items[0].units).names.XObject.size).toBe(1);
  });
});

describe("saving a lifted picture", () => {
  it("draws it only at its new place, still as the original image", async () => {
    const bytes = await fixture();
    const doc = await PDFDocument.load(bytes);
    const parsed = findItems(doc, 0), { items } = parsed;
    cutItem(doc, 0, parsed, items[0]);
    const patched = await doc.save();
    state.files = new Map([["f0", { id: "f0", name: "t.pdf", bytes }], ["f1", { id: "f1", name: "t.pdf", bytes: patched }]]);
    state.images = new Map([["img1", "data:image/png;base64,"]]);
    state.pages = [{ id: "p1", src: { fileId: "f1", index: 0 }, box: [0, 0, 300, 300], w: 300, h: 300, rotate: 0, objects: [
      { id: "o1", type: "image", x: 200, y: 20, w: 40, h: 40, imageId: "img1", opacity: 1, lift: { fileId: "f0", index: 0, units: items[0].units, box: items[0].box } },
      { id: "o2", type: "rect", x: 0, y: 0, w: 5, h: 5, fill: "#000", hidden: true },
    ] }];
    const out = await PDFDocument.load((await buildPdf()).bytes);
    const found = findItems(out, 0).items;
    // no picture left at the old spot; one drawing (the Form holding the image) at the new one
    expect(found.some((i) => near(i.box, [20, 200, 60, 240]))).toBe(false);
    const moved = found.filter((i) => near(i.box, [200, 240, 240, 280]));
    expect(moved).toHaveLength(1);
    expect(found.some((i) => near(i.box, [0, 295, 5, 300]))).toBe(false); // hidden edits stay out
    // the form holds the original image, not a redrawn copy
    const xo = (d) => [...d.lookup(PDFName.of("Resources"), PDFDict).lookup(PDFName.of("XObject"), PDFDict).entries()].map(([, r]) => out.context.lookup(r));
    const [form] = xo(out.getPage(0).node);
    expect(form.dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("Form"));
    expect(xo(form.dict).map((x) => x.dict.get(PDFName.of("Subtype")))).toEqual([PDFName.of("Image")]);
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o.dict?.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(images).toHaveLength(2); // the picture and its see-through mask, no unused copy
  });
});
