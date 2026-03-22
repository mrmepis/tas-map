// sw.js — Service Worker for Tasmania Dwelling Map PWA
// Caches: app shell (HTML, Leaflet CSS/JS) + map tiles on-the-fly

const CACHE_VERSION = 'tas-map-v5';
const TILE_CACHE = 'tas-tiles-v1';

// App shell: files needed for the map to work offline
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// Tile URL patterns to cache
const TILE_PATTERNS = [
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org',
  'tile.opentopomap.org',
];

// Max tiles to cache (prevent storage blowout)
const MAX_TILES = 2000;

// ── Install: cache app shell ────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_VERSION && n !== TILE_CACHE)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fallback to network ────────────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Is this a tile request?
  const isTile = TILE_PATTERNS.some((pat) => url.includes(pat));

  if (isTile) {
    // Tiles: cache-first with network fallback, then store
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;

          return fetch(event.request).then((response) => {
            if (response && response.ok) {
              // Store tile, but enforce max cache size
              const cloned = response.clone();
              cache.keys().then((keys) => {
                if (keys.length < MAX_TILES) {
                  cache.put(event.request, cloned);
                }
              });
            }
            return response;
          }).catch(() => {
            // Offline and no cached tile — return a transparent 1x1 PNG
            return new Response(
              Uint8Array.from(atob(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
                'Nl7BcQAAAABJRU5ErkJggg=='
              ), c => c.charCodeAt(0)),
              { headers: { 'Content-Type': 'image/png' } }
            );
          });
        })
      )
    );
  } else {
    // App shell: cache-first
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).catch(() => {
          // If offline and not cached, return the index page for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        })
      )
    );
  }
});

// ── Message handler: pre-cache tiles on demand ──────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE_TILES') {
    const urls = event.data.urls || [];
    caches.open(TILE_CACHE).then((cache) => {
      let cached = 0;
      const total = urls.length;

      function next(i) {
        if (i >= total) {
          event.source.postMessage({ type: 'PRECACHE_DONE', cached, total });
          return;
        }
        cache.match(urls[i]).then((existing) => {
          if (existing) {
            cached++;
            event.source.postMessage({ type: 'PRECACHE_PROGRESS', cached, total });
            next(i + 1);
          } else {
            fetch(urls[i]).then((resp) => {
              if (resp && resp.ok) {
                cache.put(urls[i], resp);
              }
              cached++;
              event.source.postMessage({ type: 'PRECACHE_PROGRESS', cached, total });
              // Small delay to avoid hammering tile servers
              setTimeout(() => next(i + 1), 50);
            }).catch(() => {
              next(i + 1);
            });
          }
        });
      }
      next(0);
    });
  }

  if (event.data && event.data.type === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE).then(() => {
      event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});
