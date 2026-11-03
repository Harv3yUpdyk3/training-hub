// Light motion, borrowed as ideas (not code) from Motion Primitives, React Bits and GSAP-style
// count-ups: numbers count up the first time they show, rings draw in, cards ease in as they
// scroll into view, the active tab's pill slides, and a thin bar under the tabs shows scroll
// position. No libraries, nothing runs continuously, and all of it is off when the phone asks
// for reduced motion.
(() => {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Scroll progress under the tabs (cheap: one transform per frame while scrolling) ----
  const tabs = document.querySelector('.tabs');
  if (tabs) {
    const bar = document.createElement('i');
    bar.className = 'scroll-prog';
    tabs.append(bar);
    let queued = false;
    const upd = () => {
      queued = false;
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')';
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(upd); } }, { passive: true });
    addEventListener('resize', upd);
    upd();
  }

  // ---- Sliding tab pill ----
  const tin = document.querySelector('.tabs-in');
  if (tin) {
    const pill = document.createElement('span');
    pill.className = 'tab-pill';
    tin.prepend(pill);
    tin.classList.add('pill-on');
    const place = (animate) => {
      const t = tin.querySelector('.hub-tab[aria-selected="true"]');
      if (!t) return;
      if (!animate || reduce) pill.style.transition = 'none';
      pill.style.width = t.offsetWidth + 'px';
      pill.style.height = t.offsetHeight + 'px';
      pill.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop}px)`;
      pill.dataset.tab = t.dataset.tab;
      if (!animate || reduce) { pill.offsetWidth; pill.style.transition = ''; }
    };
    new MutationObserver(() => place(true)).observe(tin, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    addEventListener('resize', () => place(false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
    place(false);
  }

  if (reduce) return;
  document.documentElement.classList.add('motion');

  // ---- Cards ease in as they enter the view, staggered within each batch ----
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = Math.min(n++, 5) * 60 + 'ms';
        e.target.classList.add('in');
        io.unobserve(e.target);
        setTimeout(() => { e.target.style.transitionDelay = ''; e.target.classList.remove('iv', 'in'); }, 900);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.main .card, .main .nextup, .main .hero, .main .ph').forEach((c) => { c.classList.add('iv'); io.observe(c); });
  }

  // ---- Count-up numbers: the first time a headline number appears ----
  const seen = new Set();
  const NUM = /^([+−-]?)(\d{1,3}(?:,\d{3})+|\d+)(%?)$/;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const countUp = (el, key) => {
    const txt = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue.trim() : '';
    const m = NUM.exec(txt);
    if (!m || seen.has(key)) return;
    seen.add(key);
    const to = Number(m[2].replace(/,/g, ''));
    if (to < 10) return;
    const node = el.firstChild, comma = m[2].includes(',') || to >= 1000;
    const fmt = (v) => m[1] + (comma ? Math.round(v).toLocaleString('en-US') : String(Math.round(v))) + m[3];
    const t0 = performance.now(), dur = to > 500 ? 1100 : 800;
    let last = fmt(0);
    node.nodeValue = last;
    const step = (now) => {
      if (!node.isConnected || node.nodeValue !== last) return; // redrawn meanwhile: leave it
      const p = Math.min(1, (now - t0) / dur);
      last = fmt(to * ease(p));
      node.nodeValue = last;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const TARGETS = [
    ['[data-draw="km-done"]', (e) => 'km-done'],
    ['.ring-main .ring-mid b', () => 'ring-main'],
    ['.rings .ring', null],
    ['.yr-hero b', () => 'yr'],
    ['.lw-stats b', null],
    ['.sim-v b', () => 'sim'],
  ];
  const scan = () => {
    TARGETS.forEach(([sel, keyOf]) => document.querySelectorAll(sel).forEach((e, i) => {
      if (sel === '.rings .ring') { const b = e.querySelector('.ring-mid b'); if (b) countUp(b, 'ring-' + (e.querySelector('.ring-l') || {}).textContent); return; }
      if (sel === '.lw-stats b') { countUp(e, 'lw-' + i); return; }
      countUp(e, keyOf(e));
    }));
    // Rings draw in once, the first time they have data.
    document.querySelectorAll('.rings, .ring-main').forEach((r) => {
      if (r.dataset.grown || !r.querySelector('.ring-arc')) return;
      r.dataset.grown = '1';
      r.classList.add('grow');
      setTimeout(() => r.classList.remove('grow'), 1400);
    });
  };
  let pending = false;
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; scan(); }); } })
    .observe(document.querySelector('.main') || document.body, { subtree: true, childList: true, characterData: true });
  scan();
})();
