// A visible mouse pointer for showcase recordings (headless video has none): an arrow that
// follows the mouse and a pink ring on every click. Injected only when DT_RECORD is set.
(() => {
  const make = () => {
    if (document.getElementById("sc-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #sc-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; z-index: 2147483647; pointer-events: none;
        transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
      .sc-ring { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 3px solid #ff2e7e; pointer-events: none; animation: sc-ring .45s ease-out forwards; }
      @keyframes sc-ring { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
    document.head.append(style);
    const c = document.createElement("div");
    c.id = "sc-cursor";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    const at = (e) => { c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`; };
    window.addEventListener("pointermove", at, true);
    window.addEventListener("pointerdown", (e) => {
      at(e);
      const r = document.createElement("div");
      r.className = "sc-ring";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", make);
  else make();
})();
