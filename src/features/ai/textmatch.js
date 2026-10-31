// Finding words on a page: turns a quote (or a regex like emails) into boxes in page space.
// Pure functions, no DOM, so they can be unit-tested.

/** A line's text plus where each run sits inside it (same spacing rule as core joinRuns). */
export function lineMap(line) {
  let text = "", prevEnd = null;
  const segs = [];
  for (const r of line.runs) {
    if (prevEnd != null && r.x - prevEnd > r.size * 0.18 && !text.endsWith(" ") && !r.str.startsWith(" ")) text += " ";
    segs.push({ start: text.length, end: text.length + r.str.length, run: r });
    text += r.str;
    prevEnd = r.x + r.w;
  }
  return { text, segs };
}

/** The box for characters [a, b) of one mapped line. */
export function spanRect(map, a, b) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, first = null;
  for (const s of map.segs) {
    const lo = Math.max(a, s.start), hi = Math.min(b, s.end);
    if (hi <= lo || s.end === s.start) continue;
    const len = s.end - s.start, r = s.run;
    x0 = Math.min(x0, r.x + (r.w * (lo - s.start)) / len);
    x1 = Math.max(x1, r.x + (r.w * (hi - s.start)) / len);
    y0 = Math.min(y0, r.y);
    y1 = Math.max(y1, r.y + r.h);
    first = first || r;
  }
  if (!first) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, run: first };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A quote becomes a regex that ignores case and how much white space sits between words. */
export function quoteRegex(quote) {
  const words = String(quote).trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!words.length) throw new Error("The text to find is empty.");
  return new RegExp(words.join("\\s+"), "gi");
}

/** Build a safe regex from AI input, or explain what is wrong. */
export function toRegex({ quote, regex }) {
  if (quote && String(quote).trim()) return quoteRegex(quote);
  if (regex && String(regex).trim()) {
    if (String(regex).length > 200) throw new Error("That pattern is too long.");
    try { return new RegExp(String(regex), "gi"); } catch (e) { throw new Error(`That pattern isn't valid: ${e.message}`); }
  }
  throw new Error("Give either a quote or a regex.");
}

/** Patterns for the kinds of personal details people ask to hide. */
export const PII = {
  email: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
  phone: "(?:\\+?\\d[\\d\\s().-]{7,}\\d)",
  iban: "\\b[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){2,7}(?:\\s?[A-Z0-9]{1,4})?\\b",
  card: "\\b(?:\\d[ -]?){13,19}\\b",
  date: "\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b",
  postcode: "\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}\\b",
};

/**
 * Find matches on a page. Matches inside one line give one box; a match across lines gives one box
 * per line. Lines are joined with a single space so a phrase can run over a line break.
 * @returns {{ text: string, rects: {x,y,w,h}[], first: object, singleLine: boolean }[]}
 */
export function findMatches(lines, re, { max = 60 } = {}) {
  const maps = lines.map(lineMap);
  let flat = "";
  const starts = [];
  for (const m of maps) { starts.push(flat.length); flat += m.text + " "; }
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(flat)) && out.length < max) {
    if (!m[0]) { re.lastIndex++; continue; }
    const a = m.index, b = a + m[0].length;
    const rects = [];
    let first = null;
    maps.forEach((map, i) => {
      const lo = Math.max(a, starts[i]), hi = Math.min(b, starts[i] + map.text.length);
      if (hi <= lo) return;
      const r = spanRect(map, lo - starts[i], hi - starts[i]);
      if (r) { first = first || r.run; rects.push({ x: r.x, y: r.y, w: r.w, h: r.h }); }
    });
    if (rects.length) out.push({ text: m[0], rects, first, singleLine: rects.length === 1 });
  }
  return out;
}

/** Parse "1-3, 5" or "all" into 1-based page numbers inside 1..count. */
export function parsePages(spec, count, current = 1) {
  if (spec == null || spec === "" || spec === "all") return Array.from({ length: count }, (_, i) => i + 1);
  if (spec === "current") return [current];
  const out = new Set();
  const parts = Array.isArray(spec) ? spec : String(spec).split(",");
  for (const p of parts) {
    const t = String(p).trim();
    const m = t.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a > b) throw new Error(`“${t}” goes backwards.`);
      for (let n = a; n <= b; n++) out.add(n);
    } else if (/^\d+$/.test(t)) out.add(+t);
    else throw new Error(`I can't read the page list “${t}”. Use numbers like 1-3, 5.`);
  }
  const list = [...out].sort((a, b) => a - b);
  const bad = list.find((n) => n < 1 || n > count);
  if (bad) throw new Error(`Page ${bad} doesn't exist. This document has ${count} page${count === 1 ? "" : "s"}.`);
  return list;
}

/** Round to one decimal. */
export const r1 = (n) => Math.round(n * 10) / 10;
