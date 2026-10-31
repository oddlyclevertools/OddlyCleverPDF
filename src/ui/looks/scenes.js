// The live backgrounds, one per look. Each scene is init(w, h, c, rand) -> { draw(g, t, dt, px, py) }:
// w/h are canvas pixels (drawn small and stretched by CSS), c the look's colours, px/py the pointer
// from -1 to 1 for a little parallax. Rules that keep them cheap: pre-draw anything static or
// blurry into sprites once, no shadowBlur or filters per frame, a few dozen things at most.
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (v, min, max) => ((((v - min) % (max - min)) + (max - min)) % (max - min)) + min;

export function rgba(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function layer(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext("2d")];
}
function glow(colour, r, core = 0.2) {
  const [c, g] = layer(r * 2, r * 2);
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, rgba(colour, 1)); gr.addColorStop(core, rgba(colour, 0.5)); gr.addColorStop(1, rgba(colour, 0));
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}
function dots(g, w, h, colour, step) {
  g.fillStyle = colour;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) g.fillRect(x, y, 1.2, 1.2);
}
/** A little sheet of paper: rounded page, folded corner, text lines (one in the accent colour). */
function sheet(pw, ph, ink, accent, paper = "#fffdf8", shadow = "rgba(40,20,30,.18)") {
  const pad = 6;
  const [c, g] = layer(pw + pad * 2 + 4, ph + pad * 2 + 4);
  g.translate(pad, pad);
  g.fillStyle = shadow; g.beginPath(); g.roundRect(3, 4, pw, ph, 3); g.fill();
  const f = Math.min(pw, ph) * 0.22;
  g.fillStyle = paper; g.strokeStyle = ink; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0, 3); g.quadraticCurveTo(0, 0, 3, 0); g.lineTo(pw - f, 0); g.lineTo(pw, f); g.lineTo(pw, ph - 3);
  g.quadraticCurveTo(pw, ph, pw - 3, ph); g.lineTo(3, ph); g.quadraticCurveTo(0, ph, 0, ph - 3); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = rgba(ink, 0.12); g.beginPath(); g.moveTo(pw - f, 0); g.lineTo(pw - f, f); g.lineTo(pw, f); g.closePath(); g.fill(); g.stroke();
  const lh = ph / 9;
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i === 3 ? accent : rgba(ink, 0.18);
    g.fillRect(pw * 0.14, ph * 0.26 + i * lh, pw * (i === 5 ? 0.42 : 0.68), Math.max(1.2, lh * 0.32));
  }
  return c;
}

// ---- Paper Desk: pages drifting over a dotted desk, paper planes gliding past ----
function paperDesk(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  b.fillStyle = c.desk; b.fillRect(0, 0, w, h);
  const gr = b.createRadialGradient(w * 0.8, h * 0.1, 0, w * 0.8, h * 0.1, h);
  gr.addColorStop(0, rgba(c.gold, 0.18)); gr.addColorStop(1, rgba(c.gold, 0));
  b.fillStyle = gr; b.fillRect(0, 0, w, h);
  dots(b, w, h, rgba(c.ink, 0.07), 14);
  const unit = Math.min(w, h);
  const accents = [c.accent, c.gold, c.cyan, c.mint];
  const pages = Array.from({ length: 10 }, (_, i) => {
    const z = 0.45 + rand() * 0.55, pw = unit * 0.13 * z;
    return { s: sheet(pw, pw * 1.3, c.ink, accents[i % 4]), z, x: rand() * w, y: rand() * h, rot: rand() * TAU, vr: (rand() - 0.5) * 0.12, vy: lerp(3, 9, z), ph: rand() * TAU };
  }).sort((a, d) => a.z - d.z);
  const planes = Array.from({ length: 2 }, (_, i) => ({ x: -rand() * w, y: h * (0.25 + i * 0.4), sp: lerp(28, 40, rand()), amp: h * 0.05, ph: rand() * TAU, trail: [] }));
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, 0, 0);
      for (const p of pages) {
        p.y -= p.vy * dt; p.rot += p.vr * dt;
        if (p.y < -60) { p.y = h + 60; p.x = rand() * w; }
        g.save();
        g.translate(p.x + Math.sin(t * 0.3 + p.ph) * 10 * p.z - px * 12 * p.z, p.y - py * 8 * p.z);
        g.rotate(p.rot); g.globalAlpha = 0.22 + 0.4 * p.z;
        g.drawImage(p.s, -p.s.width / 2, -p.s.height / 2);
        g.restore();
      }
      g.lineWidth = 1.4; g.setLineDash([5, 6]); g.strokeStyle = rgba(c.ink, 0.22);
      for (const pl of planes) {
        pl.x += pl.sp * dt;
        const y = pl.y + Math.sin(pl.x / 90 + pl.ph) * pl.amp;
        pl.trail.push([pl.x, y]); if (pl.trail.length > 70) pl.trail.shift();
        if (pl.x > w + 40) { pl.x = -40 - rand() * w * 0.5; pl.trail = []; }
        g.beginPath(); pl.trail.forEach(([x, yy], k) => (k ? g.lineTo(x, yy) : g.moveTo(x, yy))); g.stroke();
        const a = Math.cos(pl.x / 90 + pl.ph) * pl.amp / 90;
        g.save(); g.setLineDash([]); g.translate(pl.x, y); g.rotate(Math.atan(a));
        g.fillStyle = "#ffffff"; g.strokeStyle = c.ink; g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(12, 0); g.lineTo(-10, -7); g.lineTo(-5, 0); g.lineTo(-10, 7); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = c.accent; g.beginPath(); g.moveTo(12, 0); g.lineTo(-5, 0); g.lineTo(-10, 7); g.closePath(); g.fill(); g.stroke();
        g.restore();
      }
      g.setLineDash([]);
    },
  };
}

// ---- Ink Night: ink blooms opening slowly, gold dust rising ----
function inkNight(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  const gr = b.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#1b1324"); gr.addColorStop(1, c.desk);
  b.fillStyle = gr; b.fillRect(0, 0, w, h);
  dots(b, w, h, "rgba(255,240,225,0.05)", 16);
  const unit = Math.min(w, h);
  const inks = [c.accent, c.violet, c.cyan].map((col) => glow(col, unit * 0.35, 0.05));
  const blooms = Array.from({ length: 5 }, (_, i) => ({ s: inks[i % 3], x: rand() * w, y: rand() * h, age: rand() * 18, life: lerp(14, 22, rand()) }));
  const gold = glow(c.gold, 6, 0.3);
  const dust = Array.from({ length: 46 }, () => ({ x: rand() * w, y: rand() * h, v: lerp(4, 14, rand()), s: lerp(0.4, 1.2, rand()), ph: rand() * TAU }));
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, 0, 0);
      g.globalCompositeOperation = "lighter";
      for (const bl of blooms) {
        bl.age += dt;
        if (bl.age > bl.life) { bl.age = 0; bl.x = rand() * w; bl.y = rand() * h; }
        const k = bl.age / bl.life, sz = lerp(0.3, 1.25, Math.sqrt(k)) * bl.s.width;
        g.globalAlpha = Math.sin(k * Math.PI) * 0.22;
        g.drawImage(bl.s, bl.x - sz / 2 - px * 10, bl.y - sz / 2 - py * 8, sz, sz);
      }
      for (const d of dust) {
        d.y -= d.v * dt; if (d.y < -8) { d.y = h + 8; d.x = rand() * w; }
        g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 2 + d.ph);
        const sz = 12 * d.s;
        g.drawImage(gold, d.x + Math.sin(t * 0.6 + d.ph) * 6 - px * 18 * d.s - sz / 2, d.y - py * 12 * d.s - sz / 2, sz, sz);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    },
  };
}

// ---- Blueprint: a drafting grid where boxes, circles and measured lines draw themselves ----
function blueprint(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  b.fillStyle = c.desk; b.fillRect(0, 0, w, h);
  const step = Math.max(12, Math.round(Math.min(w, h) / 34));
  b.lineWidth = 1;
  for (let x = 0; x < w; x += step) { b.strokeStyle = rgba("#bfe3ff", x % (step * 5) ? 0.06 : 0.14); b.beginPath(); b.moveTo(x + 0.5, 0); b.lineTo(x + 0.5, h); b.stroke(); }
  for (let y = 0; y < h; y += step) { b.strokeStyle = rgba("#bfe3ff", y % (step * 5) ? 0.06 : 0.14); b.beginPath(); b.moveTo(0, y + 0.5); b.lineTo(w, y + 0.5); b.stroke(); }
  const snap = (v) => Math.round(v / step) * step;
  const make = () => {
    const kind = ["rect", "circle", "dim", "page"][Math.floor(rand() * 4)];
    const x = snap(rand() * w * 0.85), y = snap(rand() * h * 0.85), s = snap(lerp(4, 10, rand()) * step);
    return { kind, x, y, s, p: 0, hold: 0, fade: 1, speed: lerp(0.18, 0.32, rand()) };
  };
  const shapes = Array.from({ length: 4 }, () => { const s = make(); s.p = rand(); return s; });
  const pen = glow("#ffffff", 8, 0.2);
  const drawShape = (g, s) => {
    const p = Math.min(1, s.p);
    g.strokeStyle = rgba("#dff1ff", 0.75 * s.fade); g.lineWidth = 1.5; g.beginPath();
    let tip = [s.x, s.y];
    if (s.kind === "rect" || s.kind === "page") {
      const W = s.s * (s.kind === "page" ? 0.75 : 1.3), H = s.s;
      const pts = [[s.x, s.y], [s.x + W, s.y], [s.x + W, s.y + H], [s.x, s.y + H], [s.x, s.y]];
      const per = 2 * (W + H); let left = per * p;
      g.moveTo(...pts[0]);
      for (let i = 1; i < 5 && left > 0; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), f = Math.min(1, left / L);
        tip = [lerp(ax, bx, f), lerp(ay, by, f)]; g.lineTo(...tip); left -= L;
      }
      g.stroke();
      if (s.kind === "page" && p > 0.99) {
        g.strokeStyle = rgba(c.accent, 0.7 * s.fade);
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(s.x + W * 0.15, s.y + H * (0.25 + i * 0.15)); g.lineTo(s.x + W * (i === 3 ? 0.5 : 0.85), s.y + H * (0.25 + i * 0.15)); g.stroke(); }
      }
    } else if (s.kind === "circle") {
      const r = s.s / 2, a = -Math.PI / 2 + TAU * p;
      g.arc(s.x + r, s.y + r, r, -Math.PI / 2, a); g.stroke();
      tip = [s.x + r + Math.cos(a) * r, s.y + r + Math.sin(a) * r];
      if (p > 0.99) { g.strokeStyle = rgba(c.accent, 0.6 * s.fade); g.beginPath(); g.moveTo(s.x + r - 5, s.y + r); g.lineTo(s.x + r + 5, s.y + r); g.moveTo(s.x + r, s.y + r - 5); g.lineTo(s.x + r, s.y + r + 5); g.stroke(); }
    } else {
      const L = s.s * 1.6; tip = [s.x + L * p, s.y];
      g.moveTo(s.x, s.y); g.lineTo(...tip);
      g.moveTo(s.x, s.y - 5); g.lineTo(s.x, s.y + 5); g.stroke();
      if (p > 0.99) { g.beginPath(); g.moveTo(s.x + L, s.y - 5); g.lineTo(s.x + L, s.y + 5); g.stroke(); g.fillStyle = rgba(c.accent, 0.8 * s.fade); g.font = `${Math.round(step * 0.8)}px monospace`; g.fillText(`${Math.round(s.s / step) * 10} mm`, s.x + L / 2 - step, s.y - 6); }
    }
    return tip;
  };
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, -px * 6 - 6, -py * 6 - 6, w + 12, h + 12);
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (s.p < 1) s.p += s.speed * dt; else if (s.hold < 3) s.hold += dt; else { s.fade -= dt * 0.5; if (s.fade <= 0) shapes[i] = make(); }
        const tip = drawShape(g, s);
        if (s.p < 1) { g.globalCompositeOperation = "lighter"; g.drawImage(pen, tip[0] - 8, tip[1] - 8); g.globalCompositeOperation = "source-over"; }
      }
    },
  };
}

// ---- Neon Marker: faint lines of a page, and neon highlighter strokes sweeping across them ----
function neonMarker(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  b.fillStyle = c.desk; b.fillRect(0, 0, w, h);
  const lh = Math.max(14, Math.round(h / 26));
  const rows = [];
  for (let y = lh; y < h - lh / 2; y += lh) {
    let x = lh * (0.5 + rand() * 2);
    while (x < w - lh) {
      const len = lh * lerp(1.5, 6, rand());
      b.fillStyle = "rgba(255,255,255,0.06)"; b.beginPath(); b.roundRect(x, y - lh * 0.16, Math.min(len, w - x), lh * 0.32, 2); b.fill();
      rows.push({ x, y, len: Math.min(len, w - x) }); x += len + lh * lerp(0.4, 1.2, rand());
    }
  }
  const cols = ["#c6ff3d", "#ff3df0", "#3df7ff", "#ffe53d"];
  const tips = cols.map((col) => glow(col, lh, 0.2));
  const make = () => { const r = rows[Math.floor(rand() * rows.length)], k = Math.floor(rand() * 4); return { r, k, p: 0, hold: 0, a: 1, speed: lerp(0.5, 1.1, rand()) }; };
  const marks = Array.from({ length: 6 }, () => { const m = make(); m.p = rand(); return m; });
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, 0, 0);
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        if (m.p < 1) m.p = Math.min(1, m.p + m.speed * dt); else if (m.hold < 2.5) m.hold += dt; else { m.a -= dt * 0.6; if (m.a <= 0) marks[i] = make(); }
        const ww = m.r.len * m.p, x = m.r.x - px * 8, y = m.r.y - py * 6;
        g.globalAlpha = 0.5 * m.a; g.fillStyle = cols[m.k];
        g.beginPath(); g.roundRect(x - 3, y - lh * 0.34, ww + 6, lh * 0.68, lh * 0.2); g.fill();
        if (m.p < 1) { g.globalAlpha = 0.9 * m.a; g.drawImage(tips[m.k], x + ww - lh, y - lh); }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    },
  };
}

// ---- Sunset Stack: a peach sky, a low sun, and pages rising like lanterns ----
function sunsetStack(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  const gr = b.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#c7b4ff"); gr.addColorStop(0.45, "#ffb8c6"); gr.addColorStop(1, c.desk);
  b.fillStyle = gr; b.fillRect(0, 0, w, h);
  const sun = b.createRadialGradient(w * 0.22, h * 0.92, 0, w * 0.22, h * 0.92, Math.min(w, h) * 0.7);
  sun.addColorStop(0, "rgba(255,240,200,0.95)"); sun.addColorStop(0.18, "rgba(255,200,120,0.6)"); sun.addColorStop(1, "rgba(255,200,120,0)");
  b.fillStyle = sun; b.fillRect(0, 0, w, h);
  b.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 4; i++) { const y = h * (0.15 + i * 0.12), x = rand() * w; b.beginPath(); b.ellipse(x, y, w * 0.18, h * 0.018, 0, 0, TAU); b.fill(); }
  const unit = Math.min(w, h);
  const accents = [c.accent, "#8a5cff", "#ffb020", "#ff3d8b"];
  const lanterns = Array.from({ length: 12 }, (_, i) => {
    const z = 0.35 + rand() * 0.65, pw = unit * 0.11 * z;
    return { s: sheet(pw, pw * 1.28, "#2b1620", accents[i % 4], "#fffaf4", "rgba(120,40,40,.16)"), halo: glow("#fff1d6", pw, 0.3), z, x: rand() * w, y: rand() * h, vy: lerp(5, 13, z), ph: rand() * TAU };
  }).sort((a, d) => a.z - d.z);
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, 0, 0);
      for (const l of lanterns) {
        l.y -= l.vy * dt; if (l.y < -80) { l.y = h + 80; l.x = rand() * w; }
        const x = l.x + Math.sin(t * 0.4 + l.ph) * 12 * l.z - px * 16 * l.z, y = l.y - py * 10 * l.z;
        g.globalAlpha = 0.35 * l.z; g.drawImage(l.halo, x - l.halo.width / 2, y - l.halo.height / 2);
        g.globalAlpha = 0.3 + 0.45 * l.z;
        g.save(); g.translate(x, y); g.rotate(Math.sin(t * 0.5 + l.ph) * 0.12); g.drawImage(l.s, -l.s.width / 2, -l.s.height / 2); g.restore();
      }
      g.globalAlpha = 1;
    },
  };
}

// ---- Mint Origami: paper boats bobbing on waves, folded triangles drifting above ----
function mintOrigami(w, h, c, rand) {
  const [bg, b] = layer(w, h);
  const gr = b.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#effcf6"); gr.addColorStop(1, c.desk);
  b.fillStyle = gr; b.fillRect(0, 0, w, h);
  dots(b, w, h, "rgba(15,42,36,0.06)", 15);
  const boat = (sz, sail) => {
    const [cv, g] = layer(sz * 2.4, sz * 2);
    g.translate(sz * 1.2, sz * 1.3); g.lineJoin = "round"; g.strokeStyle = "#0f2a24"; g.lineWidth = 1.3;
    g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(-sz, 0); g.lineTo(sz, 0); g.lineTo(sz * 0.65, sz * 0.5); g.lineTo(-sz * 0.65, sz * 0.5); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = sail; g.beginPath(); g.moveTo(-sz * 0.15, 0); g.lineTo(-sz * 0.15, -sz * 1.1); g.lineTo(sz * 0.7, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#e7f6ef"; g.beginPath(); g.moveTo(-sz * 0.15, 0); g.lineTo(-sz * 0.15, -sz * 0.8); g.lineTo(-sz * 0.75, 0); g.closePath(); g.fill(); g.stroke();
    return cv;
  };
  const unit = Math.min(w, h);
  const sails = [c.accent, "#ff7aa9", "#ffc83d", "#5fd3ff"];
  const waves = [0.72, 0.82, 0.92].map((f, i) => ({ y: h * f, amp: unit * (0.012 + i * 0.006), len: w / (2.5 + i), sp: 0.25 + i * 0.12, col: rgba(c.accent, 0.12 + i * 0.07) }));
  const boats = Array.from({ length: 5 }, (_, i) => { const wv = waves[i % 3]; const sz = unit * 0.04 * (0.7 + (i % 3) * 0.25); return { s: boat(sz, sails[i % 4]), wv, x: rand() * w, v: lerp(6, 14, rand()), sz }; });
  const folds = Array.from({ length: 14 }, (_, i) => ({ x: rand() * w, y: rand() * h * 0.6, s: unit * lerp(0.012, 0.03, rand()), rot: rand() * TAU, vr: (rand() - 0.5) * 0.6, vx: lerp(4, 10, rand()), col: [c.accent, "#ffffff", "#ff9ec4", "#ffd166"][i % 4] }));
  const waveY = (wv, x, t) => wv.y + Math.sin(x / wv.len * TAU + t * wv.sp * TAU) * wv.amp;
  return {
    draw(g, t, dt, px, py) {
      g.drawImage(bg, 0, 0);
      for (const f of folds) {
        f.x += f.vx * dt; f.rot += f.vr * dt; if (f.x > w + 20) { f.x = -20; f.y = rand() * h * 0.6; }
        g.save(); g.translate(f.x - px * 10, f.y + Math.sin(t + f.x / 80) * 6 - py * 6); g.rotate(f.rot);
        g.fillStyle = f.col; g.strokeStyle = "rgba(15,42,36,0.5)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, -f.s); g.lineTo(f.s, f.s * 0.7); g.lineTo(-f.s, f.s * 0.7); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = "rgba(15,42,36,0.12)"; g.beginPath(); g.moveTo(0, -f.s); g.lineTo(0, f.s * 0.7); g.lineTo(-f.s, f.s * 0.7); g.closePath(); g.fill();
        g.restore();
      }
      for (const [i, wv] of waves.entries()) {
        for (const bt of boats.filter((x) => x.wv === wv)) {
          bt.x += bt.v * dt; if (bt.x > w + 40) bt.x = -40;
          const y = waveY(wv, bt.x, t), y2 = waveY(wv, bt.x + 4, t);
          g.save(); g.translate(bt.x, y - bt.sz * 0.35); g.rotate(Math.atan2(y2 - y, 4));
          g.drawImage(bt.s, -bt.s.width / 2, -bt.sz * 1.3); g.restore();
        }
        g.fillStyle = wv.col; g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, waveY(wv, x, t));
        g.lineTo(w, h); g.closePath(); g.fill();
        if (i === 2) { g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1.5; g.beginPath(); for (let x = 0; x <= w + 8; x += 8) x ? g.lineTo(x, waveY(wv, x, t)) : g.moveTo(x, waveY(wv, x, t)); g.stroke(); }
      }
    },
  };
}

export const SCENES = { paperDesk, inkNight, blueprint, neonMarker, sunsetStack, mintOrigami };
