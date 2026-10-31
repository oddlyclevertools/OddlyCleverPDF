// Scanning maths on plain RGBA arrays (so node can test it): find the page in a photo, flatten a
// four-corner shape into a straight page (perspective warp), and the black-and-white document filter.

export function toGray(data, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  return g;
}

function otsu(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += i * hist[i];
    const d = sB / wB - (sum - sB) / wF, between = wB * wF * d * d;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** First and last index whose count passes `frac` of the biggest count. */
function span(counts, frac) {
  const max = Math.max(...counts);
  if (!max) return null;
  const lim = max * frac;
  let a = 0, b = counts.length - 1;
  while (a < b && counts[a] < lim) a++;
  while (b > a && counts[b] < lim) b--;
  return [a, b];
}

function boxFromMask(mask, w, h, frac) {
  const cols = new Float64Array(w), rows = new Float64Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { cols[x]++; rows[y]++; }
  const sx = span(cols, frac), sy = span(rows, frac);
  if (!sx || !sy) return null;
  return [sx[0] / w, sy[0] / h, (sx[1] + 1) / w, (sy[1] + 1) / h];
}

/**
 * Where is the page? Tries "bright paper on a darker table", then "strong edges". Returns a box in
 * 0..1 [x0, y0, x1, y1]; falls back to the whole photo with a small margin.
 */
export function detectDocBox(gray, w, h) { return detectDoc(gray, w, h).box; }

/**
 * The page as four corners (0..1, clockwise from the top left). A tilted sheet on a darker table
 * gets a real tilted shape (the extreme points of the bright area); otherwise the box's corners.
 */
export function detectDocQuad(gray, w, h) { return detectDoc(gray, w, h).quad; }

function detectDoc(gray, w, h) {
  const fallback = [0.03, 0.03, 0.97, 0.97];
  const area = (b) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  // 1. bright paper
  const t = otsu(gray);
  const bright = new Uint8Array(w * h);
  let on = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] > t) { bright[i] = 1; on++; }
  const frac = on / gray.length;
  if (frac > 0.12 && frac < 0.93) {
    const b = boxFromMask(bright, w, h, 0.35);
    if (area(b) > 0.2) return { box: pad(b, 0.005), quad: tiltedQuad(bright, w, h, b) || boxToQuad(pad(b, 0.005)) };
  }
  // 2. edges
  const edge = new Uint8Array(w * h);
  let sum = 0, sq = 0;
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = gray[i + 1] - gray[i - 1], gy = gray[i + w] - gray[i - w];
    const m = Math.abs(gx) + Math.abs(gy);
    mag[i] = m; sum += m; sq += m * m;
  }
  const n = w * h, mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const lim = mean + sd * 1.2;
  for (let i = 0; i < n; i++) if (mag[i] > lim) edge[i] = 1;
  const b = boxFromMask(edge, w, h, 0.12);
  const box = area(b) > 0.2 ? pad(b, 0.01) : fallback;
  return { box, quad: boxToQuad(box) };
}

/** Corners from the extreme bright pixels (after trimming specks); null if it isn't a clear page. */
function tiltedQuad(mask, w, h, box) {
  const x0 = Math.max(1, Math.floor(box[0] * w)), x1 = Math.min(w - 2, Math.ceil(box[2] * w)), y0 = Math.max(1, Math.floor(box[1] * h)), y1 = Math.min(h - 2, Math.ceil(box[3] * h));
  let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity], count = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (!(mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w])) continue; // eroded: specks drop out
    count++;
    const s = x + y, d = x - y;
    if (s < tl[2]) tl = [x, y, s];
    if (s > br[2]) br = [x + 1, y + 1, s];
    if (d > tr[2]) tr = [x + 1, y, d];
    if (d < bl[2]) bl = [x, y + 1, d];
  }
  if (!count) return null;
  const c = [tl, tr, br, bl].reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
  const q = [tl, tr, br, bl].map(([x, y]) => [Math.max(0, Math.min(1, (c[0] + (x - c[0]) * 1.025) / w)), Math.max(0, Math.min(1, (c[1] + (y - c[1]) * 1.025) / h))]);
  // shoelace area: a real page fills most of its box
  let a = 0;
  for (let i = 0; i < 4; i++) { const [p, r] = [q[i], q[(i + 1) % 4]]; a += p[0] * r[1] - r[0] * p[1]; }
  const boxA = (box[2] - box[0]) * (box[3] - box[1]);
  return Math.abs(a) / 2 > boxA * 0.55 ? q : null;
}

function pad(b, p) { return [Math.max(0, b[0] - p), Math.max(0, b[1] - p), Math.min(1, b[2] + p), Math.min(1, b[3] + p)]; }

/** A box as four corners, clockwise from the top left. */
export const boxToQuad = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];

/** Solve the 8 unknowns of a homography with Gaussian elimination. Returns [a..h] (h33 = 1). */
export function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]);
}

/** The straightened size of a quad (px corners): the longer of each pair of opposite sides. */
export function quadSize(q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { w: Math.max(d(q[0], q[1]), d(q[3], q[2])), h: Math.max(d(q[0], q[3]), d(q[1], q[2])) };
}

/**
 * Cut a four-corner shape (px, clockwise from top-left) out of an RGBA picture and straighten it
 * to ow x oh, with smooth (bilinear) sampling.
 */
export function warpPerspective(src, sw, sh, quad, ow, oh) {
  const out = new Uint8ClampedArray(ow * oh * 4);
  // map output (u, v) -> source (x, y)
  const H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], quad);
  if (!H) return out;
  const [a, b, c, d, e, f, g, h] = H;
  for (let v = 0; v < oh; v++) {
    for (let u = 0; u < ow; u++) {
      const den = g * u + h * v + 1;
      const x = (a * u + b * v + c) / den, y = (d * u + e * v + f) / den;
      const o = (v * ow + u) * 4;
      if (x < 0 || y < 0 || x > sw - 1 || y > sh - 1) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] = (src[i00 + k] * (1 - fx) + src[i10 + k] * fx) * (1 - fy) + (src[i01 + k] * (1 - fx) + src[i11 + k] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * The "Black & white document" look: each pixel is compared with the average of its neighbourhood
 * (an integral image makes that fast), so shadows and uneven light disappear. In place.
 */
export function adaptiveThreshold(data, w, h, { win = Math.max(15, Math.round(Math.min(w, h) / 8)), bias = 0.12 } = {}) {
  const gray = toGray(data, w, h);
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const r = win >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const v = gray[y * w + x] < (s / cnt) * (1 - bias) ? 0 : 255;
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return data;
}

/** A4 page size for a picture: portrait, or landscape for wide ones. */
export function pageFor(w, h) {
  return w / h > 1.15 ? [841.89, 595.28] : [595.28, 841.89];
}
