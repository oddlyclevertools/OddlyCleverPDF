// The stamp "thunk": a placed object lands with a little squash, like a rubber stamp.
export function thunk(pageId, objId) {
  requestAnimationFrame(() => {
    const n = document.querySelector(`.page[data-id="${pageId}"] .layer-objects [data-id="${objId}"]`);
    if (!n) return;
    n.classList.remove("fs-thunk"); void n.offsetWidth; n.classList.add("fs-thunk");
    n.addEventListener("animationend", () => n.classList.remove("fs-thunk"), { once: true });
  });
}
