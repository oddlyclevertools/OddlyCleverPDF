// Render public/favicon.svg into a multi-size Windows icon (desktop/assets/OddlyCleverPDF.ico).
// Run from pdf-tool/: node desktop/tools/make_ico.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const svg = readFileSync("public/favicon.svg", "utf8");
const b = await chromium.launch({ channel: "chrome" });
const pngs = [];
for (const size of SIZES) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  pngs.push(await p.screenshot({ omitBackground: true }));
  await p.close();
}
await b.close();

// ICO = 6-byte header + 16-byte entry per image + PNG data (Windows Vista and later read PNG entries).
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let offset = head.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i, s = SIZES[i];
  head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync("desktop/assets/OddlyCleverPDF.ico", Buffer.concat([head, ...pngs]));
writeFileSync("desktop/assets/logo-256.png", pngs.at(-1));
console.log(`icon written: ${SIZES.join(", ")} px`);
