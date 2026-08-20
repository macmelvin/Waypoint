// Waypoint service worker — basic offline support.
//
// Scope, deliberately: this makes the APP SHELL (HTML/CSS/JS/icons) load
// instantly even with no signal, and lets a handful of read-only API
// responses (bus arrivals, weather, train alerts) show "last known" data
// when offline instead of failing outright. It does NOT and CANNOT make
// live search, routing, or fresh bus/weather data work offline — those
// genuinely need a connection to OneMap/OSRM/LTA/NEA, no amount of caching
// changes that.

// Bump this on every deploy that touches app.js/index.html/style.css. It's
// the only thing that reliably makes the browser notice the service worker
// itself changed (byte-diff of this file) and run a fresh install — which
// re-fetches the shell files and clears the old cache in activate() below.
// Without a bump, the fetch handler switching to network-first (see below)
// is the real fix for staleness, but bumping this too guarantees today's
// deploy self-heals immediately instead of waiting for a natural change.
const SHELL_CACHE = 'waypoint-shell-v2';
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

// Try the network first (so the shell/app code is always the latest deploy
// when you're online); fall back to the last cached copy only when the
// network call actually fails — that's the genuine "offline" case.
//
// This used to be stale-while-revalidate (serve cache instantly, refresh in
// the background). That's great for offline speed, but it meant a bug fix
// shipped to the server wasn't actually visible in the app until the SECOND
// reload after deploying — the first reload only refreshed the cache in the
// background while still serving the old, stale JS. That's confusing enough
// on its own, and it's exactly what made a just-shipped fix look like it
// hadn't taken effect. Network-first for the shell removes that footgun:
// online, you always get what's actually live; offline, you still get the
// last-known-good copy instantly.
function networkFirst(request, cacheName) {
  return fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        caches.open(cacheName).then((cache) => cache.put(request, networkResponse.clone()));
      }
      return networkResponse;
    })
    .catch(() => caches.open(cacheName).then((cache) => cache.match(request)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST (e.g. /api/erp-crossings)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let OSRM/OneMap/LTA/NEA calls pass through untouched

  if (url.pathname === '/' || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (CACHEABLE_API_PATHS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

// ---- Push notifications (MRT/LRT disruptions, major traffic incidents) -----
// The server sends a small JSON payload ({ title, body, url }) via Web Push;
// this just turns that into a real OS-level notification. On Android (the TWA
// app), this shows exactly like a native app notification since it's Chrome
// underneath.

self.addEventListener('push', (event) => {
  let data = { title: 'Waypoint', body: '' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Waypoint', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
