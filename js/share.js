// Share card: a one-tap 1080 × 1350 image (Instagram portrait, fine on Strava) of this week or the
// picked ride, drawn on a canvas in the hub's poster look. On the phone it opens the share sheet;
// elsewhere it downloads the PNG.
(() => {
  const W = 1080, H = 1350;
  const C = { page: '#0c2823', poster: '#1a4a40', panel: '#12352e', copper: '#B37E2C', copperHi: '#d39a45', cream: '#f6eedb', muted: '#a3c2bd', sky: '#00B1EA', amethyst: '#9557A9', orange: '#F4462F', stone: '#005B55' };
  const DISPLAY = '"Saira Condensed", "Arial Narrow", sans-serif', TEXT = 'Inter, system-ui, sans-serif';

  const decode = (str) => {
    const pts = []; let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  };

  const star = (ctx, x, y, r, col) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  };

  const peaks = (ctx) => {
    const layer = (pts, col, a) => { ctx.beginPath(); ctx.moveTo(0, H); pts.forEach(([x, y]) => ctx.lineTo(x * W / 600, H - 230 + y * 230 / 90)); ctx.lineTo(W, H); ctx.closePath(); ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; };
    layer([[0, 68], [67, 20], [133, 59], [200, 38], [267, 63], [333, 32], [400, 61], [467, 21], [533, 69], [600, 44]], C.stone, 0.55);
    layer([[0, 70], [46, 41], [92, 79], [138, 60], [185, 72], [231, 46], [277, 73], [323, 55], [369, 74], [415, 49], [462, 74], [508, 59], [554, 76], [600, 53]], C.copper, 0.35);
    layer([[0, 87], [35, 70], [71, 86], [106, 69], [141, 84], [176, 76], [212, 88], [247, 66], [282, 86], [318, 74], [353, 82], [388, 71], [424, 83], [459, 71], [494, 84], [529, 75], [565, 84], [600, 66]], C.page, 0.9);
  };

  const fit = (ctx, text, font, max, size) => { let s = size; do { ctx.font = font.replace('$', s); s -= 4; } while (ctx.measureText(text).width > max && s > 20); };

  const draw = async (o) => {
    if (document.fonts) { try { await Promise.all([document.fonts.load(`800 120px ${DISPLAY}`), document.fonts.load(`600 30px ${TEXT}`)]); } catch (e) { /* fall back to system fonts */ } }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, C.poster); g.addColorStop(1, '#0f3029');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    peaks(ctx);
    // Gold frame
    ctx.strokeStyle = C.copper; ctx.lineWidth = 10; ctx.strokeRect(36, 36, W - 72, H - 72);
    ctx.strokeStyle = 'rgba(179,126,44,.5)'; ctx.lineWidth = 2; ctx.strokeRect(58, 58, W - 116, H - 116);
    // Masthead
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.cream; ctx.font = `800 40px ${DISPLAY}`;
    ctx.fillText('TRAINING HUB', 110, 150);
    const tw = ctx.measureText('TRAINING HUB').width;
    star(ctx, 110 + tw + 26, 132, 11, C.copperHi); star(ctx, 110 + tw + 52, 140, 9, C.amethyst); star(ctx, 110 + tw + 74, 128, 8, C.sky);
    ctx.fillStyle = C.muted; ctx.font = `600 30px ${TEXT}`;
    ctx.fillText(o.kicker, 110, 230);
    ctx.fillStyle = C.cream; fit(ctx, o.title, `800 $px ${DISPLAY}`, W - 220, 76);
    ctx.fillText(o.title.toUpperCase(), 110, 310);
    // Big number
    ctx.fillStyle = C.copperHi; ctx.font = `800 230px ${DISPLAY}`;
    ctx.fillText(o.big, 104, 540);
    const bw = ctx.measureText(o.big).width;
    ctx.fillStyle = C.cream; ctx.font = `800 64px ${DISPLAY}`;
    ctx.fillText(o.unit.toUpperCase(), 104 + bw + 20, 540);
    // Route (ride) or bar of days (week)
    let y = 600;
    if (o.poly) {
      const pts = decode(o.poly);
      if (pts.length > 1) {
        const k = Math.cos(pts.reduce((a, p) => a + p[0], 0) / pts.length * Math.PI / 180);
        const xy = pts.map(([la, ln]) => [ln * k, -la]);
        const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const bx = 110, by = y, bwid = W - 220, bh = 330;
        const sc = Math.min(bwid / ((x1 - x0) || 1e-6), bh / ((y1 - y0) || 1e-6));
        const ox = bx + (bwid - (x1 - x0) * sc) / 2, oy = by + (bh - (y1 - y0) * sc) / 2;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); xy.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + (px - x0) * sc, oy + (py - y0) * sc));
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 16; ctx.stroke();
        ctx.strokeStyle = C.copperHi; ctx.lineWidth = 7; ctx.stroke();
        const dot = ([px, py], col) => { ctx.beginPath(); ctx.arc(ox + (px - x0) * sc, oy + (py - y0) * sc, 13, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.page; ctx.stroke(); };
        dot(xy[0], C.sky); dot(xy[xy.length - 1], C.orange);
        y += bh + 40;
      }
    } else if (o.days) {
      const max = Math.max(1, ...o.days.map((d) => d.v));
      const bx = 110, bwid = W - 220, bh = 230, gap = 18, cw = (bwid - gap * 6) / 7;
      o.days.forEach((d, i) => {
        const h = Math.max(6, d.v / max * bh), x = bx + i * (cw + gap);
        ctx.fillStyle = d.v ? (d.v >= 55 ? C.orange : C.copper) : 'rgba(246,238,219,.12)';
        ctx.fillRect(x, y + bh - h, cw, h);
        ctx.fillStyle = C.muted; ctx.font = `600 26px ${TEXT}`; ctx.textAlign = 'center';
        ctx.fillText(d.k, x + cw / 2, y + bh + 40);
        ctx.textAlign = 'left';
      });
      y += bh + 90;
    }
    // Stats row
    const n = o.stats.length, colw = (W - 220) / n;
    ctx.strokeStyle = 'rgba(246,238,219,.15)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(110, y); ctx.lineTo(W - 110, y); ctx.stroke();
    o.stats.forEach(([k, v], i) => {
      const x = 110 + i * colw;
      ctx.fillStyle = C.muted; ctx.font = `600 28px ${TEXT}`; ctx.fillText(k, x, y + 60);
      ctx.fillStyle = C.cream; fit(ctx, v, `800 $px ${DISPLAY}`, colw - 20, 64); ctx.fillText(v, x, y + 130);
    });
    // Footer
    ctx.fillStyle = C.muted; ctx.font = `600 26px ${TEXT}`;
    ctx.fillText(o.footer || 'Road to the Colombier and the Tourmalet · July 2027', 110, H - 110);
    return cv;
  };

  const share = async (o, btn) => {
    const label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Making…'; }
    try {
      const cv = await draw(o);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const name = (o.file || 'training-hub') + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: o.title }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };

  window.hubShare = { draw, share };
})();
