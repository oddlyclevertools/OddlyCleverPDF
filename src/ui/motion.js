// Motion helpers that go with styles/motion.css: reveal a list item by item, play a one-off
// feedback animation, and animate an element's height when its content changes. All of them
// respect "reduce motion" through the CSS (animations shrink to 1 ms).

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveal a container's children one after another (adds .oc-stagger and sets --i).
 * @param {HTMLElement} box
 * @param {{ max?: number }} [opts] items past `max` appear together, so long lists stay quick
 * @returns {HTMLElement} box
 */
export function stagger(box, { max = 18 } = {}) {
  if (!box) return box;
  [...box.children].forEach((c, i) => c.style.setProperty("--i", String(Math.min(i, max))));
  box.classList.remove("oc-stagger");
  void box.offsetWidth; // restart the animation when the list is rebuilt
  box.classList.add("oc-stagger");
  return box;
}

/**
 * Play a one-off animation class (oc-done, oc-shake, oc-enter…) and remove it afterwards.
 * @param {HTMLElement} el
 * @param {string} cls
 */
export function play(el, cls = "oc-done") {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

/**
 * Change an element's content and animate its height between the old and new size.
 * @param {HTMLElement} el
 * @param {() => void} change does the DOM change
 */
export function morphHeight(el, change) {
  if (!el || reduced()) { change(); return; }
  const from = el.offsetHeight;
  change();
  const to = el.offsetHeight;
  if (from === to) return;
  el.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }],
    { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
}
