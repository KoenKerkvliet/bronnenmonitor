// Service worker: zorgt dat het dashboard als app te installeren is en zonder verbinding opstart.
//
// - Eigen bestanden (HTML, CSS, JS): eerst netwerk, bij geen verbinding uit de cache.
//   Zo krijg je na een wijziging altijd meteen de nieuwe versie.
// - supabase-js van de CDN en de Google Fonts: uit de cache (veranderen niet).
// - Supabase zelf (je data en inloggen): nooit cachen, altijd rechtstreeks.
//
// Pas CACHE aan als je bestanden toevoegt of verwijdert uit de lijst hieronder.
const CACHE = "bronnenmonitor-v4";
const CACHE_FIRST_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon-32.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Oude caches opruimen
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Data en inloggen: nooit via de cache
  if (url.hostname.endsWith(".supabase.co")) return;

  // Bibliotheken en lettertypen: cache eerst
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
    return;
  }

  // Eigen bestanden: netwerk eerst, cache als terugval
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("./index.html")))
    );
  }
});
