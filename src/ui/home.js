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
  ["ai", "Smart"],
];

/**
 * A job on the home screen and in the Ctrl+K palette.
 * @param {{ id, title, blurb, icon, color?: string, group?: string, popular?: boolean, order?: number,
 *   files?: "none"|"one"|"many", accept?: string, run: (app, files?: File[]) => any }} t
 *   files: "one"/"many" asks for files first (unless a document is open and `usesOpenDoc`).
 */
export function registerTask(t) { tasks.set(t.id, { order: 50, group: "edit", files: "one", color: "pink", ...t }); renderTasks(); }
export const taskList = () => [...tasks.values()].sort((a, b) => a.order - b.order);

let host, app, grid, resumeBox;

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
        el("p.lead", {}, "Edit, sign, fill, merge, squash and convert. It all runs on your device, on any phone or computer, and you can bring your own AI.")),
      drop),
    resumeBox,
    el("h2.tasks-title", {}, "What do you want to do?"),
    grid,
    el("footer.home-foot", {},
      el("p", {}, icon("Lock", 15), " Your files never leave this device. No watermark, no limits, no account."),
      el("p.muted", {}, "OddlyClever PDF is free and open source. Made by Oddly Clever Tools.")));
  renderTasks();
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

function renderTasks() {
  if (!grid) return;
  grid.replaceChildren();
  const list = taskList();
  for (const [g, title] of GROUPS) {
    const items = g === "popular" ? list.filter((t) => t.popular) : list.filter((t) => t.group === g);
    if (!items.length) continue;
    const row = el("div.task-row", {}, items.map((t) => el("button.task", { type: "button", dataset: { color: t.color, task: t.id }, on: { click: () => app.runTask(t.id) } },
      el("span.task-icon", {}, icon(t.icon, 24)),
      el("span.task-words", {}, el("strong", {}, t.title), el("small", {}, t.blurb || "")))));
    grid.append(el("section.task-group", {}, el("h3", {}, title), row));
    stagger(row, { max: 10 });
  }
}
