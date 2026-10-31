import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString, PDFRef } from "@cantoo/pdf-lib";
import { severRefs, sweep } from "../../src/features/pages/steps.js";

describe("redaction leaves no old page behind", () => {
  it("bookmarks and widgets pointing at a swapped page don't keep it alive", async () => {
    const doc = await PDFDocument.create();
    const old = doc.addPage([200, 200]);
    old.drawText("SECRET-WORDS");
    const oldRef = old.ref;
    const outline = doc.context.obj({ Title: PDFString.of("x"), Dest: [oldRef, "XYZ", 0, 0, null] });
    const outlineRef = doc.context.register(outline);
    doc.catalog.set(PDFName.of("Outlines"), doc.context.obj({ First: outlineRef, Last: outlineRef }));
    const fresh = doc.insertPage(0, [200, 200]);
    doc.removePage(1);
    doc.context.assign(oldRef, old.node); // what keepRemovedPages does
    severRefs(doc, [oldRef]);
    sweep(doc);
    const bytes = await doc.save({ useObjectStreams: false });
    expect(fresh.ref).toBeInstanceOf(PDFRef);
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("SECRET");
    expect(doc.context.lookup(oldRef)).toBeUndefined();
  });
});
