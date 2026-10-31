// The drawing pad: a smooth pen. Pen pressure sets the width when the device reports it; for a
// finger or mouse, the width follows the speed (slow = thicker), like an ink pen.
import { el } from "../../ui/kit.js";
import { trimCanvas } from "./sigimg.js";

const W = 1200, H = 500; // drawing space; the canvas is shown smaller by CSS

export function makePad({ color = "#111111", onInk } = {}) {
  const canvas = el("canvas.fs-pad-canvas", { width: W, height: H, "aria-label": "Draw your signature here" });
  const hint = el("span.fs-pad-hint", {}, "Sign here with your finger, pen or mouse");
  const node = el("div.fs-pad", {}, canvas, hint);
  const g = canvas.getContext("2d");
  let strokes = [], cur = null, ink = color;

  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, t: e.timeStamp, p: e.pressure };
  };
  function segment(a, b, c, width) {
    // a quadratic curve through the midpoints keeps corners smooth
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    g.lineWidth = width;
    g.beginPath(); g.moveTo(m1.x, m1.y); g.quadraticCurveTo(b.x, b.y, m2.x, m2.y); g.stroke();
  }
  function setup() { g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = ink; g.fillStyle = ink; }
  function dot(p) { g.beginPath(); g.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2); g.fill(); }
  function redraw() {
    g.clearRect(0, 0, W, H); setup();
    for (const s of strokes) {
      if (s.length === 1) { dot(s[0]); continue; }
      for (let i = 1; i < s.length - 1; i++) segment(s[i - 1], s[i], s[i + 1], s[i].w);
      const last = s.at(-1), prev = s.at(-2);
      segment(prev, last, last, last.w);
    }
    hint.hidden = strokes.length > 0;
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not a real pointer (tests) */ }
    const p = at(e);
    cur = [{ ...p, w: 8 }];
    strokes.push(cur);
    hint.hidden = true;
    setup(); dot(cur[0]);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!cur) return;
    for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
      const p = at(ev), prev = cur.at(-1);
      const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (dist < 2.5) continue;
      const pen = ev.pointerType === "pen" && ev.pressure > 0;
      const speed = dist / Math.max(1, p.t - prev.t); // drawing px per ms
      const target = pen ? 4 + 13 * ev.pressure : Math.max(7, Math.min(17, 17 - speed * 5));
      p.w = prev.w * 0.7 + target * 0.3;
      cur.push(p);
      if (cur.length >= 3) { setup(); segment(cur.at(-3), cur.at(-2), cur.at(-1), cur.at(-2).w); }
    }
  });
  const up = () => { if (cur) { cur = null; redraw(); onInk?.(); } };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.style.touchAction = "none";

  return {
    node,
    isEmpty: () => strokes.length === 0,
    clear() { strokes = []; redraw(); onInk?.(); },
    setColor(c) { ink = c; redraw(); },
    /** The drawing as a trimmed transparent canvas. */
    result: () => trimCanvas(canvas),
    // for tests: draw a stroke from points in 0..1 space
    _stroke(points) {
      const s = points.map(([x, y], i) => ({ x: x * W, y: y * H, t: i * 8, w: 8 + (i % 5) }));
      strokes.push(s); redraw(); onInk?.();
    },
  };
}
