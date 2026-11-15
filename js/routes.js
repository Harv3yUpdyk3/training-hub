// Route Picker: where to ride today. Groups Will's own Strava rides into routes,
// picks the ones that fit the plan's miles for the next ride day, and orders them
// by the forecast wind so the way home has the tailwind.
(() => {
  const KEY = 'hub.routes.v1';
  // Shared rules from hub.js and config.js (loaded first).
  const MI = KM_MI * 1000, FT = M_FT;
  const { lat: LAT, lng: LNG } = window.HUB_CONFIG.home;
  const MAX_AGE = 6 * 3600e3;
  const card = document.getElementById('route-card');
  if (!card) return;
  const box = card.querySelector('[data-routes]');
  const sub = card.querySelector('[data-routes-when]');

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const imp = () => !!document.querySelector('.hub.imp');

  // ---- Geometry -----------------------------------------------------------
  const decode = (str) => {
    const pts = []; let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < str.length);
        const v = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += v; else lng += v;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  };
  const rad = (d) => d * Math.PI / 180;
  const dist = (a, b) => {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 12742e3 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const bearing = (a, b) => {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  // n points evenly spaced along the line.
  const resample = (pts, n) => {
    if (pts.length < 2) return pts.slice();
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1] || 1;
    const out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const t = total * k / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < t) j++;
      const f = (t - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
    }
    return out;
  };
  const gap = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += dist(a[i], b[i]); return s / a.length; };
  const median = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  // ---- Route library --------------------------------------------------------
  const GENERIC = /^(morning|afternoon|evening|night|lunch) (ride|gravel ride)$/i;
  const build = (rides) => {
    const ok = rides.filter((r) => /^(Ride|GravelRide|MountainBikeRide)$/.test(r.sport_type) && r.d >= 6000)
      .map((r) => ({ ...r, pts: decode(r.pl) })).filter((r) => r.pts.length >= 2);
    if (!ok.length) return { routes: [], rides: 0, hour: 15 };
    // Home: where most rides start. Rides that start far from it (trips) stay out.
    const home = [median(ok.map((r) => r.pts[0][0])), median(ok.map((r) => r.pts[0][1]))];
    const local = ok.filter((r) => dist(r.pts[0], home) < 25e3);
    const clusters = [];
    for (const r of local) { // newest first, so each route's outline is its latest ride
      const sig = resample(r.pts, 32);
      const rev = sig.slice().reverse();
      const hit = clusters.find((c) => Math.abs(c.d - r.d) / c.d < 0.12 && Math.min(gap(sig, c.sig), gap(rev, c.sig)) < 400);
      if (hit) hit.rides.push(r);
      else clusters.push({ d: r.d, sig, rides: [r] });
    }
    const routes = clusters.map((c) => {
      const rep = c.rides[0];
      const pts = resample(rep.pts, 72).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
      const start = pts[0], end = pts[pts.length - 1];
      let far = start, fd = 0;
      pts.forEach((p) => { const x = dist(start, p); if (x > fd) { fd = x; far = p; } });
      const counts = {};
      c.rides.forEach((r) => { if (!GENERIC.test(r.name.trim())) counts[r.name.trim()] = (counts[r.name.trim()] || 0) + 1; });
      const named = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return {
        name: named ? named[0] : null,
        n: c.rides.length,
        last: rep.start_local.slice(0, 10),
        id: rep.id,
        d: median(c.rides.map((r) => r.d)),
        eg: median(c.rides.map((r) => r.eg || 0)),
        loop: dist(start, end) < 1500,
        out: bearing(start, far),
        reach: fd,
        pts,
      };
    });
    const hour = Math.round(median(local.slice(0, 25).map((r) => Number(r.start_local.slice(11, 13)) + Number(r.start_local.slice(14, 16)) / 60))) || 15;
    return { routes, rides: local.length, hour, home };
  };

  let lib = store.get(KEY);
  let loading = null;
  const refresh = (force) => {
    if (!window.strava || !window.strava.ready()) return Promise.resolve(lib);
    if (!force && lib && Date.now() - lib.at < MAX_AGE) return Promise.resolve(lib);
    loading = loading || window.strava.call('route_rides').then((rides) => {
      lib = { at: Date.now(), ...build(rides) };
      store.set(KEY, lib);
      return lib;
    }).finally(() => { loading = null; });
    return loading;
  };

  // ---- The next ride day from the plan ------------------------------------
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  // Plan targets via the planner's own parser; "55+" (which it skips) means at least 55.
  const range = (s) => {
    const plus = String(s || '').match(/^\s*(\d+)\s*\+/);
    if (plus) return [Number(plus[1]), Number(plus[1]) * 1.25];
    const n = window.planner.miles(s);
    if (!n.length || !n.some((x) => x > 0)) return null;
    if (n.length >= 2) { const lo = Math.min(n[0], n[1]), hi = Math.max(n[0], n[1]); return [lo > 0 ? lo : Math.round(hi * 0.6), hi]; } // "0–12": an optional ride, so aim for most of it
    return [n[0] * 0.85, n[0] * 1.15];
  };
  const nextRide = async () => {
    const P = window.planner;
    if (!P) return null;
    const now = new Date();
    const today = ymd(now);
    const late = now.getHours() >= 19;
    for (const off of [0, 7]) {
      const mon = P.addDays ? P.addDays(P.monday(now), off) : null;
      const wk = await P.loadWeek(mon || P.monday(now)).catch(() => null);
      if (!wk || !wk.days) continue;
      for (const d of wk.days) {
        if (d.date < today || (d.date === today && late)) continue;
        if (d.status === 'Done' || d.status === 'Skipped') continue;
        const r = range(d.target_miles);
        if (r && d.intensity !== 'Rest') return { ...d, r };
      }
    }
    return null;
  };

  // ---- Wind for the ride window --------------------------------------------
  let wind = null;
  const windAt = async (date, hour) => {
    wind = wind || fetch('https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LNG
      + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation_probability'
      + '&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=auto&forecast_days=16')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Open-Meteo ' + r.status))));
    const j = await wind;
    const h = j.hourly;
    const idx = [];
    h.time.forEach((t, i) => { const hr = Number(t.slice(11, 13)); if (t.slice(0, 10) === date && hr >= hour && hr < hour + 3) idx.push(i); });
    if (!idx.length) return null;
    let u = 0, v = 0, sp = 0, gu = 0, tp = 0, pp = 0;
    idx.forEach((i) => {
      const s = h.wind_speed_10m[i], dir = rad(h.wind_direction_10m[i]);
      u += s * Math.sin(dir); v += s * Math.cos(dir); sp += s; gu = Math.max(gu, h.wind_gusts_10m[i] || 0);
      tp += h.temperature_2m[i]; pp = Math.max(pp, h.precipitation_probability[i] || 0);
    });
    return { from: (Math.atan2(u, v) * 180 / Math.PI + 360) % 360, mph: sp / idx.length, gust: gu, temp_f: tp / idx.length, pop: pp };
  };

  // ---- Picking ------------------------------------------------------------
  const pick = (routes, r, w) => {
    const mid = (r[0] + r[1]) / 2;
    // Coming up short costs more than riding a bit long: every mile counts toward the goals.
    const fitOf = (mi) => (mi >= r[0] && mi <= r[1] ? 1 : mi < r[0] ? Math.max(0, 1 - (r[0] - mi) / (0.25 * mid)) : Math.max(0, 1 - (mi - r[1]) / (0.5 * mid)));
    return routes.map((rt) => {
      const mi = rt.d / MI;
      let laps = 1, fit = fitOf(mi);
      if (r[0] >= ED_GOAL_MI - 5 && mi < ED_GOAL_MI) fit *= 0.5; // a long day should be an Eddington day
      if (fit < 0.75 && mi <= 16 && fitOf(mi * 2) === 1 && rt.loop) { laps = 2; fit = 0.85; }
      let align = 0, windScore = 0.5;
      if (w && w.mph >= 4 && rt.reach > 1500) {
        align = Math.cos(rad(rt.out - w.from));
        windScore = (align + 1) / 2;
      }
      const fam = Math.min(1, rt.n / 6);
      return { ...rt, laps, fit, align, score: fit * 0.6 + windScore * 0.25 + fam * 0.15 };
    }).filter((x) => x.fit > 0.35).sort((a, b) => b.score - a.score);
  };

  // ---- Drawing ------------------------------------------------------------
  const band = (mi) => (mi < 15 ? 1 : mi < 30 ? 2 : mi < 45 ? 3 : mi < ED_GOAL_MI ? 4 : mi < 100 ? 5 : 6);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const outline = (rt, w) => {
    const S = 100, pad = 10;
    const lat0 = rt.pts[0][0], k = Math.cos(rad(lat0));
    const xy = rt.pts.map(([a, b]) => [b * k, -a]);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1e-4;
    const sc = (S - 2 * pad) / span;
    const ox = (S - (Math.max(...xs) - x0) * sc) / 2, oy = (S - (Math.max(...ys) - y0) * sc) / 2;
    const P = xy.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc]);
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'rp-map', role: 'img', 'aria-label': 'Route outline' });
    svg.append(svgEl('path', { d: 'M' + P.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: 'rp-line', style: `stroke: var(--band-${band(rt.d / MI)})` }));
    const s = P[0];
    svg.append(svgEl('circle', { cx: s[0].toFixed(1), cy: s[1].toFixed(1), r: 4.2, class: 'rp-start' }));
    if (w && w.mph >= 4) {
      // Arrow shows where the wind blows to, in the top-right corner.
      const g = svgEl('g', { transform: `translate(88 12) rotate(${(w.from + 180) % 360})`, class: 'rp-wind' });
      g.append(svgEl('path', { d: 'M0 7V-3M-4 0 0-7 4 0' }));
      svg.append(g);
    }
    return svg;
  };
  const mapsLink = (rt) => {
    const f = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
    const pts = rt.pts, n = pts.length;
    const way = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => pts[Math.round(i * (n - 1) / 9)]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=' + f(pts[0]) + '&destination=' + f(rt.loop ? pts[0] : pts[n - 1])
      + '&waypoints=' + encodeURIComponent(way.map(f).join('|'));
  };
  const fmtDist = (m) => (imp() ? (m / MI).toFixed(m / MI < 20 ? 1 : 0) + ' mi' : (m / 1000).toFixed(m < 32e3 ? 1 : 0) + ' km');
  const fmtUp = (m) => (imp() ? Math.round(m / FT).toLocaleString() + ' ft' : Math.round(m) + ' m');
  const fmtWind = (mph) => (imp() ? Math.round(mph) + ' mph' : Math.round(mph * 1.609344) + ' km/h');
  const fmtRange = (r) => (imp() ? r.map((x) => Math.round(x)).join('–') + ' mi' : r.map((x) => Math.round(x * 1.609344)).join('–') + ' km');
  const fmtHour = (h) => { const hh = Math.floor(h); return (hh % 12 || 12) + (hh < 12 ? ' am' : ' pm'); };
  const dayName = (date) => {
    const t = ymd(new Date());
    const tm = ymd(new Date(Date.now() + 864e5));
    return date === t ? 'Today' : date === tm ? 'Tomorrow' : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  };
  const windText = (x, w) => {
    if (!w || w.mph < 4) return { t: 'Calm wind, any direction works', c: 'calm' };
    if (x.reach <= 1500) return { t: 'Short loop, wind barely matters', c: 'calm' };
    if (x.align > 0.45) return { t: 'Headwind out, tailwind home', c: 'good' };
    if (x.align < -0.45) return { t: 'Tailwind out, headwind home', c: 'bad' };
    return { t: 'Mostly crosswind', c: 'calm' };
  };
  const ago = (date) => {
    const days = Math.round((Date.now() - Date.parse(date + 'T12:00:00')) / 864e5);
    return days <= 1 ? 'ridden yesterday' : days < 14 ? 'last ridden ' + days + ' days ago' : days < 60 ? 'last ridden ' + Math.round(days / 7) + ' weeks ago' : 'last ridden ' + Math.round(days / 30) + ' months ago';
  };

  let showAll = false;
  let last = null;
  const state = (msg) => { box.replaceChildren(el('p', 'note', msg)); };

  const render = async () => {
    if (!window.strava || !window.strava.ready()) { state('Connect Strava to see your routes.'); sub.textContent = ''; return; }
    if (!lib) state('Loading your routes…');
    try { await refresh(false); } catch (e) { if (!lib) { state('Couldn’t load your routes. Tap Sync to try again.'); return; } }
    if (!lib || !lib.routes.length) { state('Nothing here yet: ride a few loops from home and they show up here.'); return; }
    const day = await nextRide().catch(() => null);
    const r = day ? day.r : [15, 25];
    const date = day ? day.date : ymd(new Date());
    const w = await windAt(date, lib.hour).catch(() => null);
    last = { day, r, date, w };
    const list = pick(lib.routes, r, w);

    sub.textContent = '';
    const head = el('div', 'rp-head');
    const when = el('p', 'rp-for');
    when.append(el('b', null, day ? dayName(date) + ': ' + day.session : 'No ride planned'), document.createTextNode(' · ' + fmtRange(r)));
    head.append(when);
    if (w) {
      const wx = el('p', 'rp-wx');
      wx.append(el('span', 'rp-wdir', w.mph >= 4 ? compass(w.from) + ' ' + fmtWind(w.mph) : 'Calm'),
        document.createTextNode(' at ' + fmtHour(lib.hour) + (w.gust >= w.mph + 8 ? ', gusts ' + fmtWind(w.gust) : '') + ' · ' + Math.round(imp() ? w.temp_f : (w.temp_f - 32) * 5 / 9) + '°' + (w.pop >= 30 ? ' · rain ' + Math.round(w.pop) + '%' : '')));
      head.append(wx);
    }
    const rows = el('div', 'rp-list');
    const shown = list.slice(0, showAll ? 8 : 3);
    // On a 55+ day, make sure one Eddington route is in view.
    if (!showAll && r[1] >= ED_GOAL_MI - 5 && !shown.some((x) => x.d / MI >= ED_GOAL_MI)) {
      const ed = list.find((x) => x.d / MI >= ED_GOAL_MI);
      if (ed) shown[shown.length - 1] = ed;
    }
    if (!shown.length) {
      rows.append(el('p', 'note', 'None of your routes fit ' + fmtRange(r) + '. Ride a shorter loop twice, or add an out-and-back to your nearest favourite.'));
    }
    shown.forEach((x, i) => {
      const row = el('article', 'rp-row' + (i === 0 ? ' top' : ''));
      row.append(outline(x, w));
      const body = el('div', 'rp-body');
      const nm = el('h3', 'rp-name', x.name || (x.loop ? 'Loop' : 'Route') + ' to the ' + compass(x.out));
      body.append(nm);
      body.append(el('p', 'rp-meta', fmtDist(x.d * x.laps) + ' · ' + fmtUp(x.eg * x.laps) + ' up · ' + x.n + (x.n === 1 ? ' ride' : ' rides') + ', ' + ago(x.last)));
      const chips = el('p', 'rp-chips');
      const wt = windText(x, w);
      chips.append(el('span', 'rp-chip ' + wt.c, wt.t));
      if (x.laps === 2) chips.append(el('span', 'rp-chip calm', 'Ride it twice'));
      if (x.d * x.laps / MI >= ED_GOAL_MI) chips.append(el('span', 'rp-chip ed', '★ Eddington day'));
      if (i === 0) chips.append(el('span', 'rp-chip best', 'Best pick'));
      body.append(chips);
      const a = el('a', 'rp-go', 'Ride this');
      a.href = mapsLink(x); a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Open ' + nm.textContent + ' in Google Maps');
      body.append(a);
      row.append(body);
      rows.append(row);
    });
    const foot = el('div', 'rp-foot');
    foot.append(el('p', 'note', lib.routes.length + ' routes from your last ' + lib.rides + ' rides from home. The arrow shows where the wind blows; wind from Open-Meteo.'));
    if (list.length > 3) {
      const more = el('button', 'share-btn', showAll ? 'Fewer' : 'More routes (' + Math.min(8, list.length) + ')');
      more.type = 'button';
      more.addEventListener('click', () => { showAll = !showAll; render(); });
      foot.append(more);
    }
    box.replaceChildren(head, rows, foot);
  };

  document.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));
  const sync = document.getElementById('sync');
  if (sync) sync.addEventListener('click', () => { if (lib) lib.at = 0; wind = null; setTimeout(render, 1500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.hubRoutes = { render, build, pick, decode };
  // Let the plan load first.
  setTimeout(render, 600);
})();
