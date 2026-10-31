// Small UI kit shared by every feature: elements, icons, popovers, sliders, colour picker, toasts.
import { createElement } from "lucide";
import * as icons from "./icons.gen.js";

/** el("div.cls", {attrs, on: {click}}, ...children) */
export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const node = document.createElement(name || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === "class") node.className += ` ${v}`;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? node.style.setProperty(sk, sv) : (node.style[sk] = sv);
    }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** A Lucide icon by PascalCase name, e.g. icon("Type"). */
export function icon(name, size = 18) {
  const def = icons[name];
  if (!def) {
    console.warn(`[kit] no icon ${name}`);
    return el("span.icon-missing");
  }
  const svg = createElement(def);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.classList.add("icon");
  return svg;
}

/** An icon button with a tooltip. */
export function iconButton(name, title, onClick, { active = false, cls = "" } = {}) {
  return el(`button.ibtn${cls ? "." + cls : ""}`, {
    type: "button", title, "aria-label": title, class: active ? "on" : null, on: { click: onClick },
  }, icon(name));
}

// ---- popovers -------------------------------------------------------------------------

let openPop = null;

/** Show `content` in a popover under `anchor`. Click outside or Esc closes it. */
export function popover(anchor, content, { onClose, align = "start", cls = "" } = {}) {
  closePopover();
  const pop = el(`div.popover${cls ? "." + cls : ""}`, { role: "dialog" }, content);
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect();
    let left = align === "end" ? r.right - p.width : r.left;
    left = Math.max(8, Math.min(left, innerWidth - p.width - 8));
    let top = r.bottom + 8;
    if (top + p.height > innerHeight - 8) top = Math.max(8, r.top - p.height - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(() => pop.classList.add("show"));
  window.requestIdleCallback?.(() => { try { pageSheet(); } catch { /* the exit falls back to a plain remove */ } });
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  // Esc closes the popover only; it mustn't also reach the editor (which would deselect).
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } };
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
  });
  openPop = {
    pop,
    close() {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
      fadeOut(pop); // the real popover leaves the DOM now; a look-alike copy plays the exit
      onClose?.();
    },
    place,
  };
  return openPop;
}

/**
 * Take a popover out of the page at once and let a look-alike copy fade away in its place. The copy
 * lives in a closed shadow root, so selectors, tests and screen readers never see the popover twice.
 */
function fadeOut(pop) {
  if (!pop.isConnected || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { pop.remove(); return; }
  let host = null;
  try {
    host = el("div.pop-ghost", { "aria-hidden": "true" });
    const root = host.attachShadow({ mode: "closed" });
    root.adoptedStyleSheets = [pageSheet()];
    const copy = pop.cloneNode(true);
    copy.inert = true;
    root.append(copy);
    pop.replaceWith(host);
    void copy.offsetWidth;
    copy.classList.remove("show");
    const done = () => host.remove();
    copy.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 220); // fallback: the exit is --dur-2 (180 ms)
  } catch {
    host?.remove();
    pop.remove();
  }
}

// The page's CSS as one constructable sheet for the fading copies (rebuilt when the CSS changes).
let sheetCache = { key: "", sheet: null };
function pageSheet() {
  const rulesOf = (sh) => { try { return [...sh.cssRules]; } catch { return []; } };
  const sheets = [...document.styleSheets];
  const key = sheets.map((sh) => rulesOf(sh).length).join(",");
  if (sheetCache.sheet && sheetCache.key === key) return sheetCache.sheet;
  const text = sheets.flatMap(rulesOf).filter((r) => !(r instanceof CSSImportRule)).map((r) => r.cssText).join("\n");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  sheetCache = { key, sheet };
  return sheet;
}

export function closePopover() {
  const p = openPop;
  openPop = null;
  p?.close();
}

// ---- form controls --------------------------------------------------------------------

/** A labelled range slider with a number box. onInput fires while dragging, onChange at the end. */
export function slider({ label, min = 0, max = 100, step = 1, value = 0, unit = "", onInput, onChange }) {
  const num = el("input.num", { type: "number", min, max, step, value });
  const range = el("input.range", { type: "range", min, max, step, value });
  const paint = () => range.style.setProperty("--p", `${((range.value - min) / (max - min)) * 100}%`);
  const set = (v, done) => {
    v = Math.max(min, Math.min(max, Number(v)));
    if (Number.isNaN(v)) return;
    range.value = v;
    num.value = v;
    paint();
    onInput?.(v);
    if (done) onChange?.(v);
  };
  range.addEventListener("input", () => set(range.value, false));
  range.addEventListener("change", () => set(range.value, true));
  num.addEventListener("change", () => set(num.value, true));
  paint();
  return el("label.slider", {}, el("span.slider-label", {}, label, unit ? el("small", {}, ` ${unit}`) : null),
    el("div.slider-row", {}, range, num));
}

export function select({ value, options, onChange, title }) {
  const s = el("select.sel", { title, on: { change: () => onChange(s.value) } },
    options.map((o) => el("option", { value: o.value ?? o, selected: (o.value ?? o) === value }, o.label ?? o)));
  return s;
}

export function toggle({ label, value, onChange }) {
  const box = el("input", { type: "checkbox", checked: value, on: { change: () => onChange(box.checked) } });
  return el("label.toggle", {}, box, el("span.track"), el("span", {}, label));
}

export function section(title, ...children) {
  return el("section.sec", {}, title ? el("h4.sec-title", {}, title) : null, ...children);
}

// ---- colours ---------------------------------------------------------------------------

/** Ink colours people actually use on documents, then a few bright ones. */
export const PALETTE = ["#111111", "#1f4fd8", "#d81f3c", "#11845b", "#7a3cf0", "#ff2e7e", "#ff8a00", "#ffd60a", "#ffffff"];

/**
 * A row of colour dots plus a "more" picker (the native one, which works on phones too).
 * onPick(hex) fires on every choice.
 */
export function colorRow(value, onPick, { colors = PALETTE, label = "Colour" } = {}) {
  const row = el("div.swatches", { role: "group", "aria-label": label });
  const mark = (v) => row.querySelectorAll(".sw").forEach((b) => b.classList.toggle("on", b.dataset.c === String(v).toLowerCase()));
  for (const c of colors) {
    row.append(el("button.sw", { type: "button", title: c, dataset: { c: c.toLowerCase() }, style: { "--c": c },
      on: { click: () => { mark(c); onPick(c); } } }));
  }
  const more = el("input.sw-more", { type: "color", value: /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#111111", title: "Any colour",
    on: { input: () => { mark(more.value); onPick(more.value); } } });
  row.append(el("label.sw.sw-any", { title: "Any colour" }, more));
  mark(value || "");
  return row;
}

// ---- toasts and dialogs ---------------------------------------------------------------

export function toast(message, { error = false, ms = 3200 } = {}) {
  let host = document.getElementById("toasts");
  if (!host) document.body.append(host = el("div.toasts", { id: "toasts" }));
  const t = el("div.toast", { class: error ? "error" : null, role: "status" }, message);
  host.append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  return t; // callers may remove a long "working…" toast early
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openModals = []; // the topmost dialog is the one Esc and Tab belong to

/**
 * A modal dialog. Returns {close}. `content` can be a node or a function(close) => node.
 * Esc, the X and a click on the backdrop all close it; onClose(reason) runs once however it
 * closes ("dismiss" for those three), so callers waiting on an answer never hang. Tab stays
 * inside the dialog, and focus goes back where it was afterwards.
 */
export function modal(title, content, { wide = false, onClose = null } = {}) {
  const back = el("div.modal-back");
  const before = document.activeElement;
  let closed = false;
  const close = (reason = "done") => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", keys);
    openModals.splice(openModals.indexOf(me), 1);
    back.classList.remove("show");
    setTimeout(() => back.remove(), 200);
    try { onClose?.(reason); } finally {
      if (before?.isConnected && typeof before.focus === "function") before.focus({ preventScroll: true });
    }
  };
  const me = { close };
  const box = el("div.modal", { role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1", class: wide ? "wide" : null },
    el("div.modal-head", {}, el("h3", {}, title), iconButton("X", "Close", () => close("dismiss"))),
    typeof content === "function" ? content(() => close()) : content);
  back.append(box);
  document.body.append(back);
  openModals.push(me);
  requestAnimationFrame(() => back.classList.add("show"));
  const keys = (e) => {
    if (openModals.at(-1) !== me) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close("dismiss");
    } else if (e.key === "Tab") {
      const list = [...box.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!list.length) { e.preventDefault(); box.focus(); return; }
      const i = list.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); list.at(-1).focus(); }
      else if (!e.shiftKey && (i === -1 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
    }
  };
  document.addEventListener("keydown", keys);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close("dismiss"); });
  // Start inside the dialog: its first control after the X (for a confirm that's Cancel, the
  // safe choice), unless the caller focuses something itself.
  requestAnimationFrame(() => {
    if (closed || box.contains(document.activeElement)) return;
    const list = [...box.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest(".modal-head"));
    (list[0] || box).focus({ preventScroll: true });
  });
  return me;
}

/** Ask the user to confirm. Resolves true/false (false for Cancel, Esc, the X or the backdrop). */
export function confirmDialog(title, message, okLabel = "OK") {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    modal(title, (close) => el("div.confirm", {}, el("p", {}, message), el("div.row.end", {},
      el("button.btn", { type: "button", on: { click: () => { answer(false); close(); } } }, "Cancel"),
      el("button.btn.primary", { type: "button", on: { click: () => { answer(true); close(); } } }, okLabel))),
    { onClose: () => answer(false) });
  });
}
