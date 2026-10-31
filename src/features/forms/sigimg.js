// Signature pictures. The pixel maths is pure (RGBA arrays) so the tests can run it in node;
// the canvas helpers at the bottom wrap it for the browser.

/** The box around everything that isn't (nearly) transparent, or null for an empty picture. */
export function trimBounds(data, w, h, alphaMin = 8) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Turn a photo of a signature on paper into ink on a transparent background (in place).
 * The paper brightness is the 90th percentile of the picture; pixels darker than that by more
 * than the cleanup level become ink, and the pen colour is kept (the paper tint is taken out of
 * the soft edges). `cleanup` runs 0 (keep faint marks) to 1 (only strong ink).
 */
export function inkFromPhoto(data, w, h, cleanup = 0.5) {
  const n = w * h;
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
    lum[i] = l; hist[l]++;
  }
  let acc = 0, paper = 255;
  for (let l = 0; l < 256; l++) { acc += hist[l]; if (acc >= n * 0.9) { paper = Math.max(l, 60); break; } }
  const lo = 0.06 + 0.3 * cleanup, hi = lo + 0.18;
  for (let i = 0; i < n; i++) {
    const d = (paper - lum[i]) / paper;
    const a = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
    const o = i * 4;
    if (a <= 0) { data[o + 3] = 0; continue; }
    const k = Math.max(a, 0.25);
    for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round((data[o + c] - paper * (1 - k)) / k)));
    data[o + 3] = Math.round(a * 255);
  }
  return data;
}

/** Fit a size inside a box, keeping the shape. */
export function fitSize(w, h, maxW, maxH) {
  const k = Math.min(maxW / w, maxH / h);
  return { w: w * k, h: h * k };
}

// ---- canvas helpers (browser) ------------------------------------------------------------

/** Crop a canvas to its inked part with a small margin. Returns the same canvas if it's empty. */
export function trimCanvas(canvas, pad = 6) {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const b = trimBounds(data, canvas.width, canvas.height);
  if (!b) return canvas;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  const w = Math.min(canvas.width - x, b.w + pad * 2), h = Math.min(canvas.height - y, b.h + pad * 2);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/** A canvas as a transparent PNG with its size, ready for putImage. */
export function canvasToSig(canvas) {
  return { url: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
}

export const TYPE_STYLES = [
  { id: "script", label: "Flowing", css: '400 {s}px "OC Script", cursive' },
  { id: "hand", label: "Handwritten", css: '400 {s}px "OC Hand", cursive' },
  { id: "classic", label: "Classic", css: 'italic 400 {s}px "OC Serif", Georgia, serif' },
];

/** Your name in a signature style, as a trimmed transparent canvas. */
export async function typedSignature(text, styleId, color = "#111111") {
  const style = TYPE_STYLES.find((s) => s.id === styleId) || TYPE_STYLES[0];
  const size = 120;
  const font = style.css.replace("{s}", String(size));
  try { await document.fonts.load(font, text); } catch { /* falls back to the system font */ }
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + size, h = Math.ceil(size * 1.9);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.font = font; g.fillStyle = color; g.textBaseline = "alphabetic";
  g.fillText(text, size / 2, size * 1.2);
  return trimCanvas(c);
}

/** A photo (File/Blob) of a signature on paper -> transparent canvas with the ink kept. */
export async function photoSignature(file, cleanup = 0.5, maxSide = 1400) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  inkFromPhoto(img.data, c.width, c.height, cleanup);
  g.putImageData(img, 0, 0);
  return trimCanvas(c);
}
