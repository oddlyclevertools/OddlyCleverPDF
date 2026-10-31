// Live preview on every page sheet: the watermark, page numbers, header/footer and the crop shade.
// It draws what the saved PDF will get (same maths as the export step) and updates as you type.
import { state, on } from "../../core/store.js";
import { el } from "../../ui/kit.js";
import { itemsFor, metrics, metricsReady } from "./items.js";
import { cropOf } from "./cfg.js";

const layers = new Set(); // { page, node }

function paint(entry) {
  const { page, node } = entry;
  const z = state.zoom;
  node.replaceChildren();
  const crop = cropOf(page.id);
  if (crop) {
    const shade = (cls, st) => node.append(el(`div.pg-shade.${cls}`, { style: st }));
    const px = (v) => `${v * z}px`;
    shade("t", { left: 0, top: 0, right: 0, height: px(crop.t) });
    shade("b", { left: 0, bottom: 0, right: 0, height: px(crop.b) });
    shade("l", { left: 0, top: px(crop.t), bottom: px(crop.b), width: px(crop.l) });
    shade("r", { right: 0, top: px(crop.t), bottom: px(crop.b), width: px(crop.r) });
  }
  if (!metricsReady()) return;
  const idx = state.pages.indexOf(page);
  if (idx < 0) return;
  for (const it of itemsFor(page, idx, state.pages.length)) {
    const tf = `translate(${it.ox * z}px, ${it.oy * z}px) rotate(${-it.angle}deg)`;
    if (it.kind === "image") {
      node.append(el("img.pg-pv", { src: state.images.get(it.imageId) || "", alt: "", style: { width: `${it.w * z}px`, height: `${it.h * z}px`, opacity: it.opacity, transform: `${tf} translateY(-100%)` } }));
    } else {
      node.append(el("div.pg-pv.pg-pv-text", { style: { fontSize: `${it.size * z}px`, color: it.color, opacity: it.opacity, fontWeight: it.bold ? 700 : 400, transform: `${tf} translateY(-85%)` } }, it.text));
    }
  }
}

export function installPreview(app) {
  app.registerLayer((page) => {
    const node = el("div.pg-layer", { "aria-hidden": "true" });
    const entry = { page, node };
    layers.add(entry);
    paint(entry);
    return node;
  });
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const e of [...layers]) { if (!e.node.isConnected && e.node.dataset.seen) layers.delete(e); else { e.node.dataset.seen = "1"; paint(e); } }
    });
  };
  on((e) => { if (["change", "live", "zoom", "pages-built", "doc"].includes(e.type)) refresh(); });
  metrics().then(refresh);
}
