// Offline support: keep a copy of the app's own files after the first visit, so it opens with no
// internet. Same-origin GET requests only; the AI provider and OCR language downloads are never cached here.
// Files shared to the installed app (share_target POST) are handed to the page.
const CACHE = "ocpdf-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./favicon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const shared = [];
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // only the share_target address; any website can post a form here, so the page asks before it opens anything
  if (e.request.method === "POST" && url.pathname === new URL("./", self.registration.scope).pathname) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      shared.push(...form.getAll("files").filter((f) => typeof f !== "string"));
      shared.splice(0, Math.max(0, shared.length - 10));
      return Response.redirect("./?shared=1", 303);
    })());
    return;
  }
  if (e.request.method !== "GET") return;
  // the page: network first (fresh app), cache when offline; everything else: cache first
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});

self.addEventListener("message", (e) => {
  if (e.data === "shared-files") { e.source.postMessage({ type: "shared-files", files: shared.splice(0) }); }
});
