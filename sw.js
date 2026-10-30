// Offline support: the app's own files load from cache and update in the
// background; data files and Strava always try the network first.
const CACHE = 'hub-v3';
const SHELL = ['./', 'index.html', 'theme.css', 'hub.css', 'manifest.webmanifest', 'js/d3.min.js', 'js/config.js', 'js/strava.js', 'js/runtime.js', 'js/hub.js', 'js/app.js', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // Stale-while-revalidate for the app itself (ignore ?code= from Strava sign-in).
  const key = url.search ? new Request(url.origin + url.pathname) : e.request;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(key);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
