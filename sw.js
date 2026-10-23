// Monarch Compass service worker.
// App shell is cache-first from a versioned cache. VERSION is rewritten by `npm run build`
// (tools/stamp-sw.mjs) from a hash of the shell files, so any change to them ships a new
// worker; the page then shows an "Update available" toast and reloads when the user agrees.
const VERSION = "e8907000122c";
const SHELL = [
  "./",
  "index.html",
  "js/engine.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];
const CACHE = "monarch-compass-shell-" + VERSION;
const FONTS = "monarch-compass-fonts-v1";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith("monarch-compass-shell-") && k !== CACHE).map(k => caches.delete(k)))));
});

// The page asks the waiting worker to take over after the user taps Reload.
self.addEventListener("message", e => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const key = req.mode === "navigate" ? "index.html" : req;
    e.respondWith(caches.open(CACHE)
      .then(c => c.match(key, { ignoreSearch: true }))
      .then(hit => hit || fetch(req)));
    return;
  }

  // Google Fonts: cache on first use so the page keeps its fonts offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }))));
  }
});
