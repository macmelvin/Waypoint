// Waypoint service worker — basic offline support.
//
// Scope, deliberately: this makes the APP SHELL (HTML/CSS/JS/icons) load
// instantly even with no signal, and lets a handful of read-only API
// responses (bus arrivals, weather, train alerts) show "last known" data
// when offline instead of failing outright. It does NOT and CANNOT make
// live search, routing, or fresh bus/weather data work offline — those
// genuinely need a connection to OneMap/OSRM/LTA/NEA, no amount of caching
// changes that.

const SHELL_CACHE = 'waypoint-shell-v1';
const RUNTIME_CACHE = 'waypoint-runtime-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Only these GET API paths get cached for offline fallback — deliberately a
// short list of "nice to see stale" data, not everything, so we don't cache
// stuff that's misleading when stale (e.g. never cache directions/search).
const CACHEABLE_API_PATHS = ['/api/weather-nearby', '/api/weather-today', '/api/bus-arrivals', '/api/train-alerts'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Serve the shell from cache instantly, but always re-fetch in the
// background and update the cache — so it opens instantly offline AND
// self-updates whenever you're online, without needing a version bump on
// every deploy.
function staleWhileRevalidate(request) {
  return caches.open(SHELL_CACHE).then((cache) => cache.match(request).then((cached) => {
    const fetchPromise = fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) cache.put(request, networkResponse.clone());
        return networkResponse;
      })
      .catch(() => cached);
    return cached || fetchPromise;
  }));
}

// Try the network first (so data is always fresh when online); fall back to
// the last cached response only when the network call fails.
function networkFirst(request) {
  return fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, networkResponse.clone()));
      }
      return networkResponse;
    })
    .catch(() => caches.open(RUNTIME_CACHE).then((cache) => cache.match(request)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST (e.g. /api/erp-crossings)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let OSRM/OneMap/LTA/NEA calls pass through untouched

  if (url.pathname === '/' || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (CACHEABLE_API_PATHS.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
