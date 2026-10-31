// The Convert panel: "Where will you use it?" Big friendly cards; one tap converts and downloads.
import { el, icon, select } from "../../ui/kit.js";
import { parseRange } from "./pagedata.js";
import { IMAGE_PAGE_KEY, imagePageMode } from "./importers.js";

const GROUPS = [
  ["Documents", "Word and documents", "FileText"],
  ["Spreadsheets", "Excel and tables", "Table"],
  ["Slides", "PowerPoint", "Presentation"],
  ["Images", "Pictures", "Image"],
  ["Text & web", "Text and web", "Globe"],
  ["PDF", "Other kinds of PDF", "FileCheck"],
];
const OPT_KEY = "oc.convert.options";
const loadOpts = () => { try { return JSON.parse(localStorage.getItem(OPT_KEY) || "{}"); } catch { return {}; } };
const saveOpts = (o) => { try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch { /* private mode: fine */ } };

/** Convert the open document with one exporter and hand the file(s) to the user. */
export async function convertNow(app, id, { pages, options } = {}) {
  const ex = app.exporters().find((e) => e.id === id);
  if (!ex) return;
  if (!app.state.pages.length) { app.toast("Open a PDF first, then pick where you want it to go."); return; }
  const saved = loadOpts()[id] || {};
  const b = app.busy(`Making your ${ex.label} file`);
  try {
    const res = await ex.run(app, { progress: (f, l) => b.set(f, l), signal: b.signal, pages, options: { ...saved, ...(options || {}) } });
    const list = Array.isArray(res) ? res : [res];
    for (const r of list) await app.deliver(r.blob, r.filename, { type: r.blob.type });
    b.done(`Your ${ex.label} file is in your downloads`);
  } catch (e) { console.error("[convert]", e); b.fail(e); }
}

export function renderPanel(app, box, opts = {}) {
  const total = app.state.pages.length;
  const saved = loadOpts();
  let range = "all", rangeText = "";
  const rangeError = el("p.cv-error", { hidden: true }, "Try something like 1-3, 5");
  const rangeInput = el("input.input.cv-range", { type: "text", placeholder: "For example 1-3, 5", inputmode: "numeric", "aria-label": "Page numbers", hidden: true, on: { input: () => { rangeText = rangeInput.value; rangeError.hidden = true; } } });
  const chips = [["all", "All pages"], ["this", "This page"], ["pick", "Choose pages"]].map(([v, label]) =>
    el("button.cv-chip", { type: "button", "aria-pressed": String(v === range), on: { click: () => { range = v; rangeInput.hidden = v !== "pick"; for (const c of chips) c.setAttribute("aria-pressed", String(c.dataset.v === v)); if (v === "pick") rangeInput.focus(); } }, dataset: { v } }, label));

  const pagesNow = () => {
    if (range === "this") return [app.currentPageIndex() || 0];
    if (range === "pick") {
      const p = parseRange(rangeText, total);
      if (!p) { rangeError.hidden = false; return false; }
      return p;
    }
    return undefined;
  };

  const exporters = app.exporters();
  const known = new Set(GROUPS.map((g) => g[0]));
  const groups = [...GROUPS, ...[...new Set(exporters.map((e) => e.group))].filter((g) => !known.has(g)).map((g) => [g, g, "File"])];
  const cards = [];
  for (const [key, title, ic] of groups) {
    const list = exporters.filter((e) => e.group === key);
    if (!list.length) continue;
    cards.push(el("section.cv-group", {},
      el("h4.cv-group-title", {}, icon(ic, 16), title),
      el("div.cv-cards", {}, list.map((ex) => card(ex)))));
  }

  function card(ex) {
    const chosen = { ...Object.fromEntries((ex.options || []).map((o) => [o.key, o.value])), ...(saved[ex.id] || {}) };
    const go = () => {
      const pages = pagesNow();
      if (pages === false) return;
      saved[ex.id] = chosen; saveOpts(saved);
      convertNow(app, ex.id, { pages, options: chosen });
    };
    const opts2 = (ex.options || []).map((o) => el("label.cv-opt", {}, el("span", {}, o.label),
      select({ value: String(chosen[o.key]), title: o.label, options: o.choices.map((c) => ({ value: String(c.value), label: c.label })), onChange: (v) => { chosen[o.key] = typeof o.value === "number" ? Number(v) : v; saved[ex.id] = chosen; saveOpts(saved); } })));
    return el("div.cv-card.oc-enter", { class: opts.format === ex.id ? "cv-pulse" : "" },
      el("button.cv-main", { type: "button", "aria-label": `Convert to ${ex.label}`, on: { click: go } },
        el("span.cv-badge", { dataset: { fmt: ex.ext } }, ex.badge || ex.ext.toUpperCase()),
        el("span.cv-words", {}, el("strong", {}, ex.label), el("small", {}, ex.blurb || "")),
        el("span.cv-go", { "aria-hidden": "true" }, icon("Download", 18))),
      opts2.length ? el("div.cv-opts", {}, opts2) : null);
  }

  const imgMode = select({ value: imagePageMode(), title: "Page size for pictures", options: [{ value: "picture", label: "Same size as the picture" }, { value: "a4", label: "A4 page, picture fitted" }], onChange: (v) => { try { localStorage.setItem(IMAGE_PAGE_KEY, v); } catch { /* ignore */ } } });

  box.append(
    el("div.cv-intro", {}, el("h3", {}, "Where will you use it?"), el("p.muted", {}, "Tap a card. Your edits are included, and nothing leaves this device.")),
    el("div.cv-range", {}, el("span.cv-label", {}, "Which pages?"), el("div.cv-chips", {}, chips), rangeInput, rangeError),
    ...cards,
    el("section.cv-group", {}, el("h4.cv-group-title", {}, icon("ImagePlus", 16), "Opening pictures"),
      el("label.cv-opt", {}, el("span", {}, "When I open a picture, make a page that is"), imgMode)));
}
