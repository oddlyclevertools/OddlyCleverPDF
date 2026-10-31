// Scan to PDF with a fake camera: draw a "photo" of a page on a table, add it twice, fix, make the PDF.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const photo = (angle) => {
  const c = document.createElement("canvas"); c.width = 1600; c.height = 1200;
  const g = c.getContext("2d");
  g.fillStyle = "#3b2a1e"; g.fillRect(0, 0, 1600, 1200);
  g.save(); g.translate(800, 600); g.rotate(angle);
  g.fillStyle = "#f4f1ea"; g.fillRect(-380, -520, 760, 1040);
  g.fillStyle = "#222"; g.font = "bold 54px sans-serif"; g.fillText("Receipt #" + Math.round(angle * 100), -320, -420);
  for (let i = 0; i < 14; i++) g.fillRect(-320, -330 + i * 52, 520 - (i % 4) * 90, 14);
  g.restore();
  // a soft shadow across the page, like real life
  const sh = g.createLinearGradient(0, 0, 1600, 0); sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.25)");
  g.fillStyle = sh; g.fillRect(500, 0, 1100, 1200);
  return c;
};
const out = {};
const api = app.fs.scan.open({ camera: false });
await sleep(400);
out.noCameraMsg = document.querySelector(".fs-cam-msg")?.textContent.slice(0, 50);
const a = api.addShot(photo(0.08)), b = api.addShot(photo(-0.05));
out.quadA = a.quad.map((p) => p.map(Math.round));
out.outA = [a.out.width, a.out.height];
api.setBw(true);
api.showReview();
await sleep(300);
document.querySelector(".fs-bwrow input").click(); // all black & white
await sleep(1500);
out.bw = api.shots().map((s) => s.bw);
// reorder + delete
api.move(0, 1);
out.order = api.shots().map((s) => s.id === a.id ? "A" : "B").join("");
if (window.__phoneShot) await window.__phoneShot();
const bytes = await api.makePdf();
await sleep(1200);
out.pdfBytes = bytes?.length;
out.pagesNow = app.state.pages.length;
out.size = app.state.pages.map((p) => [Math.round(p.w), Math.round(p.h)]);
out.view = app.view;
return out;
