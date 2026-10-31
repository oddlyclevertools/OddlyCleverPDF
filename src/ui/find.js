// Find words in the document (Ctrl+F). Results list page and context; pressing one scrolls there
// and glows the match. Can also highlight every match in one go.
import { el, icon } from "./kit.js";
import { state, change, uid } from "../core/store.js";
import { pageLines } from "../core/text.js";
import { registerPanel, openPanel, registerTopAction, registerCommands } from "./shell.js";
import { scrollToPage, viewOf } from "../viewer/viewer.js";

/** Every match of `q` (case-insensitive) with its box on the page. */
export async function findAll(q, { limit = 500 } = {}) {
  const out = [];
  const needle = q.toLowerCase();
  if (!needle) return out;
  for (const [i, p] of state.pages.entries()) {
    const lines = await pageLines(p.id);
    for (const l of lines) {
      const hay = l.text.toLowerCase();
      let k = hay.indexOf(needle);
      while (k >= 0 && out.length < limit) {
        out.push({ pageId: p.id, index: i, line: l, at: k, rect: rectFor(l, k, needle.length), snippet: l.text });
        k = hay.indexOf(needle, k + needle.length);
      }
    }
  }
  return out;
}

/** Approximate box of characters [k, k+n) on a line (runs are measured per character). */
function rectFor(line, k, n) {
  let pos = 0, x0 = null, x1 = null, prevEnd = null;
  for (const r of line.runs) {
    if (prevEnd != null && r.x - prevEnd > r.size * 0.18 && !r.str.startsWith(" ")) pos += 1; // the joined space
    const cw = r.w / Math.max(1, r.str.length);
    for (let c = 0; c < r.str.length; c++, pos++) {
      if (pos === k) x0 = r.x + c * cw;
      if (pos === k + n - 1) x1 = r.x + (c + 1) * cw;
    }
    prevEnd = r.x + r.w;
  }
  if (x0 == null) x0 = line.x;
  if (x1 == null) x1 = line.x + line.w;
  return { x: x0, y: line.y, w: Math.max(2, x1 - x0), h: line.h };
}

function glow(hit) {
  scrollToPage(hit.index);
  const v = viewOf(hit.pageId);
  if (!v) return;
  v.sheet.querySelector(".find-glow")?.remove();
  const z = state.zoom;
  const g = el("div.find-glow", { style: { left: `${hit.rect.x * z - 3}px`, top: `${hit.rect.y * z - 3}px`, width: `${hit.rect.w * z + 6}px`, height: `${hit.rect.h * z + 6}px` } });
  v.sheet.append(g);
  setTimeout(() => g.remove(), 2600);
}

export function installFind(app) {
  registerPanel({
    id: "find", title: "Find words", label: "Find", icon: "Search", order: 5,
    render(box) {
      const input = el("input.input", { type: "search", placeholder: "Search this PDF…", "aria-label": "Search" });
      const info = el("p.muted.small", {}, "");
      const list = el("div.find-list");
      let hits = [];
      const run = async () => {
        const q = input.value.trim();
        if (!q) { list.replaceChildren(); info.textContent = ""; return; }
        info.textContent = "Looking…";
        hits = await findAll(q);
        if (q !== input.value.trim()) return;
        info.textContent = hits.length ? `${hits.length} match${hits.length === 1 ? "" : "es"}` : "No matches. Scanned pages need text recognition (OCR) first.";
        list.replaceChildren(...hits.slice(0, 200).map((h) => {
          const s = h.snippet, a = Math.max(0, h.at - 30);
          return el("button.find-hit", { type: "button", on: { click: () => glow(h) } },
            el("small", {}, `Page ${h.index + 1}`),
            el("span", {}, a ? "…" : "", s.slice(a, h.at), el("mark", {}, s.slice(h.at, h.at + q.length)), s.slice(h.at + q.length, h.at + q.length + 40)));
        }));
      };
      let t = 0;
      input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 220); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && hits[0]) glow(hits[0]); });
      const markAll = el("button.btn.small", { type: "button", on: { click: () => {
        if (!hits.length) return;
        change(`Highlight ${hits.length} matches`, () => {
          for (const h of hits) state.pages.find((p) => p.id === h.pageId)?.objects.push({ id: uid(), type: "highlight", rects: [h.rect], color: "#ffd60a", style: "highlight", opacity: 0.45 });
        });
      } } }, icon("Highlighter", 15), "Highlight all");
      box.append(input, el("div.row.between", {}, info, markAll), list);
      setTimeout(() => input.focus(), 50);
    },
  });
  registerTopAction({ id: "find", order: 30, render: () => el("button.icon-btn", { type: "button", title: "Find (Ctrl+F)", "aria-label": "Find words", on: { click: () => app.togglePanel("find") } }, icon("Search", 19)) });
  registerCommands(() => state.pages.length ? [{ id: "find", label: "Find words", group: "View", icon: "Search", keywords: "search ctrl f", run: () => openPanel("find") }] : []);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && state.pages.length && app.view === "editor") { e.preventDefault(); openPanel("find"); }
  });
}
