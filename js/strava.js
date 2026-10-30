// Strava, straight from the phone. Sign-in uses Will's own Strava API app; the
// Client ID and Secret are typed in once and stay in this browser's storage.
// `strava.call(tool, args)` answers in the same shape as the Strava connector
// the hub was built on, so the hub's loaders work unchanged.
(() => {
  const AUTH_KEY = 'hub.strava';
  const API = 'https://www.strava.com/api/v3';
  const SCOPE = 'read,activity:read_all,profile:read_all';
  const MI = 1609.344, FT = 0.3048;

  const store = {
    get: (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {
        // Storage full: drop cached ride details (they can be fetched again) and retry once.
        try {
          Object.keys(localStorage).filter((x) => /^hub\.(perf|str)\./.test(x)).forEach((x) => localStorage.removeItem(x));
          localStorage.setItem(k, JSON.stringify(v));
        } catch {}
      }
    },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  const auth = () => store.get(AUTH_KEY, {});

  // A second copy of the sign-in in IndexedDB, so the phone clearing one store
  // doesn't mean typing the Client ID and Secret again.
  const idb = (mode, fn) => new Promise((res) => {
    try {
      const open = indexedDB.open('hub', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => res(null);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => res(null);
      };
    } catch { res(null); }
  });
  const backup = () => idb('readwrite', (os) => os.put(auth(), AUTH_KEY));
  const setAuth = (v) => { store.set(AUTH_KEY, v); backup(); };
  const redirectUri = () => location.origin + location.pathname;

  const connectErr = (msg) => Object.assign(new Error(msg), { code: 'connect' });

  // Token exchange and refresh go straight to Strava from the browser.
  const tokenCall = async (body) => {
    const a = auth();
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: a.clientId, client_secret: a.clientSecret, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw connectErr('Strava sign-in failed: ' + (j.message || r.status));
    setAuth({ ...auth(), access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, athlete: j.athlete ? { id: j.athlete.id, firstname: j.athlete.firstname } : a.athlete });
  };

  let refreshing = null;
  const token = async () => {
    const a = auth();
    if (!a.refresh_token) throw connectErr('Not connected to Strava');
    if (!a.access_token || (a.expires_at || 0) - 300 < Date.now() / 1000) {
      refreshing = refreshing || tokenCall({ grant_type: 'refresh_token', refresh_token: a.refresh_token }).finally(() => { refreshing = null; });
      await refreshing;
    }
    return auth().access_token;
  };

  // At most four requests at once, so a first load doesn't burst the rate limit.
  let active = 0;
  const queue = [];
  const slot = () => new Promise((res) => { if (active < 4) { active += 1; res(); } else queue.push(res); });
  const release = () => { const next = queue.shift(); if (next) next(); else active -= 1; };

  let calls = 0;
  const api = async (path) => {
    await slot();
    try {
      const get = async () => { calls += 1; return fetch(API + path, { headers: { Authorization: 'Bearer ' + (await token()) } }); };
      let r = await get();
      if (r.status === 401) {
        // Token expired early or was revoked: refresh once and retry.
        store.set(AUTH_KEY, { ...auth(), access_token: null });
        r = await get();
        if (r.status === 401) throw connectErr('Strava sign-in expired. Connect again.');
      }
      if (r.status === 429) throw new Error('Strava rate limit reached. Try again in 15 minutes.');
      if (!r.ok) throw new Error('Strava ' + r.status + ' on ' + path.split('?')[0]);
      // Segment effort ids are bigger than JavaScript numbers hold: keep long ids as text.
      const text = await r.text();
      return JSON.parse(text.replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"'));
    } finally { release(); }
  };

  // ---- Activities -------------------------------------------------------
  const weather = fetch('data/weather.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

  const toSummary = (a) => ({
    id: String(a.id),
    name: a.name,
    sport_type: a.sport_type || a.type,
    start_local: String(a.start_date_local || '').replace('Z', ''),
    gear_id: a.gear_id ? String(a.gear_id).replace(/^b/, '') : null,
    d: a.distance, mt: a.moving_time, et: a.elapsed_time, eg: a.total_elevation_gain,
    re: a.suffer_score ?? null, cal: a.calories ?? null, cad: a.average_cadence ?? null,
    as: a.average_speed, ms: a.max_speed, k: a.kudos_count, ac: a.achievement_count, pr: a.pr_count,
  });
  const toMcp = (s, w, imperial) => ({
    id: s.id, name: s.name, sport_type: s.sport_type, start_local: s.start_local, gear_id: s.gear_id,
    summary: {
      distance: imperial ? s.d / MI : s.d,
      moving_time: s.mt, elapsed_time: s.et,
      elevation_gain: imperial ? s.eg / FT : s.eg,
      avg_speed: imperial ? s.as * 3600 / MI : s.as,
      max_speed: imperial ? s.ms * 3600 / MI : s.ms,
      relative_effort: s.re, avg_cadence: s.cad,
      kudos_count: s.k, achievement_count: s.ac, pr_count: s.pr,
    },
    weather: w[s.id] ? (typeof w[s.id] === 'string' ? { condition: w[s.id] } : w[s.id]) : null,
  });

  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };

  const fetchRange = async (afterS, beforeS) => {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/athlete/activities?after=${afterS}&before=${beforeS}&per_page=200&page=${page}`);
      out.push(...list.map(toSummary));
      if (list.length < 200) break;
    }
    return out;
  };

  // A past year is fetched once and kept; the current year is fetched on each open.
  const year = (y) => once('year' + y, async () => {
    const key = 'hub.year.' + y;
    const thisYear = new Date().getFullYear();
    const kept = store.get(key);
    if (y < thisYear && kept && kept.complete) return kept.rows;
    // Pad a day either side (start times are local), then trim by local date.
    const rows = (await fetchRange(Date.UTC(y, 0, 1) / 1000 - 86400, Date.UTC(y + 1, 0, 1) / 1000 + 86400))
      .filter((a) => a.start_local.slice(0, 4) === String(y));
    store.set(key, { rows, complete: y < thisYear, at: Date.now() });
    return rows;
  });

  const recent = (n) => once('recent', async () => (await api('/athlete/activities?per_page=' + Math.max(30, n))).map(toSummary))
    .then((rows) => rows.slice(0, n));

  const joinedYear = async () => {
    const kept = store.get('hub.joined');
    if (kept) return kept;
    const me = await api('/athlete');
    const y = Number(String(me.created_at || '2009').slice(0, 4)) || 2009;
    store.set('hub.joined', y);
    return y;
  };

  const listActivities = async (args) => {
    const w = await weather;
    const imperial = !!args.use_preferred_units;
    let rows;
    if (args.range_start) {
      let y0 = Number(args.range_start.slice(0, 4));
      const y1 = Number((args.range_end || args.range_start).slice(0, 4));
      // "All time": start from the year the Strava account was made.
      if (y0 < 2009) y0 = Math.max(y0, await joinedYear());
      rows = [];
      for (let y = y0; y <= y1; y++) rows.push(...(await year(y)));
      rows = rows.filter((a) => a.start_local >= args.range_start && (!args.range_end || a.start_local <= args.range_end));
      rows.sort((a, b) => (args.ordering === 'StartDateLocalAsc' ? 1 : -1) * a.start_local.localeCompare(b.start_local));
    } else {
      rows = await recent(args.first || 30);
    }
    return { activities: rows.map((s) => toMcp(s, w, imperial)), has_next_page: false, end_cursor: null };
  };

  // ---- One activity -----------------------------------------------------
  const RANK = { 1: 'SegmentPersonalRecordGold', 2: 'SegmentPersonalRecordSilver', 3: 'SegmentPersonalRecordBronze' };
  const performance = (id) => once('perf' + id, async () => {
    const key = 'hub.perf.' + id;
    const kept = store.get(key);
    if (kept) return kept;
    const a = await api(`/activities/${id}?include_all_efforts=true`);
    const efforts = (a.segment_efforts || []).map((e) => ({
      id: String(e.id),
      segment_id: String(e.segment && e.segment.id),
      segment_name: e.name || (e.segment && e.segment.name) || '',
      distance: e.distance,
      elev_gain: e.segment && e.segment.elevation_high != null ? Math.max(0, e.segment.elevation_high - e.segment.elevation_low) : 0,
      elapsed_time: e.elapsed_time,
      moving_time: e.moving_time,
      avg_hr: e.average_heartrate ?? null,
      pr_rank: e.pr_rank ?? null,
    }));
    const p = {
      sport_type: a.sport_type,
      has_heartrate: !!a.has_heartrate,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      average_cadence: a.average_cadence ?? null,
      calories: a.calories ?? null,
      segment_efforts: efforts.map(({ pr_rank, ...e }) => e),
      pr_achievements: efforts.filter((e) => RANK[e.pr_rank]).map((e) => ({ entity_id: e.id, achievement_type: RANK[e.pr_rank] })),
    };
    // Keep it only once Strava has finished processing the ride.
    if (Date.now() - Date.parse(a.start_date) > 6 * 3600e3) store.set(key, p);
    return p;
  });

  const streams = (id, resolution) => once('str' + id, async () => {
    const key = 'hub.str.' + id;
    const kept = store.get(key);
    if (kept) return kept;
    const s = await api(`/activities/${id}/streams?keys=time,heartrate&key_by_type=true&series_type=time`);
    const time = (s.time && s.time.data) || [];
    const hr = s.heartrate && s.heartrate.data;
    const n = Math.min(resolution || 200, time.length);
    const pick = (arr) => Array.from({ length: n }, (_, i) => arr[Math.round(i * (time.length - 1) / Math.max(1, n - 1))]);
    const out = hr && hr.length === time.length ? { time: pick(time), heart_rate: pick(hr) } : { time: pick(time) };
    store.set(key, out);
    return out;
  });

  // ---- Bikes and streak --------------------------------------------------
  const gear = async () => {
    const kept = store.get('hub.gear');
    if (kept && Date.now() - kept.at < 864e5) return kept.data;
    const me = await api('/athlete');
    const ids = new Set((me.bikes || []).map((b) => String(b.id)));
    const thisYear = new Date().getFullYear();
    for (const y of [thisYear - 1, thisYear]) (store.get('hub.year.' + y) || { rows: [] }).rows.forEach((a) => a.gear_id && ids.add('b' + a.gear_id));
    const bikes = [];
    for (const id of [...ids].filter((x) => x.startsWith('b'))) {
      try {
        const g = await api('/gear/' + id);
        bikes.push({ gear_id: { id: id.replace(/^b/, ''), gear_type: 'Bike' }, name: g.name || g.nickname, retired: !!g.retired, total_distance: g.distance, frame_type: ({ 1: 'Mountain', 2: 'Cross', 3: 'Road', 4: 'Time trial', 5: 'Gravel' })[g.frame_type] ?? null });
      } catch (e) { console.warn('Gear ' + id, e); }
    }
    const data = { gear: bikes };
    store.set('hub.gear', { at: Date.now(), data });
    return data;
  };

  const streak = async () => {
    const y = new Date().getFullYear();
    const rows = [...(await year(y - 1)), ...(await year(y))];
    const monday = (d) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const weeks = new Set(rows.map((a) => monday(a.start_local.slice(0, 10))));
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    let wk = monday(local);
    const ongoing = weeks.has(wk);
    const step = (w) => { const x = new Date(w + 'T12:00:00'); x.setDate(x.getDate() - 7); return x.toISOString().slice(0, 10); };
    if (!ongoing) wk = step(wk);
    let length = 0, start = null;
    while (weeks.has(wk)) { length += 1; start = wk; wk = step(wk); }
    return { length, start_date: start, streak_status: ongoing ? 'Ongoing' : 'Pending' };
  };

  const tools = {
    list_activities: listActivities,
    get_activity_performance: (a) => performance(String(a.activity_id)),
    get_activity_streams: (a) => streams(String(a.activity_id), a.resolution),
    get_gear: gear,
    get_active_streak: streak,
  };

  window.strava = {
    ready: () => !!auth().refresh_token,
    // On open: bring back the sign-in from IndexedDB if this browser's storage lost it,
    // and ask the phone to keep this app's storage.
    restore: async () => {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
      const kept = await idb('readonly', (os) => os.get(AUTH_KEY));
      const now = auth();
      if (kept && kept.refresh_token && !now.refresh_token) store.set(AUTH_KEY, { ...kept, ...now, refresh_token: kept.refresh_token, access_token: kept.access_token, expires_at: kept.expires_at });
      else if (kept && kept.clientId && !now.clientId) store.set(AUTH_KEY, { ...kept, ...now });
      else if (now.clientId) backup();
    },
    hasKeys: () => !!(auth().clientId && auth().clientSecret),
    athlete: () => auth().athlete || null,
    calls: () => calls,
    redirectUri,
    call: async (tool, args = {}) => {
      if (!tools[tool]) throw new Error('No such Strava call: ' + tool);
      return tools[tool](args);
    },
    saveKeys: (clientId, clientSecret) => setAuth({ ...auth(), clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() }),
    connect: () => {
      const a = auth();
      location.href = 'https://www.strava.com/oauth/authorize?' + new URLSearchParams({
        client_id: a.clientId, redirect_uri: redirectUri(), response_type: 'code', approval_prompt: 'auto', scope: SCOPE,
      });
    },
    // Back from Strava with ?code=…: trade it for tokens, then clean the address.
    finishSignIn: async () => {
      const q = new URLSearchParams(location.search);
      if (!q.has('code') && !q.has('error')) return false;
      history.replaceState(null, '', location.pathname + location.hash);
      if (q.get('error')) throw connectErr('Strava sign-in was cancelled');
      if (!(q.get('scope') || '').includes('activity:read_all')) throw connectErr('Please allow access to all activities (including private ones) when Strava asks.');
      await tokenCall({ code: q.get('code'), grant_type: 'authorization_code' });
      return true;
    },
    // Fresh numbers: forget this session's answers and the current year's list.
    resetSession: () => { memo.clear(); },
    signOut: () => {
      idb('readwrite', (os) => os.delete(AUTH_KEY));
      Object.keys(localStorage).filter((k) => k.startsWith('hub.')).forEach((k) => localStorage.removeItem(k));
      memo.clear();
    },
  };
})();
