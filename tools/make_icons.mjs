// Render the app icon (public/favicon.svg on a paper tile) to PNGs for the installed app.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const svg = readFileSync("public/favicon.svg", "utf8");
const b = await chromium.launch({ channel: "chrome" });
for (const [size, name, pad] of [[192, "icon-192", 0.1], [512, "icon-512", 0.1], [512, "icon-maskable", 0.22]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - pad * 2));
  await p.setContent(`<body style="margin:0;background:#fff4e3;display:grid;place-items:center;height:100vh"><div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await p.screenshot({ path: `public/brand/${name}.png` });
  await p.close();
}
await b.close();
console.log("icons written");
