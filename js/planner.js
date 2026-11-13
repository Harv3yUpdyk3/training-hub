// Training plan, week by week: read, edit and save.
// A week is data/weeks/<Monday>.json ({week_start, updated_at, days: [...]}).
// Saving writes that file to the GitHub repo with Will's own GitHub key (kept on
// this device like the Strava keys), so the phone, the computer and Claude all
// read the same plan. Without a key, edits are kept on this device only.
(() => {
  const OWNER = 'Harv3yUpdyk3', REPO = 'training-hub', BRANCH = 'main';
  const GH_KEY = 'hub.github';
  const LOCAL = (w) => 'hub.week.' + w;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const INTENSITIES = ['Rest', 'Endurance', 'Tempo', 'Threshold', 'VO2'];

  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const del = (k) => { try { localStorage.removeItem(k); } catch {} };

  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const monday = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
  const addDays = (s, n) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + n); return iso(x); };

  const blankWeek = (start) => ({
    week_start: start, updated_at: null, days: DAYS.map((day, i) => ({
      order: i + 1, day, date: addDays(start, i), session: 'Rest', details: '', target_hr: '—', target_miles: '0', status: 'Planned', intensity: 'Rest',
    })),
  });

  const token = () => (get(GH_KEY) || {}).token || null;
  const ghPath = (start) => `data/weeks/${start}.json`;
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

  // GitHub copy (fresh, with its sha) when a key is set; else the published file.
  const fetchRemote = async (start) => {
    if (token()) {
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${ghPath(start)}?ref=${BRANCH}`, { headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GitHub ' + r.status);
      const j = await r.json();
      return { ...JSON.parse(unb64(j.content)), _sha: j.sha };
    }
    const r = await fetch(ghPath(start), { cache: 'no-cache' });
    if (r.ok) return r.json();
    // The week before week files existed lives in plan.json.
    if (start === '2026-10-26') { const p = await fetch('data/plan.json', { cache: 'no-cache' }); if (p.ok) return { week_start: start, updated_at: null, days: await p.json() }; }
    return null;
  };

  // The newer of this device's unsaved copy and the shared one.
  const loadWeek = async (start) => {
    const local = get(LOCAL(start));
    let remote = null;
    try { remote = await fetchRemote(start); } catch (e) { if (!local) throw e; }
    if (local && (!remote || !remote.updated_at || local.updated_at > remote.updated_at)) return { ...local, _sha: remote && remote._sha, _local: true };
    if (local && remote && remote.updated_at >= local.updated_at) del(LOCAL(start));
    return remote;
  };

  const saveWeek = async (week) => {
    const doc = { week_start: week.week_start, updated_at: new Date().toISOString(), updated_by: 'Will', ...(week.base_mi != null ? { base_mi: week.base_mi, rebalanced_at: week.rebalanced_at } : {}), days: week.days };
    put(LOCAL(week.week_start), doc);
    if (!token()) return { where: 'device', doc };
    let sha = week._sha;
    if (!sha) { try { const cur = await fetchRemote(week.week_start); sha = cur && cur._sha; } catch {} }
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${ghPath(week.week_start)}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Plan: week of ${week.week_start} (edited in the app)`, content: b64(JSON.stringify(doc, null, 1) + '\n'), branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(r.status === 409 ? 'The plan changed somewhere else. Reload the week and try again.' : 'GitHub said ' + r.status + (j.message ? ': ' + j.message : ''));
    }
    const j = await r.json();
    return { where: 'github', doc: { ...doc, _sha: j.content && j.content.sha } };
  };

  // Weather for Atlanta from Open-Meteo (free, no key): this week from Monday through next Sunday.
  let wx = null;
  const weather = () => (wx = wx || fetch('https://api.open-meteo.com/v1/forecast?latitude=33.75&longitude=-84.39'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max'
    + '&timezone=America%2FNew_York&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&past_days=7&forecast_days=16')
    .then((r) => { if (!r.ok) throw new Error('Weather service said ' + r.status); return r.json(); })
    .then((j) => j.daily.time.map((date, i) => ({
      date, code: j.daily.weather_code[i], hi_f: j.daily.temperature_2m_max[i], lo_f: j.daily.temperature_2m_min[i],
      pop: j.daily.precipitation_probability_max[i], rain_in: j.daily.precipitation_sum[i], wind_mph: j.daily.wind_speed_10m_max[i],
    })))
    .catch((e) => { wx = null; throw e; }));
  const wxKind = (c) => (c >= 95 ? 'Storms' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'Snow' : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? 'Rain' : c === 45 || c === 48 ? 'Fog' : c === 3 ? 'Cloudy' : c === 2 ? 'Partly cloudy' : 'Sunny');

  window.planner = { monday, addDays, loadWeek, saveWeek, blankWeek, INTENSITIES, weather, wxKind, hasGitHub: () => !!token(), setGitHub: (t) => (t ? put(GH_KEY, { token: t.trim() }) : del(GH_KEY)) };

  // ---- The Training tab's plan card -----------------------------------
  const card = document.querySelector('#plan-card');
  if (!card) return;
  const $ = (s) => card.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmtDay = d3.timeFormat('%b %-d');
  const asDate = (s) => new Date(s + 'T12:00:00');
  const INT_COLOR = { Rest: '--cds-chart-muted', Endurance: '--cds-chart-categorical-1', Tempo: '--cds-chart-categorical-3', Threshold: '--cds-chart-status-warning', VO2: '--cds-chart-status-critical' };

  let start = monday();
  let wxBy = new Map();
  weather().then((rows) => { wxBy = new Map(rows.map((r) => [r.date, r])); if (week) render(); }).catch(() => {});
  let week = null;
  let dirty = false;

  const label = () => {
    const end = addDays(start, 6), now = monday();
    const rel = start === now ? 'This week' : start === addDays(now, 7) ? 'Next week' : start === addDays(now, -7) ? 'Last week' : 'Week of';
    $('.pw-rel').textContent = rel;
    $('.pw-dates').textContent = fmtDay(asDate(start)) + ' – ' + fmtDay(asDate(end));
  };
  const status = (text, kind) => {
    const s = $('.pw-status'); s.textContent = text || ''; s.dataset.kind = kind || '';
    // A short pulse confirms a save.
    if (/^Saved/.test(text || '')) { s.classList.remove('pulse'); s.offsetWidth; s.classList.add('pulse'); }
  };

  const render = () => {
    label();
    const list = $('.pw-days');
    list.replaceChildren();
    $('.pw-save').hidden = !dirty;
    $('.pw-start').hidden = !!week;
    if (!week) { status('No plan for this week yet.', ''); return; }
    const total = week.days.reduce((a, d) => { const n = String(d.target_miles).split('–').map(Number).filter(Number.isFinite); return [a[0] + (n[0] || 0), a[1] + (n[n.length - 1] || 0)]; }, [0, 0]);
    status((week._local ? 'Saved on this device only. ' : '') + 'Planned ' + total[0] + (total[1] !== total[0] ? '–' + total[1] : '') + ' mi', week._local ? 'warn' : '');
    week.days.forEach((d, i) => {
      const row = el('button', 'pw-day' + (String(d.status).toLowerCase() === 'done' ? ' done' : String(d.status).toLowerCase() === 'skipped' ? ' skipped' : ''));
      row.type = 'button';
      row.style.setProperty('--int', `var(${INT_COLOR[d.intensity] || '--cds-chart-muted'})`);
      row.style.setProperty('--i', i);
      const left = el('span', 'pw-when');
      left.append(el('b', null, d.day), el('small', null, fmtDay(asDate(d.date))));
      const mid = el('span', 'pw-mid');
      mid.append(el('span', 'pw-s', d.session || '—'), el('span', 'pw-d', d.details || ''));
      const right = el('span', 'pw-r');
      right.append(el('b', null, d.target_miles && d.target_miles !== '0' ? d.target_miles + ' mi' : '—'), el('small', null, d.intensity));
      const w = wxBy.get(d.date);
      if (w) { const c = el('small', 'pw-wx' + (w.pop >= 50 ? ' wet' : ''), (w.pop >= 30 ? (/Rain|Storms|Snow/.test(wxKind(w.code)) ? wxKind(w.code) : 'Rain') + ' ' + w.pop + '%' : wxKind(w.code)) + ' · ' + Math.round(w.hi_f) + '°'); right.append(c); }
      row.append(left, mid, right);
      row.addEventListener('click', () => openEditor(i));
      list.append(row);
    });
    rainSwap();
    rebalanceOffer();
  };

  // Rain swap: when the long ride sits on a wet day and a drier day is left this week, one tap trades the two days and saves.
  const SWAP_FIELDS = ['session', 'details', 'target_miles', 'target_hr', 'intensity', 'status', 'actual', 'actual_short'];
  const isLong = (d) => /long/i.test(d.session || '') || Math.max(...String(d.target_miles).split('–').map(Number).filter(Number.isFinite), 0) >= 40;
  const open = (d) => !/^(done|skipped)$/i.test(String(d.status || '')) && d.date >= iso(new Date());
  const rainSwap = () => {
    let b = $('.pw-swap');
    if (!b) { b = el('button', 'pw-swap'); b.type = 'button'; $('.pw-days').before(b); b.addEventListener('click', () => doSwap(b._from, b._to)); }
    b.hidden = true;
    if (!week || !wxBy.size) return;
    const from = week.days.findIndex((d) => open(d) && isLong(d));
    if (from < 0) return;
    const wet = wxBy.get(week.days[from].date);
    if (!wet || wet.pop < 40) return;
    let to = -1, best = wet.pop - 20;
    week.days.forEach((d, i) => { const w = wxBy.get(d.date); if (i !== from && open(d) && w && w.pop <= best) { best = w.pop; to = i; } });
    if (to < 0) return;
    const dry = wxBy.get(week.days[to].date);
    b._from = from; b._to = to;
    b.replaceChildren(el('b', null, 'Rain swap'), el('span', null, `${week.days[from].day} is ${wet.pop}% rain. Move the long ride to ${week.days[to].day} (${dry.pop}%, ${Math.round(dry.hi_f)}°)`));
    b.hidden = false;
  };
  const doSwap = async (a, b) => {
    const A = week.days[a], B = week.days[b];
    SWAP_FIELDS.forEach((k) => { const t = A[k]; if (B[k] === undefined) delete A[k]; else A[k] = B[k]; if (t === undefined) delete B[k]; else B[k] = t; });
    dirty = true;
    render();
    $('.pw-save').click();
  };

  // ---- Missed-day rebalance -------------------------------------------
  // When a day is missed (rain, errands, tired), spread the lost miles over the days
  // still to come so the week still fills the Week ring (what the 5,000 km goal needs
  // this week: what is left of the goal spread over the weeks to Dec 31). Coaching rules:
  //  - a missed hard session moves to one open day with no hard day either side,
  //    never onto the long ride or the day before it; if none fits, it waits for next week;
  //  - extra miles go first to Zone 2 days (up to 35 mi), then the long ride (55+ mi
  //    for the Eddington goal, up to 62), then rest days become easy rides
  //    (the day before the long ride stays a short spin), keeping one day off,
  //    then the long ride up to 70;
  //  - anything still short is reported, not crammed in.
  const HARD = /^(Tempo|Threshold|VO2)$/;
  const CAP = { endurance: 35, longSoft: 62, long: 70, restToRide: 30, preLong: 15, longMin: 55 };
  const nums = (s) => String(s ?? '').split(/[–-]/).map(Number).filter(Number.isFinite);
  const lo = (d) => (nums(d.target_miles)[0] || 0);
  const hi = (d) => { const n = nums(d.target_miles); return n.length ? n[n.length - 1] : 0; };
  const isDone = (d) => /^done$/i.test(String(d.status || ''));
  const isSkipped = (d) => /^skipped$/i.test(String(d.status || ''));

  // Strava rides by date this week, and the miles the season goal needs this week.
  const liveNumbers = () => {
    const D = window.dash;
    const g = D && D.data('rides');
    const byDate = g && g.status === 'ok' ? d3.rollup(g.data, (v) => d3.sum(v, (r) => r.miles), (r) => r.date) : null;
    const y = D && D.data('ytd');
    const yr = y && y.status === 'ok' && y.data.length ? y.data[0] : null;
    const need = yr ? Math.round(yr.km_per_week / 1.609344) : null;
    return { byDate, need };
  };

  const rebalance = (src) => {
    const w = JSON.parse(JSON.stringify(src));
    const days = w.days, today = iso(new Date());
    const { byDate, need } = liveNumbers();
    const rodeOn = (d) => (byDate ? byDate.get(d.date) || 0 : 0);
    const changes = [];
    const fmtMi = (n) => Math.round(n) + ' mi';

    // Past days still marked Planned with no ride on Strava count as missed.
    if (byDate) days.forEach((d) => {
      if (d.date < today && !isDone(d) && !isSkipped(d) && lo(d) > 0 && !rodeOn(d)) {
        d.status = 'Skipped'; d.actual = 'No ride'; d.actual_short = '—';
        changes.push({ day: d.day, text: 'marked missed (no ride on Strava)' });
      }
    });

    // The week's mileage target: what the season needs, or the plan as first written if that was higher.
    if (w.base_mi == null) w.base_mi = Math.round(d3.sum(src.days, lo));
    const target = Math.max(need || 0, w.base_mi);
    const actualMi = (d) => { const m = /([\d.]+)\s*mi\b/.exec(d.actual || ''); return m ? Number(m[1]) : lo(d); };
    const ridden = byDate ? d3.sum(days, rodeOn) : d3.sum(days.filter(isDone), actualMi);
    const openDays = days.filter((d) => d.date >= today && !isDone(d) && !isSkipped(d) && !(d.date === today && rodeOn(d) > 0));
    let longDay = openDays.find(isLong);
    const hardOn = (date) => days.some((d) => d.date === date && HARD.test(d.intensity) && !isSkipped(d));

    // 0. A missed long ride moves to the latest open day that isn't a hard session.
    const missedLong = days.find((d) => isSkipped(d) && isLong(d) && !d.moved_to);
    if (missedLong && !longDay) {
      const slot = [...openDays].reverse().find((d) => !HARD.test(d.intensity));
      if (slot) {
        const was = slot.session;
        ['session', 'details', 'target_hr', 'intensity'].forEach((k) => { slot[k] = missedLong[k]; });
        slot.target_miles = String(Math.max(CAP.longMin, lo(missedLong)));
        slot.details = (slot.details || '') + ` Moved from ${missedLong.day}.`;
        missedLong.moved_to = slot.day;
        longDay = slot;
        changes.push({ day: slot.day, text: `${was} → ${slot.session} (${slot.target_miles} mi), moved from ${missedLong.day}` });
      }
    }
    const preLong = longDay ? days.find((d) => d.date === addDays(longDay.date, -1)) : null;

    // 1. Move one missed hard session.
    const missedHard = days.find((d) => isSkipped(d) && HARD.test(d.intensity) && !d.moved_to);
    if (missedHard) {
      const slot = openDays.find((d) => d !== longDay && d !== preLong && !HARD.test(d.intensity)
        && !hardOn(addDays(d.date, -1)) && !hardOn(addDays(d.date, 1)));
      if (slot) {
        const was = slot.session, miles = Math.max(hi(missedHard), lo(slot));
        slot.session = missedHard.session;
        slot.intensity = missedHard.intensity;
        slot.target_hr = missedHard.target_hr;
        slot.details = (missedHard.details || '').replace(/\s*(Moved from[^.]*\.|Not ridden\.)/g, '').trim()
          + ` Moved from ${missedHard.day} after it was missed` + (miles > hi(missedHard) ? `; ride the rest of the ${miles} mi easy.` : '.');
        slot.target_miles = String(miles);
        missedHard.moved_to = slot.day;
        changes.push({ day: slot.day, text: `${was} → ${slot.session} (${fmtMi(miles)}), moved from ${missedHard.day}` });
      } else {
        missedHard.moved_to = 'next week';
        changes.push({ day: missedHard.day, text: `${missedHard.session} has no safe slot left this week, so it waits for next week` });
      }
    }

    // 2. Fill the gap. Long ride first gets up to its 55-mile floor.
    const before = new Map(openDays.map((d) => [d, d.target_miles]));
    const planned = () => d3.sum(openDays, lo);
    let gap = Math.round(target - ridden - planned());
    const setMi = (d, n) => { d.target_miles = String(Math.round(n)); };
    const add = (d, cap) => { if (gap <= 0) return; const room = Math.max(0, cap - lo(d)); const put = Math.min(room, gap); if (put > 0) { setMi(d, lo(d) + put); gap -= put; } };
    if (longDay && lo(longDay) < CAP.longMin) { const put = CAP.longMin - lo(longDay); setMi(longDay, CAP.longMin); gap -= put; }
    // Zone 2 days share the extra evenly, a few miles at a time.
    const z2 = openDays.filter((d) => d !== longDay && d.intensity === 'Endurance');
    for (let pass = 0; gap > 0 && pass < 20; pass++) {
      let moved = false;
      z2.forEach((d) => { if (gap > 0 && lo(d) < CAP.endurance) { const step = Math.min(3, CAP.endurance - lo(d), gap); setMi(d, lo(d) + step); gap -= step; moved = true; } });
      if (!moved) break;
    }
    if (longDay) add(longDay, CAP.longSoft);
    // Rest days become easy rides, keeping at least one day off in the week.
    const restLeft = () => days.filter((d) => d.intensity === 'Rest' && lo(d) === 0 && hi(d) <= 10 && !rodeOn(d)).length;
    openDays.filter((d) => d.intensity === 'Rest').sort((a, b) => (a === preLong) - (b === preLong)).forEach((d) => {
      if (gap <= 0 || restLeft() <= 1) return;
      const cap = d === preLong ? CAP.preLong : CAP.restToRide;
      const prevHard = hardOn(addDays(d.date, -1)) || hardOn(addDays(d.date, 1));
      const put = Math.min(gap, cap);
      if (put < 5) return;
      d.session = d === preLong || prevHard ? 'Easy spin' : 'Zone 2 endurance';
      d.intensity = 'Endurance';
      d.target_hr = d === preLong || prevHard ? 'under 125' : '130–150, cap 153';
      d.details = d === preLong ? 'Short and easy to keep the legs fresh for tomorrow\'s long ride.' : 'Steady and conversational. Added to make up missed miles.';
      setMi(d, put); gap -= put;
    });
    if (longDay) add(longDay, CAP.long);

    // Say what changed, and note it on each day.
    openDays.forEach((d) => {
      const was = before.get(d);
      if (d.target_miles === was) return;
      if (!/Rebalanced/.test(d.details || '')) d.details = ((d.details || '') + ` Rebalanced from ${was === '0' ? 'rest' : was + ' mi'}.`).trim();
      const already = changes.find((c) => c.day === d.day);
      const text = `${was === '0' ? 'rest' : was + ' mi'} → ${d.target_miles} mi` + (d.session !== 'Rest' ? ' ' + d.session : '');
      if (already) already.text += `; ${text}`; else changes.push({ day: d.day, text });
    });
    const order = new Map(DAYS.map((d, i) => [d, i]));
    changes.sort((a, b) => order.get(a.day) - order.get(b.day));
    w.rebalanced_at = new Date().toISOString();
    return { week: w, changes, target, ridden: Math.round(ridden), short: Math.max(0, Math.round(gap)), need };
  };

  // A banner offers a rebalance when this week has missed days and the plan falls short.
  const rebalanceOffer = () => {
    let b = $('.pw-rebal');
    if (!b) { b = el('button', 'pw-rebal'); b.type = 'button'; $('.pw-days').before(b); b.addEventListener('click', () => applyRebalance()); }
    b.hidden = true;
    if (!week || start !== monday() || dirty) return;
    const r = rebalance(week);
    const missed = week.days.filter(isSkipped).length + r.changes.filter((c) => /marked missed/.test(c.text)).length;
    if (!missed || !r.changes.length) return;
    const behind = Math.max(0, r.target - r.ridden - d3.sum(week.days.filter((d) => d.date >= iso(new Date()) && !isDone(d) && !isSkipped(d)), lo));
    b.replaceChildren(el('b', null, 'Rebalance the week'), el('span', null, behind > 0
      ? `Missed days leave you ${behind} mi short of ${r.target} mi this week. Tap to spread them over the days left.`
      : 'Missed days this week. Tap to move the missed session to a day that still works.'));
    b.hidden = false;
  };

  let undo = null;
  const applyRebalance = async () => {
    const r = rebalance(week);
    undo = JSON.parse(JSON.stringify(week));
    week = { ...r.week, _sha: week._sha, _local: week._local };
    dirty = true;
    showResult(r);
    render();
    $('.pw-save').click();
  };
  const showResult = (r) => {
    let box = $('.pw-rb');
    if (!box) { box = el('div', 'pw-rb'); box.setAttribute('role', 'status'); $('.pw-days').before(box); }
    const head = el('div', 'pw-rb-h');
    head.append(el('b', null, 'Week rebalanced'), el('span', null, `Target ${r.target} mi · ridden ${r.ridden}`));
    const ul = el('ul');
    if (!r.changes.length) ul.append(el('li', null, 'Nothing needed to change: the days left already cover the week.'));
    r.changes.forEach((c) => { const li = el('li'); li.append(el('b', null, c.day + ' '), document.createTextNode(c.text)); ul.append(li); });
    const foot = el('p', 'pw-rb-f', r.short > 0
      ? `Still ${r.short} mi short after capping rides at ${CAP.endurance} mi (long ride ${CAP.long}). That spreads over the weeks left, about ${Math.max(1, Math.round(r.short / Math.max(1, (Date.UTC(2027, 0, 1) - Date.now()) / 6048e5)))} mi more per week.`
      : 'The week still hits its target.');
    const btns = el('div', 'pw-rb-b');
    const u = el('button', null, 'Undo'); u.type = 'button';
    u.addEventListener('click', () => { if (!undo) return; week = { ...undo, _sha: week._sha }; undo = null; box.remove(); dirty = true; render(); $('.pw-save').click(); });
    const x = el('button', null, 'OK'); x.type = 'button';
    x.addEventListener('click', () => { undo = null; box.remove(); });
    btns.append(u, x);
    box.replaceChildren(head, ul, foot, btns);
  };

  // "Missed it" in the day editor: mark the day with a reason, then rebalance.
  const missDay = (reason) => {
    const d = week.days[editing];
    d.status = 'Skipped';
    d.actual = reason === 'Rain' ? 'Rained out' : 'Missed: ' + reason.toLowerCase();
    d.actual_short = reason === 'Rain' ? 'Rain' : '—';
    closeEditor();
    applyRebalance();
  };

  const load = async () => {
    status('Loading…');
    dirty = false;
    try { week = await loadWeek(start); } catch (e) { week = null; status('Could not load: ' + e.message, 'bad'); }
    render();
  };

  // Editor sheet
  const sheet = document.querySelector('#plan-sheet');
  const f = (n) => sheet.querySelector(`[name="${n}"]`);
  let editing = -1;
  const openEditor = (i) => {
    editing = i;
    const d = week.days[i];
    sheet.querySelector('.ps-title').textContent = d.day + ' · ' + fmtDay(asDate(d.date));
    ['session', 'details', 'target_miles', 'target_hr', 'intensity', 'status', 'actual'].forEach((n) => { f(n).value = d[n] ?? ''; });
    sheet.querySelector('.ps-miss').hidden = isDone(d) || isSkipped(d) || start !== monday();
    sheet.hidden = false;
    f('session').focus();
  };
  // Exit is shorter than the entrance (240 ms in, about 190 ms out).
  const closeEditor = () => {
    editing = -1;
    const inner = sheet.querySelector('.sheet-in');
    if (!inner || sheet.hidden || !document.documentElement.classList.contains('motion')) { sheet.hidden = true; return; }
    sheet.classList.add('closing');
    setTimeout(() => { sheet.hidden = true; sheet.classList.remove('closing'); }, 190);
  };
  sheet.querySelector('.ps-cancel').addEventListener('click', closeEditor);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeEditor(); });
  sheet.querySelector('.ps-rest').addEventListener('click', () => {
    f('session').value = 'Rest'; f('intensity').value = 'Rest'; f('target_miles').value = '0'; f('target_hr').value = '—'; f('details').value = 'Off.';
  });
  sheet.querySelectorAll('.ps-miss button').forEach((b) => b.addEventListener('click', () => missDay(b.dataset.why)));
  sheet.querySelector('.ps-done').addEventListener('click', () => {
    const d = week.days[editing];
    ['session', 'details', 'target_miles', 'target_hr', 'intensity', 'status', 'actual'].forEach((n) => { d[n] = f(n).value.trim(); });
    if (!d.actual) delete d.actual;
    dirty = true;
    closeEditor();
    render();
  });

  $('.pw-prev').addEventListener('click', () => { if (dirty && !confirm('Leave without saving your changes?')) return; start = addDays(start, -7); load(); });
  $('.pw-next').addEventListener('click', () => { if (dirty && !confirm('Leave without saving your changes?')) return; start = addDays(start, 7); load(); });
  $('.pw-start').addEventListener('click', () => { week = blankWeek(start); dirty = true; render(); });
  $('.pw-save').addEventListener('click', async () => {
    const b = $('.pw-save');
    b.disabled = true;
    status('Saving…');
    try {
      const res = await saveWeek(week);
      week = { ...res.doc, _local: res.where === 'device' };
      dirty = false;
      render();
      status(res.where === 'github' ? 'Saved. Your other devices and Claude will see it.' : 'Saved on this device. Add a GitHub key to share it.', res.where === 'github' ? 'ok' : 'warn');
      if (start === monday() && window.dash) window.dash.refresh('plan');
    } catch (e) { status(e.message, 'bad'); }
    b.disabled = false;
  });

  // GitHub key
  const keyBox = document.querySelector('#gh-key');
  const showKey = () => { $('.pw-gh').textContent = token() ? 'GitHub connected' : 'Connect GitHub to share'; };
  $('.pw-gh').addEventListener('click', () => { keyBox.hidden = !keyBox.hidden; });
  keyBox.querySelector('.gk-save').addEventListener('click', () => {
    const v = keyBox.querySelector('input').value.trim();
    if (v) window.planner.setGitHub(v);
    keyBox.hidden = true;
    showKey();
    load();
  });
  keyBox.querySelector('.gk-clear').addEventListener('click', () => { window.planner.setGitHub(null); keyBox.querySelector('input').value = ''; showKey(); load(); });
  showKey();
  load();
})();
