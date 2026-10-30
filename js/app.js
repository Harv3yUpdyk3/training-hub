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
      if (err && err.code === 'connect') showSetup(err.message);
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

  window.strava.finishSignIn()
    .then(() => {
      if (!window.strava.ready()) showSetup();
      else window.dash.reloadAll();
    })
    .catch((err) => showSetup(err.message));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
