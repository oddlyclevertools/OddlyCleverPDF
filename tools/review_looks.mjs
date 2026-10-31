// Every look on the home screen and in the editor -> tools/_review/looks_sheet.png
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
const port = process.argv[2] || "5185";
const looks = ["paper-desk", "ink-night", "blueprint", "neon-marker", "sunset-stack", "mint-origami"];
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
for (const id of looks) {
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.evaluate((id) => localStorage.setItem("ocpdf.look", JSON.stringify(id)), id);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `tools/_review/look-${id}-home.png` });
  await p.evaluate(async () => { const r = await fetch("/tests/fixtures/sample.pdf"); await window.ocpdf.open([new File([await r.arrayBuffer()], "sample.pdf", { type: "application/pdf" })]); window.ocpdf.viewer.setZoom(0.7); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `tools/_review/look-${id}-editor.png` });
}
await b.close();
execFileSync("python", ["-c", `
from PIL import Image
ids=${JSON.stringify(looks)}
W=420;H=262
s=Image.new('RGB',(W*4+30,H*3+20),'white')
for i,id in enumerate(ids):
  for j,k in enumerate(['home','editor']):
    im=Image.open(f'tools/_review/look-{id}-{k}.png').resize((W,H))
    n=i*2+j; s.paste(im,((n%4)*(W+10),(n//4)*(H+10)))
s.save('tools/_review/looks_sheet.png')
`]);
console.log("errors:", errs.length ? errs : "none");
