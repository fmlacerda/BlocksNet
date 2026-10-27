/*
 * Game summary as a PNG image (for "Copy image" in public rooms).
 * Drawn straight onto a canvas, so it looks the same in every browser, iPhone Safari included.
 *
 * RB.statsImage.render(s) → Promise<Blob>, where s is
 *   { title, date, footer, players: [{ name, color, bot, wins, games, lines, sent, busts, ppm, used, short }],
 *     games: [{ n, winner, winColor, time, lines: '12–5', sent: '9–4' }], total, notes: [string] }
 * RB.statsImage.copy(blobPromise) → 'copied' | 'shared' | 'saved' | 'failed'
 */
(function (RB) {
  'use strict';

  const t = (key, p) => RB.t(key, p);
  const W = 1080, PAD = 60, BOX = W - PAD * 2;
  const C = { bg: '#160B2E', box: '#251550', line: '#34205E', text: '#F5F0FF', soft: '#C4B8E3', dim: '#A99BCB', lime: '#C6FF3D', dot: '#FFD84D' };
  const SANS = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
  const DISPLAY = 'Bungee, "Arial Black", Impact, sans-serif';

  async function fontsReady() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.race([
        Promise.all(['400 60px Bungee', '700 30px "Space Grotesk"', '500 30px "Space Grotesk"'].map(f => document.fonts.load(f))),
        new Promise(r => setTimeout(r, 1500)),
      ]);
    } catch (e) { /* draw with fallback fonts */ }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function panel(ctx, y, h) {
    roundRect(ctx, PAD, y, BOX, h, 28);
    ctx.fillStyle = C.box; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.line; ctx.stroke();
  }
  // Text that never runs wider than maxW (trimmed with an ellipsis).
  function text(ctx, s, x, y, { font, color = C.text, align = 'left', maxW = 0, spacing = 0 } = {}) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
    let t = String(s);
    if (maxW) while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
    ctx.fillText(t, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  // Word-wrap for the highlight lines.
  function wrap(ctx, s, maxW) {
    const words = s.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // The Rowbusters mark (same shapes as the logo), drawn at x,y with the given size.
  function mark(ctx, x, y, size) {
    const k = size / 120;
    const sq = (rx, ry, w, rot, fill, alpha = 1) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fill;
      ctx.translate(x + (rx + w / 2) * k, y + (ry + w / 2) * k); ctx.rotate(rot * Math.PI / 180);
      roundRect(ctx, -w / 2 * k, -w / 2 * k, w * k, w * k, 3 * k); ctx.fill(); ctx.restore();
    };
    sq(10, 10, 22, 0, '#FF2E88', 0.45); sq(62, 10, 22, 0, '#FF2E88', 0.45);
    for (const rx of [10, 36, 62, 88]) sq(rx, 88, 22, 0, '#FF2E88');
    sq(2, 50, 22, -16, C.lime); sq(34, 42, 22, 8, C.lime); sq(64, 54, 22, -6, C.lime); sq(96, 44, 22, 18, C.lime);
    sq(56, 36, 6, 0, C.lime); sq(88, 36, 5, 0, C.lime); sq(26, 78, 5, 0, C.lime); sq(112, 74, 6, 0, C.lime);
  }

  function draw(ctx, s) {
    let y = PAD;
    const P = s.players, two = P.length === 2;

    // Header: mark, room, date
    mark(ctx, W / 2 - 36, y, 72); y += 104;
    text(ctx, s.title.toUpperCase(), W / 2, y, { font: `700 34px ${SANS}`, color: C.dim, align: 'center', spacing: 4, maxW: BOX });
    y += 46;
    text(ctx, s.date, W / 2, y, { font: `500 28px ${SANS}`, color: C.dim, align: 'center' });
    y += 44;

    // Scoreboard
    const cols = Math.min(Math.max(P.length, 1), 4), rowsN = Math.ceil(P.length / cols);
    const cellH = two ? 220 : 190, scoreH = rowsN * cellH + 40;
    panel(ctx, y, scoreH);
    P.forEach((p, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const cx = two ? PAD + BOX * (i === 0 ? 0.27 : 0.73) : PAD + BOX * (c + 0.5) / cols;
      const top = y + 30 + r * cellH;
      text(ctx, p.name, cx, top + 52, { font: `700 ${two ? 50 : 38}px ${SANS}`, color: p.color, align: 'center', maxW: two ? BOX * 0.42 : BOX / cols - 20 });
      text(ctx, p.wins, cx, top + (two ? 180 : 150), { font: `400 ${two ? 130 : 96}px ${DISPLAY}`, color: C.text, align: 'center' });
      if (p.bot) text(ctx, t('bot'), cx, top + (two ? 210 : 178), { font: `500 22px ${SANS}`, color: C.dim, align: 'center' });
    });
    if (two) text(ctx, '–', W / 2, y + 30 + 160, { font: `400 90px ${DISPLAY}`, color: C.dim, align: 'center' });
    y += scoreH + 36;

    // Game by game
    const many = P.length > 2;
    const head = 70, rowH = many ? 76 : 88, gamesH = head + s.games.length * rowH + 24;
    panel(ctx, y, gamesH);
    const gx = [PAD + 40, PAD + BOX * 0.27, PAD + BOX * 0.48, PAD + BOX * 0.68, PAD + BOX * 0.88];   // #, winner, time, lines, sent
    const fs = many ? 30 : 36;
    const hdrFont = `700 ${many ? 24 : 28}px ${SANS}`;
    const initials = P.map(p => p.short).join('–');
    text(ctx, '#', gx[0], y + 52, { font: hdrFont, color: C.dim });
    text(ctx, t('sum.winner'), gx[1], y + 52, { font: hdrFont, color: C.dim, align: 'center' });
    text(ctx, t('sum.time'), gx[2], y + 52, { font: hdrFont, color: C.dim, align: 'center' });
    text(ctx, `${t('sum.lines')} ${initials}`, gx[3], y + 52, { font: hdrFont, color: C.dim, align: 'center', maxW: BOX * 0.22 });
    text(ctx, `${t('sum.sent')} ${initials}`, gx[4], y + 52, { font: hdrFont, color: C.dim, align: 'center', maxW: BOX * 0.2 });
    s.games.forEach((g, i) => {
      const ry = y + head + i * rowH;
      ctx.fillStyle = C.line; ctx.fillRect(PAD + 30, ry, BOX - 60, 2);
      const base = ry + rowH / 2 + fs * 0.36;
      text(ctx, g.n, gx[0], base, { font: `500 ${fs}px ${SANS}` });
      text(ctx, g.winner, gx[1], base, { font: `700 ${fs}px ${SANS}`, color: g.winColor || C.text, align: 'center', maxW: BOX * 0.25 });
      text(ctx, g.time, gx[2], base, { font: `500 ${fs}px ${SANS}`, align: 'center' });
      text(ctx, g.lines, gx[3], base, { font: `500 ${fs}px ${SANS}`, align: 'center', maxW: BOX * 0.22 });
      text(ctx, g.sent, gx[4], base, { font: `500 ${fs}px ${SANS}`, align: 'center', maxW: BOX * 0.2 });
    });
    y += gamesH + 36;

    // Totals
    const statRows = [[t('sum.gamesWon'), p => `${p.wins}/${p.games}`], [t('sum.linesCleared'), p => p.lines], [t('sum.linesSent'), p => p.sent],
      [t('sum.busts'), p => p.busts], [t('sum.avgPpm'), p => p.ppm], [t('sum.used'), p => p.used]];
    if (two || P.length < 2) {
      const lh = 58, totH = 100 + 50 + statRows.length * lh + 20;
      panel(ctx, y, totH);
      text(ctx, t('sum.totals', { time: s.total }).toUpperCase(), PAD + 40, y + 62, { font: `700 30px ${SANS}`, color: C.dim, spacing: 2 });
      const xs = P.length === 2 ? [PAD + BOX * 0.62, PAD + BOX * 0.86] : [PAD + BOX * 0.8];
      P.forEach((p, i) => text(ctx, p.name, xs[i], y + 122, { font: `700 34px ${SANS}`, color: p.color, align: 'center', maxW: BOX * 0.22 }));
      statRows.forEach(([label, f], r) => {
        const ry = y + 122 + 50 + r * lh + 10;
        text(ctx, label, PAD + 40, ry, { font: `500 34px ${SANS}`, color: C.soft });
        P.forEach((p, i) => text(ctx, f(p), xs[i], ry, { font: `700 36px ${SANS}`, align: 'center' }));
      });
      y += totH + 36;
    } else {
      const lh = 66, totH = 100 + 40 + P.length * lh + 70;
      panel(ctx, y, totH);
      text(ctx, t('sum.totals', { time: s.total }).toUpperCase(), PAD + 40, y + 62, { font: `700 30px ${SANS}`, color: C.dim, spacing: 2 });
      const tx = [PAD + 40, PAD + BOX * 0.5, PAD + BOX * 0.6, PAD + BOX * 0.7, PAD + BOX * 0.78, PAD + BOX * 0.87, PAD + BOX * 0.95];
      [t('sum.player'), t('sum.won'), t('sum.lines'), t('sum.sent'), '4×', t('sum.ppm'), t('sum.spec')].forEach((h, i) =>
        text(ctx, h.toUpperCase(), tx[i], y + 118, { font: `700 22px ${SANS}`, color: C.dim, align: i ? 'center' : 'left' }));
      P.forEach((p, r) => {
        const ry = y + 140 + r * lh;
        ctx.fillStyle = C.line; ctx.fillRect(PAD + 30, ry, BOX - 60, 2);
        const base = ry + lh / 2 + 12;
        text(ctx, p.name + (p.bot ? ` (${t('bot')})` : ''), tx[0], base, { font: `700 32px ${SANS}`, color: p.color, maxW: BOX * 0.38 });
        [`${p.wins}/${p.games}`, p.lines, p.sent, p.busts, p.ppm, p.used].forEach((v, i) =>
          text(ctx, v, tx[i + 1], base, { font: `700 30px ${SANS}`, align: 'center' }));
      });
      text(ctx, t('sum.legend'), PAD + 40, y + totH - 28, { font: `500 22px ${SANS}`, color: C.dim, maxW: BOX - 80 });
      y += totH + 36;
    }

    // Highlights
    ctx.font = `500 32px ${SANS}`;
    for (const n of s.notes) {
      const lines = wrap(ctx, n, BOX - 60);
      ctx.fillStyle = C.dot; ctx.beginPath(); ctx.arc(PAD + 16, y + 18, 9, 0, Math.PI * 2); ctx.fill();
      lines.forEach((l, i) => text(ctx, l, PAD + 46, y + 30 + i * 42, { font: `500 32px ${SANS}` }));
      y += lines.length * 42 + 20;
    }
    if (s.notes.length) y += 16;

    // Footer
    text(ctx, s.footer, W / 2, y + 30, { font: `700 28px ${SANS}`, color: C.lime, align: 'center', spacing: 2 });
    return y + 30 + PAD;
  }

  async function render(s) {
    await fontsReady();
    // Draw on a tall canvas, then crop to the height actually used.
    const big = document.createElement('canvas');
    big.width = W; big.height = 6000;
    const bctx = big.getContext('2d');
    bctx.fillStyle = C.bg; bctx.fillRect(0, 0, W, big.height);
    const h = Math.min(big.height, Math.ceil(draw(bctx, s)));
    const out = document.createElement('canvas');
    out.width = W; out.height = h;
    out.getContext('2d').drawImage(big, 0, 0);
    return new Promise((resolve, reject) => out.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
  }

  // Copy the image to the clipboard. Safari needs the clipboard call to happen right away in the
  // tap, with the image still being drawn, so it gets the promise. If images can't be copied:
  // the share sheet (phones), else a download.
  async function copy(blobPromise, fileName = 'rowbusters-stats.png') {
    try {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        return 'copied';
      }
    } catch (e) {
      try {   // some browsers want the finished image rather than a promise
        if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': await blobPromise })]);
          return 'copied';
        }
      } catch (e2) { /* fall through */ }
    }
    let blob;
    try { blob = await blobPromise; } catch (e) { return 'failed'; }
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared'; }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return 'saved';
    } catch (e) { return 'failed'; }
  }

  RB.statsImage = { render, copy };
})(window.RB = window.RB || {});
