// The text families people can pick. The same TTF files feed the screen (@font-face) and the saved
// PDF (embedded with fontkit), so what you see is what you save.
const BASE = import.meta.env.BASE_URL;

export const FAMILIES = {
  sans: { label: "Clean (sans)", css: "OC Sans", files: { r: "Inter_400Regular", b: "Inter_700Bold", i: "Inter_400Regular_Italic", bi: "Inter_700Bold_Italic" } },
  serif: { label: "Classic (serif)", css: "OC Serif", files: { r: "Merriweather_400Regular", b: "Merriweather_700Bold", i: "Merriweather_400Regular_Italic", bi: "Merriweather_700Bold_Italic" } },
  mono: { label: "Typewriter (mono)", css: "OC Mono", files: { r: "RobotoMono_400Regular", b: "RobotoMono_700Bold" } },
  hand: { label: "Handwriting", css: "OC Hand", files: { r: "Caveat_600SemiBold" } },
  script: { label: "Signature", css: "OC Script", files: { r: "DancingScript_600SemiBold" } },
};

// Fonts rebuilt from a PDF's own letters (see type3.js) use keys like "pdf3:<file>:<page>:<style>".
const isPdfFont = (family) => String(family).startsWith("pdf3:");
const pdfCss = (key) => `OC PDF ${key.replace(/[^\w-]/g, "_")}`;
const faces = new Set();

/** The file for a family + style, falling back to the regular face. */
export function fontFile(family, bold, italic) {
  if (isPdfFont(family)) return family;
  const f = (FAMILIES[family] || FAMILIES.sans).files;
  const key = bold && italic ? "bi" : bold ? "b" : italic ? "i" : "r";
  return f[key] || (bold && f.b) || f.r;
}

export function cssFamily(family) {
  if (!isPdfFont(family)) return `"${(FAMILIES[family] || FAMILIES.sans).css}", system-ui, sans-serif`;
  const css = pdfCss(family);
  if (!faces.has(css)) { faces.add(css); import("./type3.js").then((m) => m.ensureFace(family, css)); }
  return `"${css}", "${FAMILIES.sans.css}", system-ui, sans-serif`;
}

/** Add a font made in the browser to the page (the text redraws once it loads). */
export function addFace(css, bytes) {
  const f = new FontFace(css, bytes);
  document.fonts.add(f);
  return f.load();
}

/** Register every face for the page (call once at start). */
export function installFontFaces() {
  const rules = [];
  for (const fam of Object.values(FAMILIES)) {
    for (const [key, file] of Object.entries(fam.files)) {
      const weight = key.includes("b") ? 700 : 400;
      const style = key.includes("i") ? "italic" : "normal";
      rules.push(`@font-face{font-family:"${fam.css}";src:url("${BASE}fonts/${file}.ttf") format("truetype");font-weight:${weight};font-style:${style};font-display:swap}`);
    }
  }
  const s = document.createElement("style");
  s.textContent = rules.join("\n");
  document.head.append(s);
}

const cache = new Map();
/** The TTF bytes for a face (fetched once). */
export async function fontBytes(file) {
  if (isPdfFont(file)) {
    // never let a font we couldn't rebuild stop a save: use the clean sans instead
    return import("./type3.js").then((m) => m.type3FontBytes(file)).catch((e) => { console.warn("[type3]", e); return fontBytes(FAMILIES.sans.files.r); });
  }
  if (!cache.has(file)) {
    cache.set(file, fetch(`${BASE}fonts/${file}.ttf`).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the font ${file}.`);
      return r.arrayBuffer();
    }));
  }
  return cache.get(file);
}
