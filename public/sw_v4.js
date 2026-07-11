// ════════════════════════════════════════════════════════════════════════════
// KIMATEY FLOW NAVIGATOR — Service Worker v3.0 — Architecture Offline-First
// ════════════════════════════════════════════════════════════════════════════

const SW_VERSION = "kfn-v3.0";
const CACHE_APP  = "kfn-app-v3";
const CACHE_TILES = "kfn-tiles-v1";
const CACHE_API  = "kfn-api-v1";

// Assets core à mettre en cache immédiatement
const CORE_ASSETS = [
  "/", "/index.html", "/manifest.json", "/sw_v4.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

// Tuiles OSM — Grand Abidjan (zoom 10-16)
// Pré-cache les tuiles des zones principales
const ABIDJAN_TILES = [];
function genTiles(zoom, latMin, latMax, lonMin, lonMax) {
  const n = Math.pow(2, zoom);
  const xMin = Math.floor((lonMin + 180) / 360 * n);
  const xMax = Math.floor((lonMax + 180) / 360 * n);
  const yMin = Math.floor((1 - Math.log(Math.tan(latMax*Math.PI/180) + 1/Math.cos(latMax*Math.PI/180)) / Math.PI) / 2 * n);
  const yMax = Math.floor((1 - Math.log(Math.tan(latMin*Math.PI/180) + 1/Math.cos(latMin*Math.PI/180)) / Math.PI) / 2 * n);
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      ABIDJAN_TILES.push(`https://a.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
    }
  }
}
// Abidjan étendu : lat 5.1-5.6 / lon -4.3 à -3.7
genTiles(10, 5.1, 5.6, -4.3, -3.7);   // ~6 tuiles zoom 10
genTiles(11, 5.1, 5.6, -4.3, -3.7);   // ~12 tuiles zoom 11
genTiles(12, 5.15, 5.55, -4.2, -3.8); // ~48 tuiles zoom 12
genTiles(13, 5.2, 5.5, -4.15, -3.85); // ~80 tuiles zoom 13

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    Promise.all([
      // Cache core app
      caches.open(CACHE_APP).then(c => {
        return c.addAll(CORE_ASSETS).catch(err => console.log("Core cache partial:", err));
      }),
      // Cache tuiles Abidjan
      caches.open(CACHE_TILES).then(async c => {
        let cached = 0;
        for (const url of ABIDJAN_TILES) {
          try {
            const resp = await fetch(url, {mode:"cors"});
            if (resp.ok) { await c.put(url, resp); cached++; }
          } catch(e) {}
          if (cached % 10 === 0) {
            self.clients.matchAll().then(clients => {
              clients.forEach(cl => cl.postMessage({
                type:"TILES_PROGRESS",
                cached, total:ABIDJAN_TILES.length,
                pct: Math.round(cached/ABIDJAN_TILES.length*100)
              }));
            });
          }
        }
        console.log(`[KFN SW] ${cached}/${ABIDJAN_TILES.length} tuiles Abidjan mises en cache`);
      }),
    ])
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_APP && k !== CACHE_TILES && k !== CACHE_API)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH — Stratégie par type de ressource ────────────────────────────────
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // 1. Tuiles OSM → Cache-first puis réseau
  if (url.hostname.includes("tile.openstreetmap.org")) {
    e.respondWith(tileStrategy(e.request));
    return;
  }

  // 2. Nominatim (recherche) → Réseau puis cache API
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    e.respondWith(apiStrategy(e.request, CACHE_API));
    return;
  }

  // 3. OSRM (routing) → Réseau puis cache API
  if (url.hostname.includes("router.project-osrm.org")) {
    e.respondWith(apiStrategy(e.request, CACHE_API));
    return;
  }

  // 4. Firebase → Réseau uniquement (données temps réel)
  if (url.hostname.includes("firebase") || url.hostname.includes("firebaseio")) {
    e.respondWith(fetch(e.request).catch(() => new Response("{}", {headers:{"Content-Type":"application/json"}})));
    return;
  }

  // 5. Assets app → Cache-first
  e.respondWith(appStrategy(e.request));
});

// ─── Stratégies cache ────────────────────────────────────────────────────────
async function tileStrategy(req) {
  const cache = await caches.open(CACHE_TILES);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req, {mode:"cors"});
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch(e) {
    // Tuile manquante offline → tuile transparente
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect fill="#1a2a3a" width="256" height="256"/></svg>',
      {headers:{"Content-Type":"image/svg+xml"}}
    );
  }
}

async function apiStrategy(req, cacheName) {
  try {
    const res = await fetch(req, {signal: AbortSignal.timeout(5000)});
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch(e) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({offline:true, results:[]}),
      {headers:{"Content-Type":"application/json"}});
  }
}

async function appStrategy(req) {
  const cache = await caches.open(CACHE_APP);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch(e) {
    return cached || new Response("Offline", {status: 503});
  }
}

// ─── Message depuis l'app ────────────────────────────────────────────────────
self.addEventListener("message", e => {
  if (e.data?.type === "CACHE_ZONE") {
    // L'app demande de mettre en cache une zone spécifique
    const {lat, lon, radius} = e.data;
    cacheZone(lat, lon, radius);
  }
  if (e.data?.type === "GET_CACHE_STATUS") {
    getCacheStatus().then(status => {
      e.source.postMessage({type:"CACHE_STATUS", ...status});
    });
  }
});

async function cacheZone(lat, lon, radius) {
  const tiles = [];
  for (let z = 14; z <= 16; z++) {
    const n = Math.pow(2, z);
    const deg = radius / 111000;
    genTilesForArea(z, lat-deg, lat+deg, lon-deg, lon+deg, tiles);
  }
  const cache = await caches.open(CACHE_TILES);
  for (const url of tiles.slice(0, 200)) {
    try {
      const res = await fetch(url, {mode:"cors"});
      if (res.ok) await cache.put(url, res);
    } catch(e) {}
  }
}

function genTilesForArea(zoom, latMin, latMax, lonMin, lonMax, arr) {
  const n = Math.pow(2, zoom);
  const xMin = Math.floor((lonMin + 180) / 360 * n);
  const xMax = Math.floor((lonMax + 180) / 360 * n);
  const yMin = Math.floor((1 - Math.log(Math.tan(latMax*Math.PI/180) + 1/Math.cos(latMax*Math.PI/180)) / Math.PI) / 2 * n);
  const yMax = Math.floor((1 - Math.log(Math.tan(latMin*Math.PI/180) + 1/Math.cos(latMin*Math.PI/180)) / Math.PI) / 2 * n);
  for (let x = xMin; x <= xMax; x++)
    for (let y = yMin; y <= yMax; y++)
      arr.push(`https://a.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
}

async function getCacheStatus() {
  const tileCache = await caches.open(CACHE_TILES);
  const appCache  = await caches.open(CACHE_APP);
  const tileKeys  = await tileCache.keys();
  const appKeys   = await appCache.keys();
  return {
    tiles: tileKeys.length,
    app: appKeys.length,
    ready: appKeys.length > 0
  };
}

// ─── REFRESH_TILES — Mise à jour forcée des cartes ───────────────────────
self.addEventListener("message", e => {
  if (e.data?.type === "REFRESH_TILES") {
    refreshTiles(e.data.zones || []);
  }
  if (e.data?.type === "CACHE_ZONE") {
    const {lat, lon, radius} = e.data;
    cacheZone(lat, lon, radius);
  }
  if (e.data?.type === "GET_CACHE_STATUS") {
    getCacheStatus().then(status => {
      e.source.postMessage({type:"CACHE_STATUS", ...status});
    });
  }
});

async function refreshTiles(zones) {
  const cache = await caches.open(CACHE_TILES);
  let refreshed = 0;

  for (const zone of zones) {
    const tiles = [];
    const zooms = zone.zooms || [10,11,12,13];
    zooms.forEach(z => genTilesForArea(z, zone.latMin, zone.latMax, zone.lonMin, zone.lonMax, tiles));

    for (const url of tiles) {
      try {
        // Force le rechargement depuis le réseau (pas de cache)
        const res = await fetch(url, {
          mode: "cors",
          cache: "reload" // Force le rechargement
        });
        if (res.ok) {
          await cache.put(url, res);
          refreshed++;
        }
      } catch(e) {}
    }
  }

  // Notifie l'app
  const clients = await self.clients.matchAll();
  clients.forEach(cl => cl.postMessage({
    type: "TILES_REFRESHED",
    count: refreshed,
    timestamp: Date.now()
  }));

  console.log(`[KFN SW] ${refreshed} tuiles rafraîchies`);
}
