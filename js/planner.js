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
    const doc = { week_start: week.week_start, updated_at: new Date().toISOString(), updated_by: 'Will', days: week.days };
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

  window.planner = { monday, addDays, loadWeek, saveWeek, blankWeek, INTENSITIES, hasGitHub: () => !!token(), setGitHub: (t) => (t ? put(GH_KEY, { token: t.trim() }) : del(GH_KEY)) };

  // ---- The Training tab's plan card -----------------------------------
  const card = document.querySelector('#plan-card');
  if (!card) return;
  const $ = (s) => card.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmtDay = d3.timeFormat('%b %-d');
  const asDate = (s) => new Date(s + 'T12:00:00');
  const INT_COLOR = { Rest: '--cds-chart-muted', Endurance: '--cds-chart-categorical-1', Tempo: '--cds-chart-categorical-3', Threshold: '--cds-chart-status-warning', VO2: '--cds-chart-status-critical' };

  let start = monday();
  let week = null;
  let dirty = false;

  const label = () => {
    const end = addDays(start, 6), now = monday();
    const rel = start === now ? 'This week' : start === addDays(now, 7) ? 'Next week' : start === addDays(now, -7) ? 'Last week' : 'Week of';
    $('.pw-rel').textContent = rel;
    $('.pw-dates').textContent = fmtDay(asDate(start)) + ' – ' + fmtDay(asDate(end));
  };
  const status = (text, kind) => { const s = $('.pw-status'); s.textContent = text || ''; s.dataset.kind = kind || ''; };

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
      const row = el('button', 'pw-day' + (String(d.status).toLowerCase() === 'done' ? ' done' : ''));
      row.type = 'button';
      row.style.setProperty('--int', `var(${INT_COLOR[d.intensity] || '--cds-chart-muted'})`);
      const left = el('span', 'pw-when');
      left.append(el('b', null, d.day), el('small', null, fmtDay(asDate(d.date))));
      const mid = el('span', 'pw-mid');
      mid.append(el('span', 'pw-s', d.session || '—'), el('span', 'pw-d', d.details || ''));
      const right = el('span', 'pw-r');
      right.append(el('b', null, d.target_miles && d.target_miles !== '0' ? d.target_miles + ' mi' : '—'), el('small', null, d.intensity));
      row.append(left, mid, right);
      row.addEventListener('click', () => openEditor(i));
      list.append(row);
    });
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
    sheet.hidden = false;
    f('session').focus();
  };
  const closeEditor = () => { sheet.hidden = true; editing = -1; };
  sheet.querySelector('.ps-cancel').addEventListener('click', closeEditor);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeEditor(); });
  sheet.querySelector('.ps-rest').addEventListener('click', () => {
    f('session').value = 'Rest'; f('intensity').value = 'Rest'; f('target_miles').value = '0'; f('target_hr').value = '—'; f('details').value = 'Off.';
  });
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
