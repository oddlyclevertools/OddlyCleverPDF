// Shows the AI's words: a little formatting (bold, bullets, paragraphs) and "p. 3" turned into
// clickable chips that scroll the viewer to that page.
import { el } from "../../ui/kit.js";

const CITE = /\b(?:pp?\.|pages?)\s*(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?/gi;

/** @returns {{ start: number, end: number, page: number, text: string }[]} where the page references are. */
export function findCites(text) {
  const out = [];
  for (const m of String(text).matchAll(CITE)) out.push({ start: m.index, end: m.index + m[0].length, page: +m[1], text: m[0] });
  return out;
}

function inline(text, onJump, pageCount) {
  const nodes = [];
  let last = 0;
  const push = (s) => {
    // **bold** inside plain stretches
    s.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) nodes.push(el("b", {}, part.slice(2, -2)));
      else if (part) nodes.push(part);
    });
  };
  for (const c of findCites(text)) {
    if (c.page < 1 || (pageCount && c.page > pageCount)) continue;
    // "(p. 1)" becomes just the chip: brackets round a chip read as "((p. 1))"
    let before = text.slice(last, c.start);
    if (/\(\s*$/.test(before) && /^\s*\)/.test(text.slice(c.end))) {
      before = before.replace(/\s*\(\s*$/, " ");
      c.end += text.slice(c.end).match(/^\s*\)/)[0].length;
    }
    push(before);
    nodes.push(el("button.ai-cite", { type: "button", title: `Go to page ${c.page}`, on: { click: () => onJump(c.page) } }, c.text.replace(/^pages?\b/i, "p.").replace(/\s+/g, " ")));
    last = c.end;
  }
  push(text.slice(last));
  return nodes;
}

/** Turn an answer into nodes. */
export function renderAnswer(text, { onJump, pageCount = 0 } = {}) {
  const blocks = [];
  let list = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      if (!list) { list = el("ul.ai-list"); blocks.push(list); }
      list.append(el("li", {}, ...inline(bullet[1], onJump, pageCount)));
    } else if (line.trim()) {
      list = null;
      blocks.push(el("p", {}, ...inline(line.replace(/^#{1,4}\s+/, ""), onJump, pageCount)));
    } else list = null;
  }
  return blocks;
}
