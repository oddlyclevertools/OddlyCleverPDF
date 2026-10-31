const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
app.fs.getSignature("signature", { forceSheet: true });
await sleep(500);
const c = document.querySelector(".fs-pad-canvas");
const r = c.getBoundingClientRect();
const ev = (t, x, y, ts) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 2, pointerType: "touch", clientX: r.left + r.width * x, clientY: r.top + r.height * y, pressure: 0.5, isPrimary: true }));
const pts = [];
for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([0.1 + t * 0.8, 0.55 + 0.25 * Math.sin(t * 14) * (1 - t * 0.5) - 0.2 * t]); }
ev("pointerdown", ...pts[0]);
for (const p of pts) { ev("pointermove", ...p); await sleep(8); }
ev("pointerup", ...pts.at(-1));
await sleep(400);
return { drawn: !document.querySelector(".fs-use").disabled, modalW: Math.round(document.querySelector(".modal").getBoundingClientRect().width) };
