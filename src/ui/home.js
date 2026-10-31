// The home screen: "What do you want to do?" One big drop zone, the task cards (features add
// theirs with registerTask), "Continue where you left off", and the privacy promise.
import { el, icon } from "./kit.js";
import { stagger } from "./motion.js";

const tasks = new Map();
export const GROUPS = [
  ["popular", "Most used"],
  ["edit", "Edit & sign"],
  ["pages", "Pages"],
  ["convert", "Convert"],
  ["secure", "Protect"],
  ["ai", "AI helper"],
];

/**
 * A job on the home screen and in the Ctrl+K palette.
 * @param {{ id, title, blurb, icon, color?: string, group?: string, popular?: boolean, order?: number,
 *   files?: "none"|"one"|"many", accept?: string, run: (app, files?: File[]) => any }} t
 *   files: "one"/"many" asks for files first (unless a document is open and `usesOpenDoc`).
 */
export function registerTask(t) { tasks.set(t.id, { order: 50, group: "edit", files: "one", color: "pink", ...t }); renderTasks(); }
export const taskList = () => [...tasks.values()].sort((a, b) => a.order - b.order);

let host, app, grid, resumeBox, beforeTasks, afterTasks;
const sections = [];
/**
 * A section on the home screen (infographics, news…). order < 50 sits above the task cards,
 * 50 and up below them. render(app) returns a node.
 */
export function registerHomeSection(sec) { sections.push({ order: 60, ...sec }); sections.sort((a, b) => a.order - b.order); renderSections(); }
function renderSections() {
  if (!beforeTasks) return;
  beforeTasks.replaceChildren(); afterTasks.replaceChildren();
  for (const s of sections) {
    try { const n = s.render(app); if (n) (s.order < 50 ? beforeTasks : afterTasks).append(n); } catch (e) { console.error(`[home] ${s.id}`, e); }
  }
}

export function mountHome(node, theApp) {
  host = node; app = theApp;
  const drop = el("button.drop", { type: "button", "aria-label": "Choose files to open", on: { click: () => app.pickFiles() } },
    el("div.drop-art", { "aria-hidden": "true" },
      el("i.sheet-fly.s1"), el("i.sheet-fly.s2"), el("i.sheet-fly.s3"),
      el("img.sparks", { src: `${import.meta.env.BASE_URL}brand/sparks.png`, alt: "", width: 150, height: 186 })),
    el("div.drop-words", {},
      el("strong", {}, "Drop a file here"),
      el("span", {}, "or tap to choose. PDFs, pictures, Word, Excel, PowerPoint, text…"),
      el("span.drop-cta", {}, icon("FolderOpen", 18), "Open a file")));
  resumeBox = el("div.resume");
  grid = el("div.tasks");
  host.append(
    el("section.hero", {},
      el("div.hero-words", {},
        el("p.kicker", {}, icon("ShieldCheck", 16), "Free · no sign-up · nothing uploaded"),
        el("h1", {}, "Do anything with a PDF,", el("br"), el("span.scribble", {}, "right here.")),
        el("p.lead", {}, "Edit, sign, fill and convert PDFs for free. It works on any phone or computer, and your files never leave it.")),
      drop),
    resumeBox,
    beforeTasks = el("div.home-sections"),
    el("h2.tasks-title", {}, "What do you want to do?"),
    grid,
    afterTasks = el("div.home-sections"),
    el("footer.home-foot", {},
      el("p", {}, icon("Lock", 15), " Your files never leave this device. No watermark, no limits, no account."),
      el("p.muted", {}, "OddlyClever PDF is free and ", el("a", { href: "https://github.com/oddlyclevertools/OddlyCleverPDF", target: "_blank", rel: "noopener" }, "open source"),
        ". Made by ", el("a", { href: "https://www.youtube.com/@oddlyclevertools", target: "_blank", rel: "noopener" }, "Oddly Clever Tools"), " · ",
        el("a", { href: "https://ko-fi.com/oddlyclevertools", target: "_blank", rel: "noopener" }, "Buy me a tea"))));
  renderTasks();
  renderSections();
}

/** Show (or hide) the "Continue editing" card. */
export function showResume(info, onResume, onDiscard) {
  if (!resumeBox) return;
  resumeBox.replaceChildren();
  if (!info) return;
  resumeBox.append(el("div.resume-card.oc-enter", {},
    icon("History", 22),
    el("div", {}, el("strong", {}, "Continue where you left off"), el("span", {}, `${info.name} · ${info.pages} page${info.pages === 1 ? "" : "s"} · ${ago(info.at)}`)),
    el("button.btn.primary", { type: "button", on: { click: onResume } }, "Continue"),
    el("button.icon-btn", { type: "button", title: "Forget it", "aria-label": "Forget the saved work", on: { click: onDiscard } }, icon("X", 18))));
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

let showAll = false;
function renderTasks() {
  if (!grid) return;
  grid.replaceChildren();
  const list = taskList();
  const more = el("div.task-more", { hidden: !showAll });
  for (const [g, title] of GROUPS) {
    const items = g === "popular" ? list.filter((t) => t.popular) : list.filter((t) => t.group === g);
    if (!items.length) continue;
    const row = el("div.task-row", {}, items.map((t) => el("button.task", { type: "button", dataset: { color: t.color, task: t.id }, on: { click: () => app.runTask(t.id) } },
      el("span.task-icon", {}, icon(t.icon, 24)),
      el("span.task-words", {}, el("strong", {}, t.title), el("small", {}, t.blurb || "")))));
    (g === "popular" ? grid : more).append(el("section.task-group", {}, el("h3", {}, title), row));
    stagger(row, { max: 10 });
  }
  // the most used jobs first; everything else one tap away (so the page stays short)
  if (more.childElementCount) {
    const n = list.length;
    const btn = el("button.btn.task-all", { type: "button", "aria-expanded": String(showAll), on: { click: () => {
      showAll = !showAll; more.hidden = !showAll; btn.setAttribute("aria-expanded", String(showAll));
      btn.replaceChildren(icon(showAll ? "ChevronUp" : "LayoutGrid", 18), showAll ? "Show fewer" : `Show all ${n} tools`);
      if (showAll) stagger(more, { max: 6 });
    } } }, icon(showAll ? "ChevronUp" : "LayoutGrid", 18), showAll ? "Show fewer" : `Show all ${n} tools`);
    grid.append(btn, more);
  }
}
