// Figma (and some other design tools) save text as an invisible Type3 font for search and copy,
// and draw the letters you see as plain vector shapes on top. Normal editors can only swap in a
// look-alike font. Here we line the invisible letters up with the shapes, cut the shapes into
// letters, and rebuild a real font for each text style, so edits use the PDF's own letters.
// Letters the PDF never used are filled in from Inter, scaled to match. Fonts are written as
// TrueType (ttf.js).
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRawStream, decodePDFRawStream } from "@cantoo/pdf-lib";
import { state, pageById } from "./store.js";
import { addFace, fontBytes } from "./fonts.js";
import { makeTtf } from "./ttf.js";

// ---- reading the page ------------------------------------------------------------------------

const DELIM = new Set("()<>[]{}/%");
const isSpace = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";

/** Operators of a content stream (a latin1 string) with their operands. */
export function* contentOps(src) {
  let args = [];
  const stack = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (c === "(") {
      let depth = 1, s = "";
      i++;
      while (i < n) {
        const ch = src[i++];
        if (ch === "\\") {
          const e = src[i++];
          if (e >= "0" && e <= "7") {
            let o = e;
            while (o.length < 3 && src[i] >= "0" && src[i] <= "7") o += src[i++];
            s += String.fromCharCode(parseInt(o, 8) & 255);
          } else if (e === "\r") { if (src[i] === "\n") i++; } else if (e !== "\n") s += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[e] ?? e;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")" && !--depth) break;
        s += ch;
      }
      args.push({ str: s });
      continue;
    }
    if (c === "<" || c === ">") {
      if (src[i + 1] === c) { i += 2; continue; } // dictionaries only hold marked-content tags here
      if (c === ">") { i++; continue; }
      const end = src.indexOf(">", i);
      const hex = src.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, "");
      let s = "";
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
      args.push({ str: s });
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === "[") { stack.push(args); args = []; i++; continue; }
    if (c === "]") { const arr = args; args = stack.pop() || []; args.push(arr); i++; continue; }
    if (c === "{" || c === "}") { i++; continue; }
    let j = i + 1;
    while (j < n && !isSpace(src[j]) && !DELIM.has(src[j])) j++;
    const tok = src.slice(i, j);
    i = j;
    if (c === "/") { args.push({ name: tok.slice(1) }); continue; }
    const num = Number(tok);
    if (tok !== "" && !Number.isNaN(num)) { args.push(num); continue; }
    if (tok === "BI") { // inline image: skip its data
      const end = src.indexOf("EI", i);
      i = end < 0 ? n : end + 2;
      args = [];
      continue;
    }
    yield { op: tok, args };
    args = [];
  }
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const latin1 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };
const streamText = (s) => latin1(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents());

/** code -> unicode from a ToUnicode CMap (bfchar and bfrange). */
export function parseToUnicode(text) {
  const map = new Map();
  const u16 = (hex) => { let s = ""; for (let k = 0; k + 4 <= hex.length; k += 4) s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16)); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (m[3][0] === "[") {
        [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((d, k) => map.set(a + k, u16(d[1])));
      } else {
        const hex = m[3].slice(1, -1), base = parseInt(hex.slice(-4), 16), pre = u16(hex.slice(0, -4));
        for (let k = 0; k <= b - a && k < 256; k++) map.set(a + k, pre + String.fromCharCode(base + k));
      }
    }
  }
  return map;
}

/** The page's Type3 fonts that have a ToUnicode map: name -> { widths, first, fm, uni }. */
function type3Fonts(doc, node) {
  const out = new Map();
  const fonts = node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  if (!fonts) return out;
  for (const [k, ref] of fonts.entries()) {
    const f = doc.context.lookup(ref, PDFDict);
    if (f.lookup(PDFName.of("Subtype")) !== PDFName.of("Type3")) continue;
    const tu = f.lookup(PDFName.of("ToUnicode"));
    if (!tu) continue;
    const num = (o) => doc.context.lookup(o, PDFNumber)?.asNumber() ?? 0;
    const arr = (key) => f.lookup(PDFName.of(key), PDFArray)?.asArray().map(num);
    out.set(k.toString().replace(/^\//, ""), {
      widths: arr("Widths") || [], first: num(f.get(PDFName.of("FirstChar"))), fm: arr("FontMatrix") || [0.001, 0, 0, 0.001, 0, 0],
      uni: parseToUnicode(streamText(tu)),
    });
  }
  return out;
}

/**
 * Read one page: every invisible Type3 letter with its place, and every filled vector shape.
 * Shapes are matched to letters, then letters that are shown together are grouped into styles.
 * @returns {{ styles: Map<string, Map<string, { cmds, adv }>>, shows: Array<{ style, x0, x1, base, size, text }> }} in PDF user space
 */
export function readPage(doc, index) {
  const node = doc.getPage(index).node;
  const fonts = type3Fonts(doc, node);
  const styles = new Map(), shows = [];
  if (!fonts.size) return { styles, shows };
  const contents = node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const src = parts.filter(Boolean).map(streamText).join("\n");

  let ctm = [1, 0, 0, 1, 0, 0], tm = ctm, tlm = ctm, font = null, fs = 1, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
  const gstack = [], contours = [], glyphs = [];
  let path = [], sub = null, cur = [0, 0];
  const pt = (x, y) => apply(ctm, x, y);
  let run = []; // the letters of one text block (Figma puts each letter in its own TJ string)
  const show = (str) => {
    for (let k = 0; k < str.length; k++) {
      const code = str.charCodeAt(k);
      const trm = mul([fs * th, 0, 0, fs, 0, rise], mul(tm, ctm));
      const w = (font?.widths[code - font.first] ?? 0) * (font?.fm[0] ?? 0.001);
      const tx = (w * fs + tc + (code === 32 ? tw : 0)) * th;
      const sx = Math.hypot(tm[0] * ctm[0] + tm[1] * ctm[2], tm[0] * ctm[1] + tm[1] * ctm[3]);
      if (font && Math.abs(trm[1]) < 1e-6 && Math.abs(trm[2]) < 1e-6 && trm[3] > 0) {
        run.push({ key: `${font.name}:${code}`, uni: font.uni.get(code), x: trm[4], base: trm[5], adv: tx * sx, size: trm[3], cs: [] });
      }
      tm = mul([1, 0, 0, 1, tx, 0], tm);
    }
  };
  const moveLine = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; };

  for (const { op, args: a } of contentOps(src)) {
    switch (op) {
      case "q": gstack.push(ctm); break;
      case "Q": ctm = gstack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case "cm": ctm = mul(a, ctm); break;
      case "m": sub = [["M", pt(a[0], a[1])]]; path.push(sub); cur = [a[0], a[1]]; break;
      case "l": sub?.push(["L", pt(a[0], a[1])]); cur = [a[0], a[1]]; break;
      case "c": sub?.push(["C", pt(a[0], a[1]), pt(a[2], a[3]), pt(a[4], a[5])]); cur = [a[4], a[5]]; break;
      case "v": sub?.push(["C", pt(...cur), pt(a[0], a[1]), pt(a[2], a[3])]); cur = [a[2], a[3]]; break;
      case "y": sub?.push(["C", pt(a[0], a[1]), pt(a[2], a[3]), pt(a[2], a[3])]); cur = [a[2], a[3]]; break;
      case "h": sub?.push(["Z"]); break;
      case "re": {
        const [x, y, w, h] = a;
        path.push([["M", pt(x, y)], ["L", pt(x + w, y)], ["L", pt(x + w, y + h)], ["L", pt(x, y + h)], ["Z"]]);
        sub = null;
        break;
      }
      case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*":
        for (const s of path) if (s.length > 1) contours.push(s);
        path = []; sub = null; break;
      case "S": case "s": case "n": path = []; sub = null; break;
      case "BT": tm = tlm = [1, 0, 0, 1, 0, 0]; break;
      case "Tf": font = fonts.has(a[0]?.name) ? { name: a[0].name, ...fonts.get(a[0].name) } : null; fs = a[1] ?? 1; break;
      case "Tm": tm = tlm = a.slice(0, 6); break;
      case "Td": moveLine(a[0], a[1]); break;
      case "TD": tl = -a[1]; moveLine(a[0], a[1]); break;
      case "T*": moveLine(0, -tl); break;
      case "Tc": tc = a[0]; break;
      case "Tw": tw = a[0]; break;
      case "Tz": th = a[0] / 100; break;
      case "TL": tl = a[0]; break;
      case "Ts": rise = a[0]; break;
      case "Tj": show(a[0]?.str || ""); break;
      case "'": moveLine(0, -tl); show(a[0]?.str || ""); break;
      case '"': tw = a[0]; tc = a[1]; moveLine(0, -tl); show(a[2]?.str || ""); break;
      case "TJ":
        for (const e of a[0] || []) {
          if (typeof e === "number") tm = mul([1, 0, 0, 1, (-e / 1000) * fs * th, 0], tm);
          else show(e.str);
        }
        break;
    }
    if (op === "ET" && run.length) { glyphs.push(run); run = []; }
  }

  // each shape goes to the letter whose box holds its middle (underlines and backgrounds are too big)
  const all = glyphs.flat();
  for (const s of contours) {
    const pts = s.flatMap((c) => c.slice(1));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const g = all.find((g) => cx >= g.x && cx <= g.x + g.adv && cy >= g.base - g.size * 0.35 && cy <= g.base + g.size * 1.05 &&
      x1 - x0 <= Math.max(g.adv * 1.5, g.size * 0.7) && y1 - y0 <= g.size * 1.4);
    if (g) g.cs.push(s);
  }

  // letters shown in one go share a style (Figma keeps one code per letter per font and weight)
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const run of glyphs) for (const g of run) if (!parent.has(g.key)) parent.set(g.key, g.key);
  for (const run of glyphs) for (const g of run.slice(1)) parent.set(find(g.key), find(run[0].key));

  for (const run of glyphs) {
    const style = find(run[0].key);
    if (!styles.has(style)) styles.set(style, new Map());
    const map = styles.get(style);
    for (const g of run) {
      if (!g.uni || [...g.uni].length !== 1) continue; // ligatures and unknown codes
      const have = map.get(g.uni);
      if (have && (have.cmds.length || !g.cs.length)) continue;
      const k = 1000 / g.size;
      map.set(g.uni, {
        adv: g.adv * k,
        cmds: g.cs.flat().map(([t, ...p]) => [t, ...p.map(([x, y]) => [(x - g.x) * k, (y - g.base) * k])]),
      });
    }
    // one show per line: Figma writes a whole paragraph as one text block
    let line = [];
    const flush = () => {
      if (!line.length) return;
      const last = line.at(-1);
      shows.push({ style, x0: line[0].x, x1: last.x + last.adv, base: line[0].base, size: line[0].size, text: line.map((g) => g.uni || "").join("") });
      line = [];
    };
    for (const g of run) {
      const prev = line.at(-1);
      if (prev && (Math.abs(g.base - prev.base) > g.size * 0.3 || g.x < prev.x)) flush();
      line.push(g);
    }
    flush();
  }
  return { styles, shows };
}

// ---- building a font -------------------------------------------------------------------------

const FILL = [[0x20, 0x7e], [0xa0, 0x17f], [0x2010, 0x2027], [0x2030, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122]];
const yMax = (cmds) => Math.max(0, ...cmds.flatMap((c) => c.slice(1).map((p) => p[1])));

/** A fontkit glyph's outline in our form ([type, ...points]), scaled by k. */
const fromFk = (glyph, k = 1) => glyph.path.commands.map(({ command: c, args: a }) => {
  const p = (i) => [a[i] * k, a[i + 1] * k];
  if (c === "moveTo") return ["M", p(0)];
  if (c === "lineTo") return ["L", p(0)];
  if (c === "quadraticCurveTo") return ["Q", p(0), p(2)];
  if (c === "bezierCurveTo") return ["C", p(0), p(2), p(4)];
  return ["Z"];
});
const has = (font, ch) => font.glyphForCodePoint(ch.codePointAt(0)).id > 0;

/** How much of a letter is ink: its filled area over its height squared (bold letters score higher). */
export function inkRatio(cmds) {
  let area = 0, start = null, prev = null, y0 = Infinity, y1 = -Infinity;
  const to = (p) => { area += prev[0] * p[1] - p[0] * prev[1]; prev = p; y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
  const bez = (pts) => { // flatten a curve from prev through its control points
    const p0 = prev;
    for (let t = 0.125; t <= 1.0001; t += 0.125) {
      const u = 1 - t;
      to(pts.length === 2
        ? [u * u * p0[0] + 2 * u * t * pts[0][0] + t * t * pts[1][0], u * u * p0[1] + 2 * u * t * pts[0][1] + t * t * pts[1][1]]
        : [0, 1].map((d) => u ** 3 * p0[d] + 3 * u * u * t * pts[0][d] + 3 * u * t * t * pts[1][d] + t ** 3 * pts[2][d]));
    }
  };
  for (const [t, ...ps] of cmds) {
    if (t === "M") { if (start) to(start); start = prev = ps[0]; y0 = Math.min(y0, prev[1]); y1 = Math.max(y1, prev[1]); }
    else if (!prev) continue;
    else if (t === "Z") { to(start); }
    else if (t === "L") to(ps[0]);
    else bez(ps);
  }
  if (start && prev !== start) to(start);
  return y1 > y0 ? Math.abs(area / 2) / (y1 - y0) ** 2 : 0;
}

/** The filler font (regular or bold, fontkit fonts) whose letters carry about as much ink as the style's own. */
export function pickFiller(glyphs, regular, bold) {
  let dr = 0, db = 0, n = 0;
  for (const [ch, g] of glyphs) {
    if (n >= 12 || !/[A-Za-z0-9]/.test(ch) || !g.cmds.length || !has(regular, ch) || !has(bold, ch)) continue;
    const mine = inkRatio(g.cmds), cp = ch.codePointAt(0);
    dr += Math.abs(mine - inkRatio(fromFk(regular.glyphForCodePoint(cp))));
    db += Math.abs(mine - inkRatio(fromFk(bold.glyphForCodePoint(cp))));
    n++;
  }
  return n && db < dr ? bold : regular;
}

/**
 * A TrueType font (ArrayBuffer) from a style's letters. `filler` is a fontkit font whose letters
 * fill the gaps, scaled to the same height.
 */
export function buildFont(glyphs, filler) {
  const list = [...glyphs].map(([ch, g]) => ({ unicode: ch.codePointAt(0), adv: g.adv, cmds: g.cmds }));
  if (filler) {
    let k = 1000 / filler.unitsPerEm;
    for (const ch of "HEIxzvn") {
      if (glyphs.get(ch)?.cmds.length && has(filler, ch)) { k *= yMax(glyphs.get(ch).cmds) / (filler.glyphForCodePoint(ch.codePointAt(0)).bbox.maxY * k || 1); break; }
    }
    for (const [a, b] of FILL) {
      for (let cp = a; cp <= b; cp++) {
        const f = filler.glyphForCodePoint(cp);
        if (glyphs.has(String.fromCodePoint(cp)) || !f.id) continue;
        list.push({ unicode: cp, adv: f.advanceWidth * k, cmds: fromFk(f, k) });
      }
    }
  }
  if (!list.some((g) => g.unicode === 32)) list.push({ unicode: 32, adv: 260, cmds: [] });
  // ascent + descent = 1.2 em with the baseline where Edit text puts it (see the edittext tool)
  return makeTtf(list, { ascender: 920, descender: -280 });
}

// ---- in the app ------------------------------------------------------------------------------

const pages = new Map(); // "fileId:index" -> Promise<readPage result | null>
const docs = new Map(); // fileId -> Promise<PDFDocument>
const built = new Map(); // font key -> Promise<ArrayBuffer>
const letters = new Map(); // font key -> the letters drawn from the PDF itself
const fillers = new Map();

function pageData(fileId, index) {
  const key = `${fileId}:${index}`;
  if (!pages.has(key)) {
    const f = state.files.get(fileId);
    if (!docs.has(fileId)) docs.set(fileId, PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false }));
    // shortcut: encrypted files aren't decrypted here, so their text falls back to a look-alike font
    pages.set(key, docs.get(fileId).then((d) => readPage(d, index)).catch((e) => { console.warn("[type3]", e); return null; }));
  }
  return pages.get(key);
}

const filler = (file) => {
  if (!fillers.has(file)) fillers.set(file, Promise.all([fontBytes(file), import("@pdf-lib/fontkit")]).then(([b, m]) => m.default.create(new Uint8Array(b))));
  return fillers.get(file);
};

/** The rebuilt font's bytes for a key made by type3FontFor (rebuilt after a reload too). */
export function type3FontBytes(key) {
  if (!built.has(key)) {
    const [, fileId, index, ...rest] = key.split(":");
    built.set(key, pageData(fileId, Number(index)).then(async (d) => {
      const glyphs = d?.styles.get(rest.join(":"));
      if (!glyphs) throw new Error("This PDF's font couldn't be rebuilt.");
      letters.set(key, new Set([...glyphs].filter(([ch, g]) => g.cmds.length || !ch.trim()).map(([ch]) => ch)));
      const [regular, bold] = await Promise.all([filler("Inter_400Regular"), filler("Inter_700Bold")]);
      return buildFont(glyphs, pickFiller(glyphs, regular, bold));
    }));
  }
  return built.get(key);
}

/** The letters a rebuilt font took from the PDF (others were filled in), once it's built. */
export const ownLetters = (key) => letters.get(key);

/** Make sure the screen can show a rebuilt font. */
export function ensureFace(key, css) {
  return type3FontBytes(key).then((bytes) => addFace(css, bytes)).catch((e) => console.warn("[type3]", e));
}

/**
 * For a block of Type3 text tapped with Edit text at `pt`: the rebuilt font's key and the part of
 * the block in the same text style as the tap, as runs (a line can mix styles, like
 * "Title | details", and pdf.js may join them into one run). Null when the letters can't be read
 * (then Edit text uses a look-alike font for the whole block).
 * @returns {Promise<{ key: string, runs: Array } | null>}
 */
export async function type3FontFor(pageId, block, pt) {
  const p = pageById(pageId);
  if (!p || !state.files.get(p.src.fileId)?.bytes) return null;
  const d = await pageData(p.src.fileId, p.src.index);
  if (!d) return null;
  const [bx, , , by] = p.box;
  const base = by - (block.y + block.size * 0.8); // the block's baseline in PDF space
  const row = d.shows.filter((s) => Math.abs(s.base - base) < s.size * 0.5 && s.x1 > bx + block.x && s.x0 < bx + block.x + block.w).sort((a, b) => a.x0 - b.x0);
  const words = row.filter((s) => s.text.trim());
  if (!words.length) return null;
  const x = bx + pt.x;
  const tapped = words.find((s) => x >= s.x0 && x <= s.x1) || words.reduce((a, s) => (Math.abs((s.x0 + s.x1) / 2 - x) < Math.abs((a.x0 + a.x1) / 2 - x) ? s : a));
  const same = (s) => !s.text.trim() || s.style === tapped.style;
  let a = row.indexOf(tapped), z = a;
  while (a > 0 && same(row[a - 1])) a--;
  while (z < row.length - 1 && same(row[z + 1])) z++;
  while (!row[a].text.trim()) a++;
  while (!row[z].text.trim()) z--;
  const glyphs = d.styles.get(tapped.style);
  if (![...glyphs.values()].some((g) => g.cmds.length)) return null;
  const key = `pdf3:${p.src.fileId}:${p.src.index}:${tapped.style}`;
  await type3FontBytes(key);
  const like = block.runs[0];
  return { key, runs: row.slice(a, z + 1).map((s) => ({ ...like, str: s.text, x: s.x0 - bx, w: s.x1 - s.x0, y: by - s.base - s.size * 0.8, h: s.size, size: s.size })) };
}
