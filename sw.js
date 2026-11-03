// Offline support: the app's own files load from cache and update in the
// background; data files and Strava always try the network first.
const CACHE = 'hub-v48';
const SHELL = ['./', 'index.html', 'home.html', 'theme.css', 'hub.css', 'olympic96.css', 'manifest.webmanifest', 'js/d3.min.js', 'js/config.js', 'js/strava.js', 'js/runtime.js', 'js/planner.js', 'js/hub.js', 'js/app.js', 'js/motion.js', 'js/desk.js', 'js/vendor/lenis.min.js', 'icons/mountain-192.png', 'road-book/', 'road-book/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'hub-prefs').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // Network first, so a new version shows on the next open; the saved copy is for offline.
  const key = url.search ? new Request(url.origin + url.pathname) : e.request;
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); } return r; })
    .catch(() => caches.match(key)));
});

// Rain alerts: Chrome wakes the installed app a few times a day; if tomorrow is a planned
// ride day with a 50%+ chance of rain, show one notification for that date.
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const rainCheck = async () => {
  const prefs = await caches.open('hub-prefs');
  const on = await prefs.match('/prefs/rain-alerts').then((r) => (r ? r.json() : { on: false })).catch(() => ({ on: false }));
  if (!on.on) return;
  const now = new Date();
  if (now.getHours() < 15) return;
  const t = new Date(now); t.setDate(t.getDate() + 1); t.setHours(12, 0, 0, 0);
  const tom = ymd(t);
  if (await prefs.match('/prefs/alerted-' + tom)) return;
  const m = new Date(t); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  const wk = await fetch('data/weeks/' + ymd(m) + '.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const p = wk && wk.days.find((d) => d.date === tom);
  const hi = p ? Math.max(0, ...String(p.target_miles).split('\u2013').map(Number).filter(Number.isFinite)) : 0;
  if (!p || p.intensity === 'Rest' || !hi || /^(done|skipped)$/i.test(String(p.status))) return;
  const j = await fetch('https://api.open-meteo.com/v1/forecast?latitude=33.75&longitude=-84.39&daily=precipitation_probability_max&timezone=America%2FNew_York&forecast_days=3').then((r) => r.json()).catch(() => null);
  const i = j ? j.daily.time.indexOf(tom) : -1;
  const pop = i >= 0 ? j.daily.precipitation_probability_max[i] : null;
  if (pop == null || pop < 50) return;
  await self.registration.showNotification('Rain likely tomorrow', { body: p.session + ' · ' + pop + '% chance of rain. Open the hub to swap it to a drier day.', tag: 'rain-' + tom, icon: 'icons/mountain-192.png', data: { url: './#training' } });
  await prefs.put('/prefs/alerted-' + tom, new Response('1'));
};
self.addEventListener('periodicsync', (e) => { if (e.tag === 'rain-check') e.waitUntil(rainCheck()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes(self.registration.scope));
    if (c) { c.focus(); return c.navigate ? c.navigate(url).catch(() => {}) : null; }
    return self.clients.openWindow(url);
  }));
});
