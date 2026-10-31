// A small stand-in for the dashboard runtime the hub was first written for.
// It gives the hub's scripts the same `dash` object: datasets load on first
// read, calcs run from their inputs, drawings rerun when data or width changes.
(() => {
  const CFG = window.HUB_CONFIG;
  const loaders = new Map();
  const calcs = new Map();
  const draws = new Map();
  const onDataFns = [];
  const state = new Map(); // dataset key -> {status, data, columns, meta, message, refreshing}
  const calcCache = new Map(); // calc id -> {gen, result}
  let gen = 0;

  const PKEY = 'hub.params';
  const loadParams = () => {
    try { return { ...CFG.params, ...JSON.parse(localStorage.getItem(PKEY) || '{}') }; } catch { return { ...CFG.params }; }
  };
  let params = loadParams();

  const fill = (v) => {
    if (typeof v === 'string') {
      const m = v.match(/^\{\{(\w+)\}\}$/);
      if (m) return params[m[1]] ?? null;
      return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''));
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const keyOf = (id) => {
    const ds = CFG.datasets[id];
    return ds && ds.kind === 'query' ? id + '|' + JSON.stringify(fill(ds.args)) : id;
  };

  const shape = (out) => {
    if (Array.isArray(out)) return { data: out, columns: out.length ? Object.keys(out[0]) : [], meta: [] };
    if (out && Array.isArray(out.rows)) return { data: out.rows, columns: out.columns || [], meta: out.meta || [], cut: !!out.cut };
    if (out && Array.isArray(out.data)) return { data: out.data, columns: out.columns || [], meta: out.meta || [] };
    return { data: out, columns: [], meta: [] };
  };

  let scheduled = false;
  const changed = () => {
    gen += 1;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  };

  const load = async (id, key, prev) => {
    const ds = CFG.datasets[id];
    state.set(key, prev ? { ...prev, refreshing: true } : { status: 'loading', data: [], columns: [], meta: [] });
    try {
      let answer;
      if (ds.kind === 'week') {
        const w = window.planner ? await window.planner.loadWeek(window.planner.monday()) : null;
        if (w) answer = w.days;
        else {
          const r = await fetch(ds.fallback, { cache: 'no-cache' });
          if (!r.ok) throw new Error('No plan for this week yet');
          answer = await r.json();
        }
      } else if (ds.kind === 'file') {
        const r = await fetch(ds.url, { cache: 'no-cache' });
        if (!r.ok) throw new Error('Could not read ' + ds.url + ' (' + r.status + ')');
        answer = await r.json();
      } else {
        if (!window.strava.ready()) { state.set(key, { status: 'connect', data: [], columns: [], meta: [] }); changed(); return; }
        answer = await window.strava.call(ds.tool, fill(ds.args));
      }
      const loader = loaders.get(id);
      const out = loader ? await loader.fn({ answer, args: fill(ds.args), call: (t, a) => window.strava.call(t, a), read: {} }) : answer;
      state.set(key, { status: 'ok', refreshing: false, ...shape(out) });
    } catch (err) {
      console.error('Dataset ' + id + ' failed:', err);
      const connect = err && err.code === 'connect';
      state.set(key, { status: connect ? 'connect' : 'error', message: String((err && err.message) || err), data: [], columns: [], meta: [] });
      window.hubStatus && window.hubStatus.error(id, err);
    }
    changed();
  };

  const empty = (status, extra) => ({ status, data: [], rows: [], columns: [], meta: [], refreshing: false, ...extra });

  const dataOf = (id, seen = new Set()) => {
    if (calcs.has(id)) {
      if (seen.has(id)) return empty('error', { message: 'calc loop' });
      seen.add(id);
      const c = calcs.get(id);
      const ins = c.inputs.map((i) => dataOf(i, seen));
      const bad = ins.find((g) => g.status !== 'ok');
      if (bad) return empty(bad.status === 'loading' ? 'loading' : bad.status, { message: bad.message });
      const hit = calcCache.get(id);
      if (hit && hit.gen === gen) return hit.result;
      let result;
      try {
        const data = c.fn(...ins.map((g) => g.data));
        result = { status: 'ok', data, rows: data, value: data, columns: Array.isArray(data) && data.length ? Object.keys(data[0]) : [], meta: [], refreshing: false };
      } catch (err) {
        console.error('Calc ' + id + ' failed:', err);
        result = empty('error', { message: String(err.message || err) });
      }
      calcCache.set(id, { gen, result });
      return result;
    }
    const ds = CFG.datasets[id];
    if (!ds) return empty('missing');
    // A query waiting on a page setting (the picked ride) loads once it is set.
    if (ds.kind === 'query' && /\{\{(\w+)\}\}/.test(JSON.stringify(ds.args))
      && [...JSON.stringify(ds.args).matchAll(/\{\{(\w+)\}\}/g)].some((m) => params[m[1]] == null)) return empty('loading');
    const key = keyOf(id);
    const s = state.get(key);
    if (!s) { load(id, key); return empty('loading'); }
    return { rows: s.data, value: s.data, refreshing: false, ...s };
  };

  const visible = (el) => el.isConnected && !el.closest('[hidden]');
  const runDraw = (name, el) => {
    const d = draws.get(name);
    if (!d) return;
    try {
      if (typeof d === 'function') d(el);
      else {
        if (!el.__made) el.__made = { v: d.mount ? d.mount(el) : undefined };
        d.update && d.update(el, el.__made.v);
      }
    } catch (err) { console.error('Drawing ' + name + ' failed:', err); }
  };

  let rendering = false;
  const render = () => {
    if (rendering) return;
    rendering = true;
    try {
      onDataFns.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
      document.querySelectorAll('[data-draw]').forEach((el) => { if (visible(el)) runDraw(el.dataset.draw, el); });
      labelTables();
      watchCharts();
    } finally { rendering = false; }
    window.hubStatus && window.hubStatus.update(state);
  };

  // On phones, wide tables become stacked cards: each cell is labelled with its column.
  const labelTables = () => document.querySelectorAll('table.stack').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => [...th.childNodes].filter((n) => n.nodeType === 3 || getComputedStyle(n).display !== 'none').map((n) => n.textContent).join('').trim());
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.dataset.label !== heads[i]) td.dataset.label = heads[i] || ''; }));
  });

  // Rerun a chart when its own box changes width (a card going full screen, a rotation).
  const widths = new WeakMap();
  const ro = new ResizeObserver((entries) => {
    if (entries.some((e) => { const w = Math.round(e.contentRect.width), was = widths.get(e.target); widths.set(e.target, w); return was != null && was !== w; })) changed();
  });
  const watchCharts = () => document.querySelectorAll('.chart[data-draw]').forEach((el) => { if (!widths.has(el)) { widths.set(el, null); ro.observe(el); } });

  // Rerun drawings when the width changes, and when a hidden tab is shown.
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; changed(); } });
  new MutationObserver((recs) => {
    if (recs.some((r) => r.oldValue !== r.target.getAttribute('hidden'))) changed();
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden'] });

  window.dash = {
    colors: CFG.colors,
    loader: (id, l) => { loaders.set(id, l); },
    calc: (id, c) => { calcs.set(id, c); },
    data: (id) => dataOf(id),
    onData: (fn) => { onDataFns.push(fn); changed(); },
    draw: (name, fn) => { if (fn === undefined) { document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => visible(el) && runDraw(name, el)); return; } draws.set(name, fn); changed(); },
    params: () => ({ ...params }),
    setParams: (p) => {
      params = { ...params, ...p };
      try { localStorage.setItem(PKEY, JSON.stringify({ units: params.units })); } catch {}
      changed();
    },
    resetParams: () => { params = { ...CFG.params }; changed(); },
    setLink: (name) => { try { history.replaceState(null, '', '#' + name); } catch {} },
    refresh: (id) => { const key = keyOf(id); load(id, key, state.get(key)); },
    refreshAll: () => {
      [...state.keys()].forEach((key) => {
        const id = key.split('|')[0];
        if (CFG.datasets[id] && CFG.datasets[id].kind === 'query') load(id, key, state.get(key));
      });
    },
    reloadAll: () => { state.clear(); calcCache.clear(); changed(); },
    _rerender: changed,
  };
})();
