// ════════════════════════════════════════════════════════════════════════════
// KIMATEY FLOW NAVIGATOR — Service Worker (Next.js) — Offline-first
// Remplace l'ancien sw_v4.js. Stratégies par type de ressource, adaptées à
// l'app shell Next.js (assets /_next/static/ hashés) tout en conservant la
// logique métier (tuiles carto, géocodage Nominatim, routage OSRM).
// ════════════════════════════════════════════════════════════════════════════

const VERSION = "kfn-next-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const API_CACHE = `${VERSION}-api`;
const TILE_CACHE = "kfn-tiles-v1";

// Assets à pré-cacher à l'installation (best-effort : un échec ne bloque pas).
const PRECACHE_URLS = [
  "/",
  "/dashboard",
  "/live",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
];

const KEEP = [SHELL_CACHE, RUNTIME_CACHE, API_CACHE, TILE_CACHE];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // allSettled : ne pas faire échouer l'install si une ressource CDN 404/opaque
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────
const isTile = (url) =>
  /tile\.openstreetmap\.org|basemaps\.cartocdn\.com/.test(url.hostname);
const isGeoApi = (url) =>
  /nominatim\.openstreetmap\.org|router\.project-osrm\.org/.test(url.hostname);
const isStaticCdn = (url) =>
  /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com/.test(
    url.hostname
  );
const isRealtime = (url) =>
  /firebase|firebaseio|firebasedatabase\.app/.test(url.hostname);

async function cacheFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  } catch (err) {
    if (fallback) return fallback(request);
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.open(SHELL_CACHE);
      const home = await shell.match("/");
      if (home) return home;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

// Tuile transparente/sombre quand une tuile manque hors-ligne (comme l'original).
function tileFallback() {
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect fill="#0B2E2A" width="256" height="256"/></svg>',
    { headers: { "Content-Type": "image/svg+xml" } }
  );
}

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // écritures (POST) → réseau direct
  const url = new URL(request.url);

  // Données temps réel & proxies IA → jamais de cache
  if (isRealtime(url)) return;
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // Cartes → cache-first (offline maps)
  if (isTile(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, tileFallback));
    return;
  }
  // Géocodage / routage → réseau puis cache
  if (isGeoApi(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }
  // Polices & libs CDN → stale-while-revalidate
  if (isStaticCdn(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Même origine
  if (url.origin === self.location.origin) {
    // Chunks Next.js (hashés) → cache-first
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }
    // Navigations → réseau puis cache (offline : dernière page ou accueil)
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    // Autres (legacy js, icônes, manifest…) → stale-while-revalidate
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Autres GET cross-origin → réseau puis cache
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ─── Messages (mise à jour immédiate) ────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
