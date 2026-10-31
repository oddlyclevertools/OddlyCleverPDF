// Copy pdf.js's character maps, standard fonts and wasm decoders into public/pdfjs (served as-is),
// so CJK text, the 14 standard fonts and JPEG2000/JBIG2 scans render offline.
import { cpSync, mkdirSync } from "node:fs";
for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  mkdirSync(`public/pdfjs/${d}`, { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${d}`, `public/pdfjs/${d}`, { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
