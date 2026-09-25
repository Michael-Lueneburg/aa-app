// AA-Reflex Service Worker – macht die App offline nutzbar.
// Bei jeder neuen Version VERSION erhöhen, dann bietet die App das Update an.
const VERSION = "aa-reflex-2.1.0";
const FILES = [
  "./", "index.html", "styles.css", "data.js", "store.js", "lesen.js", "app.js", "manifest.webmanifest",
  "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      // Schriften/Decoder für den PDF-Leser beim ersten Gebrauch mit ablegen
      if (res.ok && new URL(req.url).pathname.includes("/vendor/")) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match("index.html")))
  );
});
