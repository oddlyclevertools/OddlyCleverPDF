// Runs the live background behind the app. Kept cheap the same way as Clearpane's start page:
// - drawn at a reduced resolution and stretched by CSS;
// - 24 fps from a timer that asks for one animation frame per drawing (a bare rAF loop keeps
//   the page compositing at 60 Hz, which costs more than the drawing);
// - 8 fps after a minute without input, nothing while the tab is hidden;
// - one still frame in calm mode, with reduced motion, and behind the pages unless asked.
import { SCENES } from "./scenes.js";

const FPS = 24, IDLE_FPS = 8, IDLE_MS = 60e3;

function rng(seed) { // mulberry32: the still frame looks the same every time
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The look's colours, read from the CSS variables it just set. */
export function colours() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  return { desk: v("--desk", "#fff4e3"), ink: v("--ink", "#16121b"), accent: v("--accent", "#ff2e7e"), gold: v("--gold", "#ffc83d"),
    cyan: v("--cyan", "#5fd3ff"), mint: v("--mint", "#3ddc97"), violet: v("--violet", "#9b7bff"), text: v("--text", "#16121b") };
}

/** Make a scene and draw one frame of it into a canvas of any size (the picker's previews). */
export function stillFrame(canvas, sceneId, c, { t = 6 } = {}) {
  const g = canvas.getContext("2d");
  const s = SCENES[sceneId](canvas.width, canvas.height, c, rng(7));
  for (let i = 0; i < 6; i++) s.draw(g, t + i / 6, 1 / 6, 0, 0); // settle the moving parts
}

export function createBackdrop(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);
  const g = canvas.getContext("2d", { alpha: false });
  let scene = null, sceneId = "", still = false, timer = 0, raf = 0, last = 0, t0 = performance.now(), lastInput = Date.now();
  let px = 0, py = 0, tx = 0, ty = 0;

  const size = () => {
    const k = Math.min(0.6, 1100 / Math.max(innerWidth, innerHeight)) * Math.min(2, devicePixelRatio || 1);
    return [Math.max(160, Math.round(innerWidth * k)), Math.max(160, Math.round(innerHeight * k))];
  };
  const build = () => {
    const [w, h] = size();
    canvas.width = w; canvas.height = h;
    scene = SCENES[sceneId]?.(w, h, colours(), rng(7)) || null;
    last = 0;
    frame(performance.now(), true);
  };
  const frame = (now, force) => {
    raf = 0;
    if (!scene) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / FPS;
    last = now;
    px += (tx - px) * 0.08; py += (ty - py) * 0.08;
    if (still && force) { for (let i = 0; i < 6; i++) scene.draw(g, 6 + i / 6, 1 / 6, 0, 0); return; }
    scene.draw(g, (now - t0) / 1000, dt, px, py);
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (still || document.hidden || !scene) return;
    const fps = Date.now() - lastInput > IDLE_MS ? IDLE_FPS : FPS;
    timer = setTimeout(() => { raf = requestAnimationFrame(frame); }, 1000 / fps);
  };
  const wake = () => { const was = Date.now() - lastInput > IDLE_MS; lastInput = Date.now(); if (was) schedule(); };

  addEventListener("pointermove", (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; wake(); }, { passive: true });
  addEventListener("keydown", wake);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { last = 0; schedule(); } });
  let rt = 0;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 200); });

  return {
    /** Show a scene; `isStill` draws one frame and stops. */
    set(id, isStill) {
      const changed = id !== sceneId;
      sceneId = id; still = !!isStill;
      cancelAnimationFrame(raf); clearTimeout(timer);
      if (changed || !scene) build(); else { last = 0; if (still) frame(performance.now(), true); else schedule(); }
    },
    rebuild: build,
  };
}
