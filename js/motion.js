// Light motion, borrowed as ideas (not code) from Motion Primitives, React Bits and GSAP-style
// count-ups. One authored moment per screen: numbers count up the first time they show and rings
// draw in; otherwise only the active tab's pill slides and a thin bar under the tabs shows scroll
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
      if (animate && !reduce && pill.style.transform && pill.style.transform !== `translate(${t.offsetLeft}px, ${t.offsetTop}px)`) pill.animate([{ scale: '1 1' }, { scale: '1.12 1' }, { scale: '1 1' }], { duration: 340, easing: 'ease-in-out' });
      pill.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop}px)`;
      pill.dataset.tab = t.dataset.tab;
      if (!animate || reduce) { pill.offsetWidth; pill.style.transition = ''; }
    };
    new MutationObserver(() => place(true)).observe(tin, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    addEventListener('resize', () => place(false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
    place(false);
  }

  // ---- Sliding indicator on every small switch (units, 2026 / All time, bike filter) ----
  // Switches that are redrawn start their pill where the old one was, then slide.
  const lastPos = new Map();
  const placeU = (g, animate) => {
    const on = g.querySelector('button[aria-pressed="true"]');
    let pill = g.querySelector(':scope > .u-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'u-pill';
      g.prepend(pill);
      g.classList.add('slide');
      const was = lastPos.get(g.className);
      if (was) { pill.style.transition = 'none'; Object.assign(pill.style, was); pill.offsetWidth; pill.style.transition = ''; animate = true; }
    }
    if (!on) { pill.style.opacity = '0'; return; }
    if (animate && !reduce && pill.style.transform && pill.style.transform !== `translate(${on.offsetLeft}px, ${on.offsetTop}px)`) pill.animate([{ scale: '1 1' }, { scale: '1.12 1' }, { scale: '1 1' }], { duration: 300, easing: 'ease-in-out' });
    if (!animate || reduce) pill.style.transition = 'none';
    const pos = { opacity: '1', width: on.offsetWidth + 'px', height: on.offsetHeight + 'px', transform: `translate(${on.offsetLeft}px, ${on.offsetTop}px)` };
    Object.assign(pill.style, pos);
    lastPos.set(g.className, pos);
    if (!animate || reduce) { pill.offsetWidth; pill.style.transition = ''; }
  };
  const allU = (animate) => document.querySelectorAll('.units').forEach((g) => { if (g.offsetParent) placeU(g, animate); });
  let uq = false;
  new MutationObserver(() => {
    if (uq) return;
    uq = true;
    requestAnimationFrame(() => { uq = false; allU(true); });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'], childList: true });
  addEventListener('resize', () => allU(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => allU(false));

  // ---- Numbers scramble briefly when switching km and mi ----
  if (!reduce) {
    const SCR = '[data-draw="km-done"], .ring-mid b, .hrow b, .lw-stats b, .rd-stats b, .kpi-v > span, .yr-hero b, .sim-v b';
    document.addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('[data-units]')) return;
      setTimeout(() => document.querySelectorAll(SCR).forEach((el) => {
        if (!el.offsetParent) return;
        const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
        if (!node) return;
        const final = node.nodeValue, t0 = performance.now();
        let last = final;
        const step = (now) => {
          if (!node.isConnected || node.nodeValue !== last) return;
          const p = (now - t0) / 380;
          if (p >= 1) { node.nodeValue = last = final; return; }
          const keep = Math.floor(p * final.length);
          last = [...final].map((c, i) => (i < keep || !/\d/.test(c) ? c : String((Math.random() * 10) | 0))).join('');
          node.nodeValue = last;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }), 60);
    });
  }

  // ---- Browser on a computer vs the phone app ----
  // The installed phone app stays lean. A desktop browser (mouse, wide screen, not the installed
  // app) also gets Lenis smooth scrolling, gentle tilt, magnetic buttons and charts that draw in.
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const desk = !standalone && matchMedia('(hover: hover) and (pointer: fine) and (min-width: 64rem)').matches;
  document.documentElement.classList.add(standalone ? 'app' : desk ? 'desk' : 'web');
  if (desk) { const d = document.createElement('script'); d.src = 'js/desk.js'; document.head.append(d); }
  if (desk && !reduce) {
    const s = document.createElement('script');
    s.src = 'js/vendor/lenis.min.js';
    s.onload = () => {
      const lenis = new window.Lenis({ lerp: 0.12, wheelMultiplier: 1 });
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      window.hubLenis = lenis;
    };
    document.head.append(s);
    document.querySelectorAll('.sheet-in, .scroll').forEach((e) => e.setAttribute('data-lenis-prevent', ''));
  }


  // ---- Desktop-only extras (ideas from Motion Primitives, React Bits and GSAP ScrollTrigger) ----
  if (desk && !reduce) {
    // Tilt: the season panel and the two France climb cards lean toward the mouse.
    document.querySelectorAll('#goal-hero, #colombier-card, #tourmalet-card').forEach((c) => {
      c.classList.add('tilt');
      let f = 0;
      c.addEventListener('pointermove', (e) => {
        if (f) return;
        f = requestAnimationFrame(() => {
          f = 0;
          const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          const k = c.id === 'goal-hero' ? 3 : 6;
          c.style.transform = `perspective(1100px) rotateX(${(-y * k).toFixed(2)}deg) rotateY(${(x * k).toFixed(2)}deg)`;
        });
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });

    // Magnetic buttons in the masthead: they drift a few pixels toward the mouse.
    document.querySelectorAll('.mast .mchip, .mast .sync, .mast .units, .ra-toggle').forEach((b) => {
      b.classList.add('mag');
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.25).toFixed(1)}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });

    // Smooth-scroll back to the top when a tab opens.
    document.querySelectorAll('.hub-page').forEach((sec) => {
      new MutationObserver(() => {
        if (!sec.hidden && window.hubLenis) window.hubLenis.scrollTo(0, { immediate: true, force: true });
      }).observe(sec, { attributes: true, attributeFilter: ['hidden'] });
    });

    // Chart lines draw themselves in the first time a chart scrolls into view.
    const drawIn = (chart) => {
      const svg = chart.querySelector('svg');
      if (!svg) return false;
      svg.querySelectorAll('path').forEach((p) => {
        const cs = getComputedStyle(p);
        if (cs.fill !== 'none' || cs.stroke === 'none' || cs.strokeDasharray !== 'none') return;
        let len = 0;
        try { len = p.getTotalLength(); } catch {}
        if (len < 80) return;
        p.animate([{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }], { duration: 1400, easing: 'cubic-bezier(.3,.8,.2,1)' });
      });
      svg.querySelectorAll('rect').forEach((r, i) => {
        if (+r.getAttribute('height') < 4 || +r.getAttribute('width') > 200) return;
        r.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: Math.min(i, 30) * 18, easing: 'cubic-bezier(.3,.8,.2,1)', fill: 'backwards' });
        r.style.transformBox = 'fill-box'; r.style.transformOrigin = '50% 100%';
      });
      return true;
    };
    const cio = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      cio.unobserve(e.target);
      if (!drawIn(e.target)) {
        const mo = new MutationObserver(() => { if (drawIn(e.target)) mo.disconnect(); });
        mo.observe(e.target, { childList: true });
        setTimeout(() => mo.disconnect(), 15000);
      }
    }), { threshold: 0.25 });
    document.querySelectorAll('.main .chart:not(.tiny):not(.heat-svg)').forEach((c) => cio.observe(c));
  }

  if (reduce) return;
  document.documentElement.classList.add('motion');

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
