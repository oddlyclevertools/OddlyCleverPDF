// Home-screen infographics: the numbers, how it works, the format wheel and the honest comparison.
// Everything is drawn here in SVG/CSS (our own art). Animations start when a block scrolls into
// view, run a few times, and stay still in calm mode or with reduced motion.
import "./showcase.css";
import { el, icon } from "../../ui/kit.js";

const SVGNS = "http://www.w3.org/2000/svg";
const svg = (markup, vb, cls = "") => {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", vb); s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = markup; // our own fixed markup, no user data
  return s;
};

/** Add .sc-play when the block is on screen (once), and run onShow the first time. */
function whenSeen(node, onShow) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { node.classList.add("sc-play"); onShow?.(); io.disconnect(); }
  }, { threshold: 0.25 });
  io.observe(node);
  return node;
}
const calm = () => document.documentElement.dataset.calm === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- 1. the numbers -------------------------------------------------------------------------

function stats(app) {
  const items = [
    { n: 0, from: 100, label: "uploads", sub: "Your files stay on your device", icon: "CloudOff", c: "mint" },
    { n: "∞", label: "free uses", sub: "No limits. No watermark.", icon: "Infinity", c: "gold" },
    { n: app.exporters().length || 16, label: "formats", sub: "Word, Excel, slides, pictures…", icon: "ArrowUpRight", c: "pink" },
  ];
  const nums = [];
  const box = el("section.sc-stats", { "aria-label": "OddlyClever PDF in numbers" }, items.map((it, i) => {
    const num = el("b.sc-num", {}, typeof it.n === "number" ? String(it.from ?? 0) : it.n);
    if (typeof it.n === "number") nums.push({ num, from: it.from ?? 0, to: it.n });
    return el("div.sc-stat", { dataset: { c: it.c }, style: { "--i": String(i) } }, el("span.sc-stat-icon", {}, icon(it.icon, 20)), num, el("strong", {}, it.label), el("small", {}, it.sub));
  }));
  return whenSeen(box, () => {
    if (calm()) { for (const x of nums) x.num.textContent = String(x.to); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1400), e = 1 - (1 - k) ** 3;
      for (const x of nums) x.num.textContent = String(Math.round(x.from + (x.to - x.from) * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---- 2. how it works -------------------------------------------------------------------------

const STEP_ART = [
  // drop: a page falls into a phone
  `<rect x="58" y="34" width="84" height="132" rx="14" fill="var(--card)" stroke="var(--edge)" stroke-width="4"/>
   <rect x="70" y="52" width="60" height="92" rx="6" fill="var(--accent-soft)"/>
   <circle cx="100" cy="155" r="4" fill="var(--edge)"/>
   <g class="sc-fall"><path d="M78 4h36l14 14v44H78z" fill="#fff" stroke="#16121b" stroke-width="3.5" stroke-linejoin="round"/><path d="M114 4v14h14" fill="#ffd166" stroke="#16121b" stroke-width="3.5" stroke-linejoin="round"/>
   <path d="M86 32h30M86 42h30M86 52h18" stroke="#ff2e7e" stroke-width="3.5" stroke-linecap="round"/></g>`,
  // edit: a pen writing on a page, with a shield (stays on your device)
  `<path d="M40 30h80l24 24v110H40z" fill="#fff" stroke="#16121b" stroke-width="4" stroke-linejoin="round"/><path d="M120 30v24h24" fill="#ffd166" stroke="#16121b" stroke-width="4" stroke-linejoin="round"/>
   <path class="sc-write" d="M56 78q10-10 20 0t20 0 20 0" fill="none" stroke="#1f4fd8" stroke-width="4" stroke-linecap="round"/>
   <rect x="54" y="100" width="70" height="9" rx="4" fill="#ffd60a" opacity=".8"/><path d="M56 128h64M56 144h40" stroke="#c9c2cc" stroke-width="5" stroke-linecap="round"/>
   <g class="sc-pen"><path d="M126 64l26-26 12 12-26 26-16 4z" fill="#ff2e7e" stroke="#16121b" stroke-width="3.5" stroke-linejoin="round"/></g>
   <g class="sc-shield"><path d="M150 112l22 8v18c0 14-10 22-22 26-12-4-22-12-22-26v-18z" fill="#3ddc97" stroke="#16121b" stroke-width="3.5" stroke-linejoin="round"/><path d="M141 137l7 7 12-14" fill="none" stroke="#16121b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  // save: a page drops into a download tray, sparkles
  `<path d="M36 120h128v32a10 10 0 0 1-10 10H46a10 10 0 0 1-10-10z" fill="var(--card)" stroke="var(--edge)" stroke-width="4"/>
   <path d="M36 120l18-26h92l18 26" fill="none" stroke="var(--edge)" stroke-width="4" stroke-linejoin="round"/>
   <g class="sc-save"><path d="M80 20h40v48h16l-36 36-36-36h16z" fill="#ff2e7e" stroke="#16121b" stroke-width="3.5" stroke-linejoin="round"/></g>
   <g class="sc-spark" fill="#ffc83d" stroke="#16121b" stroke-width="2.5"><path d="M30 40l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/><path d="M168 54l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></g>`,
];

function howItWorks() {
  const steps = [
    ["Drop any file", "A PDF, a photo, a Word file, a spreadsheet. Or scan paper with your camera."],
    ["Edit right here", "Change words, sign, fill, highlight, convert. Your file never leaves your device."],
    ["Save or share", "Download it or send it from your phone. No watermark, ever."],
  ];
  const path = svg(`<path class="sc-route" d="M10 40 C 180 -10, 300 90, 480 40 S 820 -10, 990 40" fill="none" stroke="var(--edge)" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>`, "0 0 1000 80", "sc-route-svg");
  const plane = el("div.sc-plane", { "aria-hidden": "true" }, svg(`<path d="M2 22 46 4 36 42 26 30z" fill="#fff" stroke="#16121b" stroke-width="3" stroke-linejoin="round"/><path d="M46 4 26 30v10l-4-10" fill="#ff2e7e" stroke="#16121b" stroke-width="3" stroke-linejoin="round"/>`, "0 0 48 46"));
  const box = el("section.sc-how", {},
    el("h2.sc-title", {}, "How it works"),
    el("div.sc-route-wrap", {}, path, plane),
    el("div.sc-steps", {}, steps.map(([t, d], i) => el("div.sc-step", { style: { "--i": String(i) } },
      el("span.sc-step-no", {}, String(i + 1)), svg(STEP_ART[i], "0 0 200 180", "sc-art"), el("strong", {}, t), el("p", {}, d)))));
  return whenSeen(box);
}

// ---- 3. the format wheel ---------------------------------------------------------------------

const WHEEL = [
  ["cv-docx", "Word", "DOCX", "#2b6cff"], ["cv-xlsx", "Excel", "XLSX", "#11a35b"], ["cv-pptx", "PowerPoint", "PPTX", "#ff6a3d"],
  ["cv-png", "Pictures", "PNG", "#9b7bff"], ["cv-jpg", "Photos", "JPG", "#ff2e7e"], ["cv-txt", "Text", "TXT", "#6a5f6e"],
  ["cv-md", "Markdown", "MD", "#16121b"], ["cv-html", "Web page", "HTML", "#ff9a3c"], ["cv-epub", "E-book", "EPUB", "#3ddc97"],
  ["cv-csv", "Table", "CSV", "#0aa884"], ["cv-odt", "OpenDocument", "ODT", "#4cc9ff"], ["cv-rtf", "Rich text", "RTF", "#c03fd8"],
];

async function convertTo(app, id) {
  const ex = app.exporters().find((x) => x.id === id);
  if (!ex) { app.toast("That converter isn't ready yet."); return; }
  if (!app.state.pages.length) {
    const files = await app.chooseFiles({ multiple: false, accept: ".pdf,application/pdf" });
    if (!files.length || !(await app.open(files))) return;
  }
  const b = app.busy(`Making ${ex.label}`);
  try {
    const out = await ex.run(app, { progress: (f, l) => b.set(f, l), signal: b.signal });
    for (const r of [].concat(out)) await app.deliver(r.blob, r.filename);
    b.done(`Saved as ${ex.label}`);
  } catch (e) { b.fail(e); }
}

function formatWheel(app) {
  const R = 41; // % of the square
  const spokes = WHEEL.map((_, i) => {
    const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
    const x = 50 + Math.cos(a) * R, y = 50 + Math.sin(a) * R;
    return `<line class="sc-spoke" style="--i:${i}" x1="50" y1="50" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
  }).join("");
  const ring = svg(`<circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width=".5" stroke-dasharray="1 2"/>${spokes}`, "0 0 100 100", "sc-wheel-svg");
  const badges = WHEEL.map(([id, name, ext, col], i) => {
    const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
    return el("button.sc-badge", { type: "button", title: `Convert a PDF to ${name}`, style: { left: `${50 + Math.cos(a) * R}%`, top: `${50 + Math.sin(a) * R}%`, "--c": col, "--i": String(i) },
      on: { click: () => convertTo(app, id) } }, el("b", {}, ext), el("small", {}, name));
  });
  const hub = el("div.sc-hub", {}, el("b", {}, "PDF"), el("small", {}, "your file"));
  const box = el("section.sc-wheel-sec", {},
    el("div.sc-wheel-words", {},
      el("h2.sc-title", {}, "Turn a PDF into almost anything"),
      el("p", {}, "Tap a format to convert a PDF to it. Your edits come along, tables land in real cells, and headings stay headings."),
      el("p.sc-back", {}, icon("Repeat", 18), "It works the other way too: drop Word, Excel, PowerPoint, Markdown, text or photos and get a PDF."),
      el("button.btn.primary", { type: "button", on: { click: () => app.runTask("anything-to-pdf") } }, icon("FilePlus2", 18), "Make a PDF from anything")),
    el("div.sc-wheel", {}, ring, hub, ...badges));
  return whenSeen(box);
}

// ---- 4. the honest comparison ----------------------------------------------------------------

function comparison() {
  const rows = [
    ["Uploads your file to a server", "Usually", "Never"],
    ["Watermark or paywall when you download", "Often", "Never"],
    ["Limit on free tasks per day", "Often 1–3", "None"],
    ["Account needed", "Often", "No"],
    ["AI help", "Paid extra", "Free, bring any AI"],
    ["Works offline and on phones", "Rarely", "Yes"],
  ];
  const col = (title, cls, k, mark) => el(`div.sc-receipt.${cls}`, {},
    el("h3", {}, title),
    el("ul", {}, rows.map((r, i) => el("li", { style: { "--i": String(i) } }, el("span", {}, r[0]), el("b", {}, mark(i), r[k])))));
  const theirs = col("A typical free PDF site", "sc-them", 1, () => icon("X", 15));
  const ours = col("OddlyClever PDF", "sc-us", 2, () => icon("Check", 15));
  ours.append(el("div.sc-stamp", { "aria-hidden": "true" }, "FREE", el("small", {}, "for real")));
  const box = el("section.sc-compare", {},
    el("h2.sc-title", {}, "Why I made it"),
    el("p.sc-lead", {}, "Most free PDF sites are free until the moment you press download. This one isn't."),
    el("div.sc-receipts", {}, theirs, ours));
  return whenSeen(box);
}

export function install(app) {
  app.registerHomeSection({ id: "stats", order: 65, render: () => stats(app) });
  app.registerHomeSection({ id: "how", order: 60, render: () => howItWorks() });
  app.registerHomeSection({ id: "wheel", order: 70, render: () => formatWheel(app) });
  app.registerHomeSection({ id: "compare", order: 80, render: () => comparison() });
}
