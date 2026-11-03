// Desktop browser only (loaded by motion.js when <html> has the `desk` class).
// 1. Command palette: Ctrl+K (or Cmd+K) jumps to any tab, card, ride or action.
// 2. Ride detail opens as a dialog that grows out of the ride you clicked.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const tabOf = (node) => { const p = node.closest('.hub-page'); return p && p.id; };
  const openTab = (id) => { const t = $(`.hub-tab[data-tab="${id}"]`); if (t) t.click(); };
  const goCard = (card) => {
    const id = tabOf(card);
    if (id) openTab(id);
    requestAnimationFrame(() => {
      const y = card.getBoundingClientRect().top + scrollY - 70;
      if (window.hubLenis) window.hubLenis.scrollTo(y, { duration: 0.8 }); else scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
      card.classList.remove('pal-hit'); card.offsetWidth; card.classList.add('pal-hit');
    });
  };

  // ---------------- Command palette ----------------
  const items = () => {
    const out = [];
    document.querySelectorAll('.hub-tab').forEach((t) => out.push({ kind: 'Tab', label: t.textContent.trim(), run: () => t.click() }));
    document.querySelectorAll('.hub-page .card').forEach((c) => {
      const h = c.querySelector('h2');
      if (!h || c.hidden) return;
      const tab = $(`.hub-tab[data-tab="${tabOf(c)}"]`);
      out.push({ kind: 'Card', label: h.textContent.trim(), hint: tab ? tab.textContent.trim() : '', run: () => goCard(c) });
    });
    const act = (label, sel) => { const b = $(sel); if (b) out.push({ kind: 'Action', label, run: () => b.click() }); };
    act('Sync with Strava', '#sync');
    act('Switch to km', '[data-units="metric"]');
    act('Switch to miles', '[data-units="imperial"]');
    act('Rain alerts on or off', '.ra-toggle');
    try {
      const g = window.dash && dash.data('ride_log');
      if (g && g.status === 'ok') {
        [...g.data].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 400).forEach((r) => out.push({
          kind: 'Ride', label: r.name, hint: String(r.date).slice(0, 10) + (r.miles != null ? ' · ' + (Math.round(r.miles * 10) / 10) + ' mi' : ''),
          run: () => window.hubPickRide && window.hubPickRide(r.id, null),
        }));
      }
    } catch (e) { /* rides not loaded yet */ }
    return out;
  };
  const score = (q, it) => {
    if (!q) return it.kind === 'Ride' ? 0 : 1;
    const s = (it.label + ' ' + (it.hint || '')).toLowerCase();
    let at = 0, pts = 0;
    for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      const i = s.indexOf(w);
      if (i < 0) return -1;
      pts += (i === 0 || s[i - 1] === ' ' ? 3 : 1);
      at = i;
    }
    return pts + (it.kind === 'Tab' ? 2 : it.kind === 'Action' ? 1.5 : it.kind === 'Card' ? 1 : 0) - at / 200;
  };

  const pal = el('dialog', 'pal');
  pal.setAttribute('aria-label', 'Jump to');
  const input = el('input', 'pal-in');
  input.type = 'search'; input.placeholder = 'Jump to a tab, card, ride or action'; input.setAttribute('aria-label', 'Search');
  const list = el('ul', 'pal-list');
  list.setAttribute('role', 'listbox');
  const foot = el('p', 'pal-foot', '↑ ↓ to move · Enter to open · Esc to close');
  pal.append(input, list, foot);
  const root = $('.main') || $('.hub') || document.body;
  root.append(pal);
  let all = [], shown = [], sel = 0;
  const render = () => {
    const q = input.value.trim();
    shown = all.map((it) => ({ it, s: score(q, it) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => {
      const li = el('li', 'pal-i' + (i === sel ? ' on' : ''));
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.append(el('span', 'pal-k', it.kind), el('b', null, it.label), el('small', null, it.hint || ''));
      li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      li.addEventListener('click', () => choose(i));
      return li;
    }));
    if (!shown.length) list.append(el('li', 'pal-none', 'No matches'));
  };
  const choose = (i) => { const it = shown[i]; if (!it) return; pal.close(); it.run(); };
  const openPal = () => { all = items(); input.value = ''; sel = 0; render(); pal.showModal(); input.focus(); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); pal.close(); }
  });
  pal.addEventListener('click', (e) => { if (e.target === pal) pal.close(); });
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (pal.open) pal.close(); else openPal(); }
    else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); openPal(); }
  });
  // A small hint button in the masthead.
  const mastR = $('.mast-r');
  if (mastR) {
    const b = el('button', 'pal-btn');
    b.type = 'button';
    b.setAttribute('aria-label', 'Jump to (Ctrl+K)');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><kbd>Ctrl K</kbd>';
    b.addEventListener('click', openPal);
    mastR.prepend(b);
  }

  // ---------------- Local Legends ticker under the masthead ----------------
  const mast = $('.mast');
  if (mast) {
    const tick = el('div', 'll-tick');
    tick.setAttribute('aria-label', 'Your crowns');
    const track = el('div', 'll-track');
    tick.append(track);
    mast.append(tick);
    let shownKey = '';
    const fill = () => {
      let g;
      try { g = window.dash && dash.data('legends'); } catch (e) { return; }
      if (!g || g.status !== 'ok' || !g.data.length) return;
      const key = JSON.stringify(g.data.map((r) => [r.segment, r.title, r.ll_efforts_90d]));
      if (key === shownKey) return;
      shownKey = key;
      const run = () => g.data.map((r) => {
        const i = el('span', 'll-i' + (r.title === 'Local Legend' ? ' ll' : ''));
        i.append(el('b', null, r.segment), el('small', null, r.title + (r.ll_efforts_90d ? ' · ' + r.ll_efforts_90d + ' efforts in 90 days' : '')));
        return i;
      });
      // Two copies so the strip loops seamlessly.
      const a = el('div', 'll-run'), b = el('div', 'll-run');
      a.append(...run()); b.append(...run()); b.setAttribute('aria-hidden', 'true');
      track.replaceChildren(a, b);
      track.style.setProperty('--ll-dur', Math.max(30, g.data.length * 7) + 's');
      tick.classList.add('on');
    };
    if (window.dash && dash.onData) dash.onData(fill);
    fill();
  }

  // ---------------- Ride detail as a dialog ----------------
  const card = $('#ride-detail-card');
  if (!card) return;
  const home = el('span'); home.hidden = true; card.before(home);
  const dlg = el('dialog', 'ride-dlg');
  dlg.setAttribute('aria-label', 'Ride detail');
  const close = el('button', 'ride-x', '×');
  close.type = 'button'; close.setAttribute('aria-label', 'Close');
  dlg.append(close);
  root.append(dlg);
  const putBack = () => { if (card.parentNode === dlg) home.after(card); };
  const shut = () => {
    if (!dlg.open) return;
    if (reduce) { dlg.close(); return; }
    const a = dlg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 160, easing: 'ease-in' });
    a.onfinish = () => dlg.close();
  };
  dlg.addEventListener('close', putBack);
  close.addEventListener('click', shut);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) shut(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });

  window.hubRideDialog = (from) => {
    if (!document.documentElement.classList.contains('desk')) return false;
    if (card.parentNode !== dlg) dlg.append(card);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    if (from && from.getBoundingClientRect && !reduce) {
      // Morph: start at the clicked row's box and grow into the dialog.
      const r = from.getBoundingClientRect(), d = dlg.getBoundingClientRect();
      const sx = r.width / d.width, sy = Math.max(0.06, r.height / d.height);
      dlg.animate([
        { transformOrigin: 'top left', transform: `translate(${r.left - d.left}px, ${r.top - d.top}px) scale(${sx}, ${sy})`, opacity: 0.4, borderRadius: '6px' },
        { transformOrigin: 'top left', transform: 'none', opacity: 1, borderRadius: '14px' },
      ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    close.focus();
    return true;
  };
})();
