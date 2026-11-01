// A small TrueType font writer for fonts rebuilt in the browser (see type3.js). TrueType rather than
// CFF because Windows thickens unhinted CFF letters on screen, so edits looked bolder than the page.
// Outlines come in our form: [["M", p], ["L", p], ["Q", c, p], ["C", c1, c2, p], ["Z"]], p = [x, y].

class Out {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); return this; }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff); }
  pad() { while (this.b.length % 4) this.b.push(0); return this; }
}

/** Split a cubic into quadratics close enough to round to the same whole units (tolerance 0.5). */
export function cubicToQuads(p0, c1, c2, p3) {
  const d = Math.hypot(p3[0] - 3 * c2[0] + 3 * c1[0] - p0[0], p3[1] - 3 * c2[1] + 3 * c1[1] - p0[1]);
  const n = Math.min(16, Math.max(1, Math.ceil(Math.cbrt(((Math.sqrt(3) / 36) * d) / 0.5))));
  const at = (t) => [0, 1].map((k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * p3[k]);
  const slope = (t) => [0, 1].map((k) => 3 * (1 - t) ** 2 * (c1[k] - p0[k]) + 6 * (1 - t) * t * (c2[k] - c1[k]) + 3 * t * t * (p3[k] - c2[k]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, h = (t1 - t0) / 3;
    const q0 = at(t0), q3 = i === n - 1 ? p3 : at(t1), s0 = slope(t0), s1 = slope(t1);
    const q1 = [q0[0] + h * s0[0], q0[1] + h * s0[1]], q2 = [q3[0] - h * s1[0], q3[1] - h * s1[1]];
    out.push([[(3 * (q1[0] + q2[0]) - q0[0] - q3[0]) / 4, (3 * (q1[1] + q2[1]) - q0[1] - q3[1]) / 4], q3]);
  }
  return out;
}

/** Contours as rounded points [x, y, onCurve]. */
function contours(cmds) {
  const out = [];
  let cur = null, last = null;
  for (const [t, a, b, c] of cmds) {
    if (t === "M") { cur = [[a, true]]; out.push(cur); last = a; }
    else if (!cur || t === "Z") continue; // TrueType contours close themselves
    else if (t === "L") { cur.push([a, true]); last = a; }
    else if (t === "Q") { cur.push([a, false], [b, true]); last = b; }
    else if (t === "C") { for (const [q, e] of cubicToQuads(last, a, b, c)) cur.push([q, false], [e, true]); last = c; }
  }
  return out.map((c) => {
    const pts = [];
    for (const [[x, y], on] of c) {
      const p = [Math.round(x), Math.round(y), on], prev = pts.at(-1);
      if (prev && prev[0] === p[0] && prev[1] === p[1] && prev[2] && on) continue;
      pts.push(p);
    }
    const first = pts[0], end = pts.at(-1);
    if (pts.length > 1 && end[2] && end[0] === first[0] && end[1] === first[1]) pts.pop();
    return pts;
  }).filter((c) => c.length >= 3);
}

const sum32 = (bytes) => {
  let s = 0;
  for (let i = 0; i < bytes.length; i += 4) s = (s + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | (bytes[i + 3] | 0))) >>> 0;
  return s;
};

/**
 * A TrueType font file.
 * @param {Array<{ unicode: number, adv: number, cmds: Array }>} glyphs BMP letters (others are skipped)
 * @param {{ family?: string, unitsPerEm?: number, ascender: number, descender: number }} o
 * @returns {ArrayBuffer}
 */
export function makeTtf(glyphs, { family = "OC PDF", unitsPerEm = 1000, ascender, descender }) {
  const list = [{ unicode: -1, adv: Math.round(unitsPerEm / 2), cmds: [] }, ...glyphs.filter((g) => g.unicode > 0 && g.unicode < 0xffff).sort((a, b) => a.unicode - b.unicode)];
  const glyf = new Out(), loca = [], hm = [];
  let maxPts = 0, maxCts = 0, box = [Infinity, Infinity, -Infinity, -Infinity], advMax = 0;
  for (const g of list) {
    loca.push(glyf.b.length);
    const cs = contours(g.cmds), adv = Math.max(0, Math.round(g.adv));
    advMax = Math.max(advMax, adv);
    if (!cs.length) { hm.push([adv, 0, null]); continue; }
    const pts = cs.flat(), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const gb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    box = [Math.min(box[0], gb[0]), Math.min(box[1], gb[1]), Math.max(box[2], gb[2]), Math.max(box[3], gb[3])];
    maxPts = Math.max(maxPts, pts.length); maxCts = Math.max(maxCts, cs.length);
    hm.push([adv, gb[0], gb]);
    glyf.i16(cs.length).i16(gb[0]).i16(gb[1]).i16(gb[2]).i16(gb[3]);
    let end = -1;
    for (const c of cs) glyf.u16((end += c.length));
    glyf.u16(0); // no instructions
    for (const p of pts) glyf.u8(p[2] ? 1 : 0); // every coordinate as a full 16-bit step
    let px = 0, py = 0;
    for (const p of pts) { glyf.i16(p[0] - px); px = p[0]; }
    for (const p of pts) { glyf.i16(p[1] - py); py = p[1]; }
    glyf.pad();
  }
  loca.push(glyf.b.length);
  if (!Number.isFinite(box[0])) box = [0, 0, 0, 0];
  const n = list.length;

  const head = new Out().u32(0x10000).u32(0x10000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(unitsPerEm)
    .u32(0).u32(0).u32(0).u32(0).i16(box[0]).i16(box[1]).i16(box[2]).i16(box[3]).u16(0).u16(8).i16(2).i16(1).i16(0);
  const sides = hm.filter((h) => h[2]);
  const hhea = new Out().u32(0x10000).i16(ascender).i16(descender).i16(0).u16(advMax)
    .i16(Math.min(0, ...sides.map((h) => h[1]))).i16(Math.min(0, ...sides.map((h) => h[0] - h[2][2]))).i16(Math.max(0, ...sides.map((h) => h[2][2])))
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);
  const maxp = new Out().u32(0x10000).u16(n).u16(maxPts).u16(maxCts).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const advs = hm.map((h) => h[0]).filter(Boolean);
  const codes = list.slice(1).map((g) => g.unicode);
  const os2 = new Out().u16(4).i16(Math.round(advs.reduce((a, b) => a + b, 0) / (advs.length || 1))).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300).i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0); // PANOSE
  os2.u32(1).u32(0).u32(0).u32(0).u8(79).u8(67).u8(80).u8(68) // basic Latin, vendor "OCPD"
    // regular + use the typo metrics, all equal, so every browser puts the baseline where the PDF does
    .u16(0xc0).u16(codes[0] ?? 32).u16(codes.at(-1) ?? 32).i16(ascender).i16(descender).i16(0)
    .u16(ascender).u16(-descender).u32(1).u32(0).i16(500).i16(700).u16(0).u16(32).u16(0);
  const hmtx = new Out();
  for (const [adv, lsb] of hm) hmtx.u16(adv).i16(lsb);
  const locaT = new Out();
  for (const o of loca) locaT.u32(o);

  // cmap format 4: runs of codes whose glyph ids follow on
  const segs = [];
  list.slice(1).forEach((g, i) => {
    const s = segs.at(-1), gid = i + 1;
    if (s && g.unicode === s.end + 1 && gid - g.unicode === s.delta) s.end = g.unicode;
    else segs.push({ start: g.unicode, end: g.unicode, delta: gid - g.unicode });
  });
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const sc = segs.length, sr = 2 * 2 ** Math.floor(Math.log2(sc));
  const sub = new Out().u16(4).u16(16 + sc * 8).u16(0).u16(sc * 2).u16(sr).u16(Math.floor(Math.log2(sc))).u16(sc * 2 - sr);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16((s.delta + 65536) % 65536);
  for (let i = 0; i < sc; i++) sub.u16(0);
  const cmap = new Out().u16(0).u16(1).u16(3).u16(1).u32(12);
  for (const v of sub.b) cmap.b.push(v);

  const names = [[1, family], [2, "Regular"], [3, `${family} Regular`], [4, `${family} Regular`], [6, `${family.replace(/[^A-Za-z0-9-]/g, "")}-Regular`]];
  const name = new Out().u16(0).u16(names.length).u16(6 + 12 * names.length);
  let off = 0;
  for (const [id, s] of names) { name.u16(3).u16(1).u16(0x409).u16(id).u16(s.length * 2).u16(off); off += s.length * 2; }
  for (const [, s] of names) for (const ch of s) name.u16(ch.charCodeAt(0));
  const post = new Out().u32(0x30000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables = { "OS/2": os2, cmap, glyf, head, hhea, hmtx, loca: locaT, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const file = new Out().u32(0x10000).u16(tags.length);
  const es = Math.floor(Math.log2(tags.length));
  file.u16(16 * 2 ** es).u16(es).u16(tags.length * 16 - 16 * 2 ** es);
  let at = 12 + 16 * tags.length, headAt = 0;
  const bodies = tags.map((t) => { const len = tables[t].b.length; const b = tables[t].pad().b; return { t, b, len }; });
  for (const { t, b, len } of bodies) {
    if (t === "head") headAt = at;
    for (const ch of t) file.u8(ch.charCodeAt(0));
    file.u32(sum32(b)).u32(at).u32(len);
    at += b.length;
  }
  for (const { b } of bodies) for (const v of b) file.b.push(v);
  const bytes = Uint8Array.from(file.b);
  const adj = (0xb1b0afba - sum32(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headAt + 8, adj);
  return bytes.buffer;
}
