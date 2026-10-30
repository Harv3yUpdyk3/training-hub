// The app around the hub: Strava setup, sync state, refresh, offline support.
(() => {
  const $ = (s) => document.querySelector(s);
  const setup = $('#setup');
  const sync = $('#sync');
  const syncText = $('#sync-text');
  let lastSync = null;
  let errors = 0;

  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 6e4);
    return m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  };
  const paint = (busy) => {
    sync.classList.toggle('busy', busy);
    sync.classList.toggle('err', !busy && errors > 0);
    syncText.textContent = busy ? 'Syncing' : errors ? 'Retry' : lastSync ? ago(lastSync) : 'Sync';
  };

  window.hubStatus = {
    error: (id, err) => {
      errors += 1;
      if (!(err && err.code === 'connect')) return;
      // Keys are saved, so Strava can sign in again without a form: it sends
      // straight back when the app is already approved. Once per 5 minutes at most.
      let last = 0;
      try { last = Number(sessionStorage.getItem('hub.reauth')) || 0; } catch {}
      if (window.strava.hasKeys() && Date.now() - last > 5 * 6e4) {
        try { sessionStorage.setItem('hub.reauth', String(Date.now())); } catch {}
        window.strava.connect();
      } else showSetup(err.message);
    },
    update: (state) => {
      const busy = [...state.values()].some((s) => s.status === 'loading' || s.refreshing);
      if (!busy && state.size) lastSync = lastSync || Date.now();
      paint(busy);
    },
  };
  setInterval(() => paint(sync.classList.contains('busy')), 30e3);

  sync.addEventListener('click', () => {
    errors = 0;
    lastSync = Date.now();
    window.strava.resetSession();
    window.dash.refreshAll();
  });
  // Coming back to the app after a while: pick up new rides.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 10 * 6e4 && window.strava.ready()) sync.click();
  });

  // Setup screen
  const showSetup = (msg) => {
    $('#cb-domain').textContent = location.hostname;
    $('#setup-msg').textContent = msg || '';
    const keys = window.strava.hasKeys();
    $('#client-id').value = keys ? (JSON.parse(localStorage.getItem('hub.strava') || '{}').clientId || '') : '';
    $('#client-secret').placeholder = keys ? 'Saved on this phone' : 'Paste from Strava';
    $('#setup-go').textContent = keys ? 'Reconnect Strava' : 'Connect with Strava';
    setup.hidden = false;
  };
  $('#setup-go').addEventListener('click', () => {
    const id = $('#client-id').value.trim(), secret = $('#client-secret').value.trim();
    if (!/^\d+$/.test(id)) { $('#setup-msg').textContent = 'The Client ID is a number, from strava.com/settings/api.'; return; }
    if (secret.length < 20 && !window.strava.hasKeys()) { $('#setup-msg').textContent = 'Paste the Client Secret too (tap "show" on the Strava page to copy it).'; return; }
    if (secret) window.strava.saveKeys(id, secret);
    else window.strava.saveKeys(id, JSON.parse(localStorage.getItem('hub.strava') || '{}').clientSecret);
    window.strava.connect();
  });
  document.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Disconnect Strava from this phone?')) { window.strava.signOut(); location.reload(); }
  }));

  const who = window.strava.athlete();
  document.querySelectorAll('[data-who]').forEach((e) => { e.textContent = who && who.firstname ? who.firstname : 'you'; });

  window.strava.restore()
    .then(() => window.strava.finishSignIn())
    .then(() => {
      if (window.strava.ready()) window.dash.reloadAll();
      else if (window.strava.hasKeys()) window.hubStatus.error('auth', Object.assign(new Error('Strava sign-in needed'), { code: 'connect' }));
      else showSetup();
    })
    .catch((err) => showSetup(err.message));

  // Landscape: a chart card goes full screen and turns sideways.
  const ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4M18 10v4"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  let fullCard = null;
  const setBtn = (b, open) => { b.innerHTML = (open ? ICON_CLOSE + 'Close' : ICON_OPEN + 'Landscape'); b.setAttribute('aria-label', open ? 'Close landscape view' : 'Show this chart in landscape'); };
  const closeFull = () => {
    if (!fullCard) return;
    fullCard.classList.remove('full');
    fullCard.querySelectorAll('.land').forEach((b) => setBtn(b, false));
    fullCard = null;
    try { screen.orientation.unlock(); } catch {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const openFull = async (card) => {
    closeFull();
    fullCard = card;
    card.classList.add('full');
    card.querySelectorAll('.land').forEach((b) => setBtn(b, true));
    try {
      if (card.requestFullscreen) await card.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch {}
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fullCard) closeFull(); });
  document.querySelectorAll('.card').forEach((card) => {
    const head = card.querySelector('.card-h');
    if (!head || !card.querySelector('.chart') || card.querySelector('.land')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'land';
    setBtn(b, false);
    b.addEventListener('click', () => (fullCard === card ? closeFull() : openFull(card)));
    head.append(b);
  });

  if ('serviceWorker' in navigator) {
    // When a new version takes over, reload once so it shows straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
  }
})();
