// OpsMatrix service worker — installability plus "always the newest build".
//
// Deliberately NETWORK-FIRST. A cache-first worker is the usual cause of an
// installed app showing yesterday's version, which is exactly the problem this
// is meant to solve: every launch fetches fresh, and the cache is only a
// fallback for when the tablet has no signal.
//
// Never touches anything but same-origin GETs — API calls to Anthropic and any
// POST go straight to the network, uncached.
const CACHE = "opsmatrix-v1";
const OFFLINE_FALLBACK = "./classic.html";

self.addEventListener("install", (event) => {
  // take over immediately rather than waiting for every tab to close
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_FALLBACK]).catch(() => undefined))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // never touch api.anthropic.com

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match(OFFLINE_FALLBACK) : undefined)
        )
      )
  );
});
