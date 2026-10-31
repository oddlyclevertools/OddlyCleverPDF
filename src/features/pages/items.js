// Works out WHAT goes on each page (watermark, page numbers, header/footer) and WHERE, in page
// space. The live preview and the saved PDF both use this, so they match.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { state } from "../../core/store.js";
import { get, cropOf } from "./cfg.js";
import { fillFormat, scopeIndexes, viewArea, shownArea, placeItem, spotCenter } from "./logic.js";

let fonts = null;
let loading = null;
/** Load Helvetica's measurements (once). Resolves { regular, bold } with widthOfTextAtSize. */
export function metrics() {
  if (fonts) return Promise.resolve(fonts);
  return (loading ||= (async () => {
    const d = await PDFDocument.create();
    fonts = { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) };
    return fonts;
  })());
}
export const metricsReady = () => !!fonts;

const wOf = (text, size, bold) => {
  const f = bold ? fonts.bold : fonts.regular;
  try { return f.widthOfTextAtSize(text, size); } catch { return text.length * size * 0.55; } // letters Helvetica lacks
};

/** The pieces to draw on one page. Needs metrics() to have loaded. */
export function itemsFor(page, index, total) {
  if (!fonts) return [];
  const out = [];
  const area = viewArea(page, cropOf(page.id));
  const sh = shownArea(page, area);
  const base = (state.name || "").replace(/\.[a-z0-9]{1,5}$/i, "");
  const date = new Date().toLocaleDateString();

  const wm = get("watermark");
  if (wm.on && scopeIndexes(wm.scope, wm.range, total).includes(index)) {
    let w, h, text = String(wm.text || "").trim();
    const isImg = wm.kind === "picture";
    if (isImg && wm.imageId && wm.imgW) {
      w = (wm.size / 100) * sh.w; h = (w * wm.imgH) / wm.imgW;
      if (h > sh.h * 0.9) { h = sh.h * 0.9; w = (h * wm.imgW) / wm.imgH; }
    } else if (!isImg && text) {
      let size = ((wm.size / 100) * sh.w) / Math.max(1, wOf(text, 1, true));
      size = Math.min(size, sh.h * 0.5);
      w = wOf(text, size, true); h = size * 0.7;
      var wmSize = size;
    }
    if (w) {
      const spots = [];
      if (wm.position === "tiled") {
        const sx = w * 1.5 + 40, sy = h * 3 + 60;
        for (let gy = 0, y = 40; y < sh.h + sy && gy < 12; gy++, y += sy) {
          for (let x = (gy % 2 ? sx / 2 : 0); x < sh.w + sx && spots.length < 70; x += sx) spots.push({ x, y });
        }
      } else spots.push(spotCenter(wm.position, sh.w, sh.h, w, h, 24));
      for (const c of spots) {
        const p = placeItem(page, area, c, w, h, Number(wm.angle) || 0);
        out.push(isImg
          ? { kind: "image", imageId: wm.imageId, ...p, w, h, opacity: wm.opacity }
          : { kind: "text", text, size: wmSize, bold: true, ...p, w, h, color: wm.color, opacity: wm.opacity });
      }
    }
  }

  const nb = get("numbers");
  if (nb.on && !(nb.skipFirst && index === 0)) {
    const text = fillFormat(nb.format, { n: Number(nb.start) + index, total, name: base, date });
    if (text.trim()) {
      const w = wOf(text, nb.size, false), h = nb.size * 0.7;
      out.push({ kind: "text", text, size: nb.size, bold: false, ...placeItem(page, area, spotCenter(nb.position, sh.w, sh.h, w, h, 28), w, h, 0), w, h, color: nb.color, opacity: 1 });
    }
  }

  const hf = get("headfoot");
  if (hf.on && !(hf.skipFirst && index === 0)) {
    const vars = { n: index + 1, total, name: base, date };
    for (const [key, spot] of [["hl", "top-left"], ["hc", "top-center"], ["hr", "top-right"], ["fl", "bottom-left"], ["fc", "bottom-center"], ["fr", "bottom-right"]]) {
      const text = fillFormat(hf[key], vars);
      if (!text.trim()) continue;
      const w = wOf(text, hf.size, false), h = hf.size * 0.7;
      out.push({ kind: "text", text, size: hf.size, bold: false, ...placeItem(page, area, spotCenter(spot, sh.w, sh.h, w, h, 28), w, h, 0), w, h, color: hf.color, opacity: 1 });
    }
  }
  return out;
}
