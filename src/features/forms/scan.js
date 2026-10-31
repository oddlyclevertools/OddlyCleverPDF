// Scan to PDF: a full-screen camera sheet (phone first). Take shots, the page is found and
// straightened for you, fix the corners if needed, pick the black-and-white document look,
// reorder, then make an A4 PDF.
import { el, icon, toast } from "../../ui/kit.js";
import { toGray, detectDocQuad, quadSize, warpPerspective, adaptiveThreshold, pageFor } from "./scanimg.js";

const MAX_SRC = 2200, MAX_OUT = 2000;

/** Draw a picture on a canvas, scaled down to `max` on its longest side. */
function toCanvas(src, max) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Find the page in a canvas: four corners in pixels. */
export function autoCorners(canvas) {
  const k = Math.min(1, 320 / canvas.width);
  const small = toCanvas(canvas, Math.round(canvas.width * k));
  const g = small.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, small.width, small.height);
  const quad = detectDocQuad(toGray(g.data, small.width, small.height), small.width, small.height);
  return quad.map(([x, y]) => [x * canvas.width, y * canvas.height]);
}

/** The straightened (and optionally black-and-white) page for a shot. */
export function renderShot(shot) {
  const src = shot.src, g = src.getContext("2d", { willReadFrequently: true });
  const img = g.getImageData(0, 0, src.width, src.height);
  let { w, h } = quadSize(shot.quad);
  const k = Math.min(1, MAX_OUT / Math.max(w, h));
  w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const og = out.getContext("2d", { willReadFrequently: true });
  const data = warpPerspective(img.data, src.width, src.height, shot.quad, w, h);
  if (shot.bw) adaptiveThreshold(data, w, h);
  og.putImageData(new ImageData(data, w, h), 0, 0);
  return out;
}

export function installScan(app) {
  let sheet = null;

  app.registerTask({ id: "scan", title: "Scan to PDF", blurb: "Photograph paper pages with your camera", icon: "Camera", color: "orange", group: "convert", popular: true, order: 5, files: "none",
    run: () => openScanner() });
  app.registerCommands(() => [{ id: "fs:scan", label: "Scan paper to PDF with the camera", group: "Tasks", icon: "Camera", keywords: "camera photo scan document", run: () => openScanner() }]);

  function openScanner({ camera = true } = {}) {
    if (sheet) return sheet.api;
    const shots = [];
    let stream = null, view = "camera", cropFor = null, allBw = false;
    const root = el("div.fs-scan", { role: "dialog", "aria-modal": "true", "aria-label": "Scan to PDF" });
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add("show"));
    document.body.classList.add("fs-scanning");

    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const close = () => { stop(); root.classList.remove("show"); document.body.classList.remove("fs-scanning"); setTimeout(() => root.remove(), 200); sheet = null; };
    const fileIn = (capture) => el("input", { type: "file", accept: "image/*", multiple: !capture, capture: capture ? "environment" : null, hidden: true,
      on: { change: async (e) => {
        for (const f of e.target.files) await addFile(f);
        e.target.value = "";
        if (view !== "camera" || !shots.length) return;
        showCamera.refreshCount?.();
        // no live camera (a computer, or permission refused): the photos are the scan, so review them
        if (!stream) { showReview(); return; }
        toast(`${shots.length} page${shots.length > 1 ? "s" : ""} so far`, { ms: 1500 });
      } } });

    async function addFile(file) {
      try { const bmp = await createImageBitmap(file); addShot(bmp); bmp.close?.(); }
      catch { toast("That picture couldn't be read.", { error: true }); }
    }
    /** Add a picture (canvas, bitmap, video or image). The page is found and straightened. */
    function addShot(source) {
      const src = toCanvas(source, MAX_SRC);
      const shot = { id: Math.random().toString(36).slice(2, 8), src, quad: autoCorners(src), bw: allBw, out: null, thumb: "" };
      refreshShot(shot);
      shots.push(shot);
      return shot;
    }
    function refreshShot(shot) {
      shot.out = renderShot(shot);
      const t = toCanvas(shot.out, 360);
      shot.thumb = t.toDataURL("image/jpeg", 0.8);
    }

    // ---- camera view
    async function showCamera() {
      view = "camera"; stop();
      root.replaceChildren();
      const video = el("video.fs-video", { playsinline: true, muted: true, autoplay: true });
      const msg = el("div.fs-cam-msg");
      const strip = el("button.fs-count", { type: "button", on: { click: () => shots.length && showReview() } }, shots.length ? el("span", {}, String(shots.length)) : icon("Images", 20));
      const pick = fileIn(false), snap = fileIn(true);
      const shutter = el("button.fs-shutter", { type: "button", "aria-label": "Take a photo", on: { click: () => {
        if (stream && video.videoWidth) { addShot(video); root.classList.remove("fs-flash"); void root.offsetWidth; root.classList.add("fs-flash"); showCamera.refreshCount(); }
        else snap.click();
      } } }, el("i"));
      showCamera.refreshCount = () => { strip.replaceChildren(shots.length ? el("span", {}, String(shots.length)) : icon("Images", 20)); done.hidden = !shots.length; };
      const done = el("button.btn.primary.fs-done", { type: "button", hidden: !shots.length, on: { click: () => showReview() } }, "Done", icon("ArrowRight", 18));
      root.append(
        el("div.fs-top", {}, el("button.fs-roundbtn", { type: "button", "aria-label": "Close", on: { click: () => close() } }, icon("X", 22)), el("span.fs-title", {}, "Scan to PDF"), el("span", { style: { width: "48px" } })),
        video, msg,
        el("div.fs-bottom", {}, el("button.fs-sidebtn", { type: "button", on: { click: () => pick.click() } }, icon("ImagePlus", 22), el("span", {}, "Photos")), shutter, el("div.fs-right", {}, strip, done)),
        pick, snap);
      if (!camera || !navigator.mediaDevices?.getUserMedia) return noCamera(msg, "Tap the big button to take a photo with your phone's camera.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch (e) {
        noCamera(msg, e?.name === "NotAllowedError" ? "The camera is blocked. Tap the big button to use your phone's camera app, or choose photos." : "No camera here. Tap the big button, or choose photos.");
      }
    }
    function noCamera(msg, text) { msg.replaceChildren(icon("CameraOff", 36), el("p", {}, text)); msg.classList.add("show"); }

    // ---- review view
    function showReview() {
      view = "review"; stop();
      if (!shots.length) return showCamera();
      root.replaceChildren();
      const bw = el("input", { type: "checkbox", checked: allBw, on: { change: () => { allBw = bw.checked; for (const s of shots) { s.bw = allBw; refreshShot(s); } showReview(); } } });
      const grid = el("div.fs-grid");
      shots.forEach((s, i) => grid.append(el("div.fs-tile", { dataset: { id: s.id } },
        el("img", { src: s.thumb, alt: `Page ${i + 1}`, on: { click: () => showCrop(s) } }),
        el("span.fs-num", {}, String(i + 1)),
        el("div.fs-tilebar", {},
          el("button.fs-tbtn", { type: "button", title: "Move earlier", "aria-label": "Move earlier", disabled: i === 0, on: { click: () => { move(i, -1); } } }, icon("ArrowLeft", 18)),
          el("button.fs-tbtn", { type: "button", title: "Fix the corners", "aria-label": "Fix the corners", on: { click: () => showCrop(s) } }, icon("Crop", 18)),
          el("button.fs-tbtn", { type: "button", title: "Delete this page", "aria-label": "Delete this page", on: { click: () => { shots.splice(i, 1); showReview(); } } }, icon("Trash2", 18)),
          el("button.fs-tbtn", { type: "button", title: "Move later", "aria-label": "Move later", disabled: i === shots.length - 1, on: { click: () => { move(i, 1); } } }, icon("ArrowRight", 18))))));
      root.append(
        el("div.fs-top", {}, el("button.fs-roundbtn", { type: "button", "aria-label": "Back to the camera", on: { click: () => showCamera() } }, icon("ArrowLeft", 22)), el("span.fs-title", {}, `${shots.length} page${shots.length > 1 ? "s" : ""}`), el("span", { style: { width: "48px" } })),
        el("label.fs-bwrow", {}, bw, el("span", {}, "Black & white document"), el("small", {}, "Clears shadows, like a scanner")),
        grid,
        el("div.fs-bottom.review", {}, el("button.btn.fs-add", { type: "button", on: { click: () => showCamera() } }, icon("Plus", 18), "Add a page"),
          el("button.btn.primary.fs-make", { type: "button", on: { click: () => makePdf() } }, icon("FileCheck2", 18), "Make PDF")));
    }
    function move(i, d) { const j = i + d; if (j < 0 || j >= shots.length) return; [shots[i], shots[j]] = [shots[j], shots[i]]; showReview(); }

    // ---- crop view: drag the four corners
    function showCrop(shot) {
      view = "crop"; cropFor = shot;
      root.replaceChildren();
      const stage = el("div.fs-stage");
      const img = el("canvas.fs-cropimg", { width: shot.src.width, height: shot.src.height });
      img.getContext("2d").drawImage(shot.src, 0, 0);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "fs-quad"); svg.setAttribute("viewBox", `0 0 ${shot.src.width} ${shot.src.height}`);
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      svg.append(poly);
      const handles = shot.quad.map((_, i) => {
        const h = el("div.fs-handle", { dataset: { corner: String(i) }, tabindex: "0", "aria-label": `Corner ${i + 1}` });
        h.addEventListener("pointerdown", (e) => {
          e.preventDefault(); h.setPointerCapture(e.pointerId);
          const move = (ev) => {
            const r = img.getBoundingClientRect();
            shot.quad[i] = [Math.max(0, Math.min(shot.src.width, ((ev.clientX - r.left) / r.width) * shot.src.width)), Math.max(0, Math.min(shot.src.height, ((ev.clientY - r.top) / r.height) * shot.src.height))];
            paint();
          };
          const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
          h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
        });
        return h;
      });
      function paint() {
        poly.setAttribute("points", shot.quad.map((p) => p.join(",")).join(" "));
        handles.forEach((h, i) => { h.style.left = `${(shot.quad[i][0] / shot.src.width) * 100}%`; h.style.top = `${(shot.quad[i][1] / shot.src.height) * 100}%`; });
      }
      stage.style.aspectRatio = `${shot.src.width} / ${shot.src.height}`;
      stage.append(img, svg, ...handles);
      paint();
      const bw = el("input", { type: "checkbox", checked: shot.bw });
      root.append(
        el("div.fs-top", {}, el("button.fs-roundbtn", { type: "button", "aria-label": "Cancel", on: { click: () => showReview() } }, icon("X", 22)), el("span.fs-title", {}, "Fix the corners"), el("span", { style: { width: "48px" } })),
        el("div.fs-cropwrap", {}, stage),
        el("label.fs-bwrow", {}, bw, el("span", {}, "Black & white document")),
        el("div.fs-bottom.review", {}, el("button.btn.fs-add", { type: "button", on: { click: () => { shot.quad = autoCorners(shot.src); showCrop(shot); } } }, icon("Wand2", 18), "Find the page again"),
          el("button.btn.primary.fs-make", { type: "button", on: { click: () => { shot.bw = bw.checked; refreshShot(shot); showReview(); } } }, icon("Check", 18), "Done")));
    }

    // ---- make the PDF
    async function makePdf() {
      if (!shots.length) return null;
      const b = app.busy("Making your PDF");
      try {
        const doc = await app.pdfLib.PDFDocument.create();
        for (let i = 0; i < shots.length; i++) {
          b.set(i / shots.length, `Page ${i + 1} of ${shots.length}`);
          const s = shots[i], c = s.out;
          const url = c.toDataURL(s.bw ? "image/png" : "image/jpeg", 0.88);
          const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (ch) => ch.charCodeAt(0));
          const img = s.bw ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const [pw, ph] = pageFor(c.width, c.height);
          const k = Math.min(pw / c.width, ph / c.height), w = c.width * k, h = c.height * k;
          doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        const bytes = await doc.save();
        b.done();
        close();
        const name = `Scan ${new Date().toISOString().slice(0, 10)}.pdf`;
        await app.open([new File([bytes], name, { type: "application/pdf" })]);
        return bytes;
      } catch (e) { b.fail(e); return null; }
    }

    const api = { addShot, shots: () => shots, makePdf, close, showReview, showCrop, move, root, setBw: (v) => { allBw = v; } };
    sheet = { api };
    showCamera();
    return api;
  }
  app.fs.scan = { open: openScanner };
}
