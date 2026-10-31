// The shared "document blocks" shape that every writer reads and every importer produces.
//   block: { type: "heading", level, runs } | { type: "p", runs, align? } | { type: "list", ordered, items: [runs] }
//        | { type: "table", rows: [[runs]], header? } | { type: "image", data: Uint8Array, mime, w, h }
//        | { type: "code", text } | { type: "hr" } | { type: "pagebreak", w?, h? }
//   run:   { t, b?, i?, sz?, fam?, code?, href?, color? }

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
/** XML text must not hold control characters. */
export const xmlSafe = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");

export const runsText = (runs) => (runs || []).map((r) => r.t).join("");

/** Merge neighbouring runs that look the same. */
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.t) continue;
    const p = out[out.length - 1];
    if (p && !!p.b === !!r.b && !!p.i === !!r.i && p.sz === r.sz && p.fam === r.fam && !!p.code === !!r.code && p.href === r.href && p.color === r.color) p.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

export const bytesToBase64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const dataUri = (img) => `data:${img.mime};base64,${bytesToBase64(img.data)}`;

export const extFromMime = (m) => (m === "image/jpeg" ? "jpg" : m === "image/png" ? "png" : m === "image/webp" ? "webp" : m === "image/gif" ? "gif" : m === "image/svg+xml" ? "svg" : "png");

export const baseName = (name) => String(name || "document").replace(/\.[a-z0-9]{1,5}$/i, "");

/** Is this a heading-like or empty block? helpers for writers. */
export const isTable = (b) => b.type === "table";
