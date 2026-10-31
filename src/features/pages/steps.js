// The export steps this feature adds to every Save: crop (120), flatten (150), watermark / page
// numbers / header-footer (200), true redaction (500) and the password lock (900, id "security").
import { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream, PDFName, PDFNull, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { state } from "../../core/store.js";
import { hexToRgb } from "../../core/export.js";
import { openPdf, pdfjs } from "../../core/pdf.js";
import { get, cropOf } from "./cfg.js";
import { itemsFor, metrics } from "./items.js";
import { pageToShown } from "./logic.js";

/** Drop every object nothing points to any more (so replaced page content is really gone). */
export function sweep(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [];
  const visit = (o) => {
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) return;
      seen.add(o.tag);
      const t = ctx.lookup(o);
      if (t) stack.push(t);
    } else if (o) stack.push(o);
  };
  for (const k of ["Root", "Info", "Encrypt", "ID"]) visit(ctx.trailerInfo[k]);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFStream) stack.push(o.dict);
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) visit(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) visit(v);
  }
  let n = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); n++; }
  return n;
}

/**
 * Make nothing point at pages that were swapped for pictures. Bookmarks, links, named destinations,
 * form widgets (/P) and the tag tree would otherwise keep the old page, with its text, alive through
 * `sweep`. The tag tree also holds alt text, so it goes too.
 */
export function severRefs(doc, dead) {
  const ctx = doc.context;
  const tags = new Set(dead.map((r) => r.tag));
  const walk = (o) => {
    if (o instanceof PDFStream) o = o.dict;
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        if (v instanceof PDFRef) { if (tags.has(v.tag)) o.set(k, PDFNull); } else walk(v);
      }
    } else if (o instanceof PDFArray) {
      o.asArray().forEach((v, i) => { if (v instanceof PDFRef) { if (tags.has(v.tag)) o.set(i, PDFNull); } else walk(v); });
    }
  };
  for (const [, o] of ctx.enumerateIndirectObjects()) walk(o);
  ctx.lookup(ctx.trailerInfo.Root)?.delete?.(PDFName.of("StructTreeRoot"));
}

/** Lock a pdf-lib document with the "Protect" settings (does nothing when it is off). */
export function lockDoc(doc, notes) {
  const s = get("security");
  if (!s.on) return false;
  if (!s.user) { notes?.push("Password protection is on, but no password is set, so the file was saved without one."); return false; }
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  doc.encrypt({
    userPassword: s.user,
    ownerPassword: s.owner || rnd,
    permissions: {
      printing: s.print ? "highResolution" : false,
      copying: !!s.copy, modifying: !!s.edit, annotating: !!s.edit, fillingForms: !!s.edit, documentAssembly: !!s.edit, contentAccessibility: true,
    },
  });
  return true;
}

const dataUrlBytes = (url) => Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));

async function drawItems(ctx) {
  await metrics();
  const total = ctx.pages.length;
  const helv = new Map();
  const std = async (bold) => {
    if (!helv.has(bold)) helv.set(bold, await ctx.doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica));
    return helv.get(bold);
  };
  for (const [i, { page, pdfPage }] of ctx.pages.entries()) {
    for (const it of itemsFor(page, i, total)) {
      const x = page.box[0] + it.ox, y = page.box[3] - it.oy;
      if (it.kind === "image") {
        const url = state.images.get(it.imageId);
        if (!url) continue;
        const bytes = dataUrlBytes(url);
        const img = url.startsWith("data:image/jpeg") ? await ctx.doc.embedJpg(bytes) : await ctx.doc.embedPng(bytes);
        pdfPage.drawImage(img, { x, y, width: it.w, height: it.h, rotate: degrees(it.angle), opacity: it.opacity });
        continue;
      }
      let font = await std(it.bold);
      try { font.encodeText(it.text); } catch { font = await ctx.font("sans", it.bold, false); } // letters Helvetica lacks
      pdfPage.drawText(it.text, { x, y, size: it.size, font, color: hexToRgb(it.color), opacity: it.opacity, rotate: degrees(it.angle) });
    }
  }
}

// ---- true redaction ----------------------------------------------------------------------------

const DPI = 200;
const canvasBytes = async (canvas) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9))).arrayBuffer());

/** The redacted rect as it sits on the new picture page (PDF points from its top-left). */
function shownRect(page, rect) {
  const a = pageToShown(page, rect.x, rect.y), b = pageToShown(page, rect.x + rect.w, rect.y + rect.h);
  const c = cropOf(page.id);
  const tl = c ? pageToShown(page, c.l, c.t) : { x: 0, y: 0 }, br = c ? pageToShown(page, page.w - c.r, page.h - c.b) : { x: 0, y: 0 };
  const offX = c ? Math.min(tl.x, br.x) : 0, offY = c ? Math.min(tl.y, br.y) : 0;
  return { x0: Math.min(a.x, b.x) - offX, y0: Math.min(a.y, b.y) - offY, x1: Math.max(a.x, b.x) - offX, y1: Math.max(a.y, b.y) - offY };
}

async function redact(ctx) {
  if (!ctx.redactions.length) return;
  const byPage = new Map();
  for (const r of ctx.redactions) (byPage.get(r.pageId) || byPage.set(r.pageId, []).get(r.pageId)).push(r.rect);
  const idx = ctx.pages.map((p, i) => (byPage.has(p.page.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;

  // 1. the document as it is now (the black boxes are already drawn), opened in pdf.js
  const mid = await openPdf(await ctx.doc.save({ useObjectStreams: false }));
  const sizes = new Map();
  const dead = [];
  try {
    // 2. swap each page for a picture of itself
    for (const i of idx) {
      const pg = await mid.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const g = canvas.getContext("2d", { alpha: false });
      g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvas, canvasContext: g, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
      // form fields and other annotations are drawn on top of the black boxes, so black the areas out again
      g.fillStyle = "#000";
      for (const r of byPage.get(ctx.pages[i].page.id)) { const a = shownRect(ctx.pages[i].page, r), k = DPI / 72; g.fillRect(a.x0 * k, a.y0 * k, (a.x1 - a.x0) * k, (a.y1 - a.y0) * k); }
      const img = await ctx.doc.embedJpg(await canvasBytes(canvas));
      canvas.width = canvas.height = 1;
      const fresh = ctx.doc.insertPage(i, [vp1.width, vp1.height]);
      fresh.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      dead.push(ctx.doc.getPage(i + 1).ref);
      ctx.doc.removePage(i + 1);
      ctx.pages[i].pdfPage = fresh;
      sizes.set(i, { w: vp1.width, h: vp1.height });
    }
  } finally { mid.destroy?.(); }
  severRefs(ctx.doc, dead);
  sweep(ctx.doc);

  // 3. prove it: open the result and look for words inside the redacted boxes
  const out = await openPdf(await ctx.doc.save({ useObjectStreams: false }));
  let leftover = 0, areas = 0;
  try {
    for (const i of idx) {
      const pg = await out.getPage(i + 1);
      const { h } = sizes.get(i);
      const tc = await pg.getTextContent();
      const rects = byPage.get(ctx.pages[i].page.id).map((r) => shownRect(ctx.pages[i].page, r));
      areas += rects.length;
      for (const t of tc.items) {
        if (!t.str?.trim()) continue;
        const x0 = t.transform[4], x1 = x0 + t.width, y0 = h - t.transform[5] - (t.height || 0), y1 = h - t.transform[5];
        if (rects.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0)) leftover++;
      }
    }
  } finally { out.destroy?.(); }
  if (leftover) throw new Error("The redaction check failed: some hidden text was still readable, so nothing was saved. Please tell us about this.");
  ctx.notes.push(`Redacted ${areas} area${areas === 1 ? "" : "s"} on ${idx.length} page${idx.length === 1 ? "" : "s"}. Checked: the hidden text is gone. Those pages are now pictures, so their text can't be selected.`);
}

// ---- a fix for removePage ----------------------------------------------------------------------
// This version of pdf-lib deletes a page's object when you remove the page, so the core's
// "remove every page, then add them back in the new order" breaks reordering and deleting.
// Keep the object (the sweep step below drops the ones nobody uses).
function keepRemovedPages() {
  const proto = PDFDocument.prototype;
  if (proto.removePage.__keeps) return;
  const orig = proto.removePage;
  proto.removePage = function removePage(index) {
    const ref = this.getPage(index).ref;
    const obj = this.context.lookup(ref);
    orig.call(this, index);
    if (obj && !this.context.lookup(ref)) this.context.assign(ref, obj);
  };
  proto.removePage.__keeps = true;
}

// ---- registering -----------------------------------------------------------------------------

export function installSteps(app) {
  keepRemovedPages();
  app.registerExportStep({
    id: "pg-crop", label: "Cropping pages", order: 120,
    run(ctx) {
      for (const { page, pdfPage } of ctx.pages) {
        const c = cropOf(page.id);
        if (!c) continue;
        const [x0, y0, x1, y1] = page.box;
        pdfPage.setCropBox(x0 + c.l, y0 + c.b, Math.max(1, x1 - x0 - c.l - c.r), Math.max(1, y1 - y0 - c.t - c.b));
      }
    },
  });
  app.registerExportStep({
    id: "pg-flatten", label: "Locking answers", order: 150,
    run(ctx) {
      if (!get("flatten").on) return;
      try {
        const form = ctx.doc.getForm();
        if (form.getFields().length) form.flatten();
      } catch (e) { console.warn("[flatten]", e); ctx.notes.push("Some form fields could not be flattened."); }
    },
  });
  app.registerExportStep({
    id: "pg-content", label: "Adding watermark and page numbers", order: 200,
    async run(ctx) {
      if (get("watermark").on || get("numbers").on || get("headfoot").on) await drawItems(ctx);
    },
  });
  app.registerExportStep({ id: "pg-redact", label: "Redacting for real", order: 500, run: redact });
  app.registerExportStep({
    id: "pg-sweep", label: "Tidying up", order: 800,
    run(ctx) { sweep(ctx.doc); }, // deleted pages must not stay hidden inside the file
  });
  app.registerExportStep({
    id: "security", label: "Locking with your password", order: 900,
    run(ctx) { if (lockDoc(ctx.doc, ctx.notes)) ctx.notes.push("Your PDF is locked: it needs the password to open."); },
  });
}
