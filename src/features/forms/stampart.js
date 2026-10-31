// Our own stamp art: a rounded rubber-stamp badge with a slightly rough, ink-starved edge.
// Pure SVG strings (no pictures borrowed from anywhere); stampPng() draws one at 3x.

export const BADGES = ["APPROVED", "PAID", "DRAFT", "CONFIDENTIAL", "RECEIVED", "VOID", "SIGN HERE"];
export const STAMP_COLORS = [["#d81f3c", "Red"], ["#1f4fd8", "Blue"], ["#11845b", "Green"], ["#16121b", "Black"]];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** The outline size for a stamp text, in SVG units. */
export function stampSize(text) {
  const n = String(text).length;
  return { w: Math.max(200, Math.round(n * 34 + 80)), h: 104 };
}

/** @returns {{ svg: string, w: number, h: number }} w/h in SVG units (padding included) */
export function stampSvg(text, color = "#d81f3c", { seed = 5 } = {}) {
  text = String(text || "STAMP").toUpperCase().slice(0, 24);
  const { w: bw, h: bh } = stampSize(text);
  const pad = 12, W = bw + pad * 2, H = bh + pad * 2;
  const arrow = text === "SIGN HERE";
  const x0 = pad + 4, y0 = pad + 4, x1 = pad + bw - 4, y1 = pad + bh - 4;
  const outer = arrow
    ? `<path d="M${x0 + 12} ${y0} H${x1 - 36} L${x1} ${(y0 + y1) / 2} L${x1 - 36} ${y1} H${x0 + 12} Q${x0} ${y1} ${x0} ${y1 - 12} V${y0 + 12} Q${x0} ${y0} ${x0 + 12} ${y0} Z" fill="none" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`
    : `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="18" fill="none" stroke="${color}" stroke-width="6"/>`;
  const inner = arrow ? "" : `<rect x="${x0 + 10}" y="${y0 + 10}" width="${x1 - x0 - 20}" height="${y1 - y0 - 20}" rx="10" fill="none" stroke="${color}" stroke-width="2"/>`;
  const tw = bw - (arrow ? 90 : 64);
  const cx = arrow ? pad + (bw - 18) / 2 : pad + bw / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="rough" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}" result="warp"/>
<feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" result="bent"/>
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="${seed + 4}" result="grain"/>
<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  14 0 0 0 -5.2" result="speck"/>
<feComposite in="bent" in2="speck" operator="in"/>
</filter></defs>
<g filter="url(#rough)" transform="rotate(-5 ${W / 2} ${H / 2})" opacity="0.94">
${outer}${inner}
<text x="${cx}" y="${H / 2 + 15}" text-anchor="middle" textLength="${tw}" lengthAdjust="spacing" font-family="'Arial Black', Impact, 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${arrow ? 40 : 44}" fill="${color}">${esc(text)}</text>
</g></svg>`;
  return { svg, w: W, h: H };
}

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const cache = new Map();
/** The stamp as a transparent PNG at 3x, with the size in points at 1x. */
export function stampPng(text, color, scale = 3) {
  const key = `${text}|${color}|${scale}`;
  if (!cache.has(key)) {
    cache.set(key, new Promise((resolve, reject) => {
      const { svg, w, h } = stampSvg(text, color);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w * scale; c.height = h * scale;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, c.width, c.height);
        // one flat ink colour and four soft levels: looks the same, and the file stays small
        const px = g.getImageData(0, 0, c.width, c.height), d = px.data;
        const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
        for (let i = 0; i < d.length; i += 4) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.round(d[i + 3] / 85) * 85; }
        g.putImageData(px, 0, 0);
        resolve({ url: c.toDataURL("image/png"), w: c.width, h: c.height });
      };
      img.onerror = () => reject(new Error("Couldn't draw the stamp."));
      img.src = svgDataUrl(svg);
    }));
  }
  return cache.get(key);
}

/** Vector marks for flat paper forms: strokes in a unit box (0..1; the line is wider). */
export const MARKS = {
  check: { label: "Tick", glyph: "✓", strokes: [[[0.06, 0.56], [0.36, 0.9], [0.95, 0.08]]], width: 0.15, w: 1, h: 1 },
  cross: { label: "Cross", glyph: "✗", strokes: [[[0.1, 0.1], [0.9, 0.9]], [[0.9, 0.1], [0.1, 0.9]]], width: 0.14, w: 1, h: 1 },
  dot: { label: "Dot", glyph: "●", strokes: [[[0.5, 0.5], [0.5001, 0.5]]], width: 0.5, w: 1, h: 1 },
  line: { label: "Line", glyph: "—", strokes: [[[0, 0.5], [1.8, 0.5]]], width: 0.1, w: 1.8, h: 1 },
};

/** An `ink` object for a mark at (cx, cy), sized to the text size. */
export function markObject(id, cx, cy, size, color = "#111111") {
  const m = MARKS[id];
  const W = m.w * size, H = m.h * size;
  const x = cx - W / 2, y = cy - H / 2;
  return {
    type: "ink", color, width: Math.max(1, Math.round(m.width * size * 10) / 10), opacity: 1,
    strokes: m.strokes.map((s) => s.map(([px, py]) => [Math.round((x + px * size) * 100) / 100, Math.round((y + py * size) * 100) / 100])),
  };
}
