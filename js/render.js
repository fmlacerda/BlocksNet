/* Canvas rendering for BlocksNet fields, next-piece box and the special bar. */
(function (BN) {
  'use strict';
  const { W, H, COLORS, SHAPES, SPECIAL_INFO, isSpecial, pieceCells } = BN;

  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v + amt * 255))));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  };

  // Size a canvas to its CSS box at device pixel ratio; returns css size.
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  function drawBlock(ctx, px, py, s, v, alpha = 1) {
    ctx.globalAlpha = alpha;
    if (isSpecial(v)) {
      ctx.fillStyle = '#14161c';
      ctx.fillRect(px, py, s, s);
      ctx.strokeStyle = SPECIAL_INFO[v].color;
      ctx.lineWidth = Math.max(1, s / 10);
      ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
      if (s >= 7) {
        ctx.fillStyle = SPECIAL_INFO[v].color;
        ctx.font = `700 ${Math.floor(s * 0.78)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v, px + s / 2, py + s / 2 + s * 0.04);
      }
    } else {
      const c = COLORS[v] || '#888';
      ctx.fillStyle = c;
      ctx.fillRect(px, py, s, s);
      if (s >= 6) {
        const b = Math.max(1, Math.floor(s / 6));
        ctx.fillStyle = shade(c, 0.28);
        ctx.fillRect(px, py, s, b);
        ctx.fillRect(px, py, b, s);
        ctx.fillStyle = shade(c, -0.32);
        ctx.fillRect(px, py + s - b, s, b);
        ctx.fillRect(px + s - b, py, b, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  /*
   * Draw a player's field to fill the canvas (keeping 12:22 cells).
   * opts: { ghost, grid, highlight, frame, valign: 'top'|'center'|'bottom', bg }
   */
  function drawField(canvas, player, opts = {}) {
    const { ctx, w, h } = fit(canvas);
    const s = Math.max(1, Math.min(w / W, h / H));
    const ox = Math.floor((w - s * W) / 2);
    const oy = opts.valign === 'top' ? 0 : opts.valign === 'bottom' ? Math.floor(h - s * H) : Math.floor((h - s * H) / 2);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.bg || '#05070c';
    ctx.fillRect(ox, oy, s * W, s * H);

    if (opts.grid && s >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < W; x++) { ctx.moveTo(ox + x * s + 0.5, oy); ctx.lineTo(ox + x * s + 0.5, oy + H * s); }
      for (let y = 1; y < H; y++) { ctx.moveTo(ox, oy + y * s + 0.5); ctx.lineTo(ox + W * s, oy + y * s + 0.5); }
      ctx.stroke();
    }

    if (!player) return { s, ox, oy };
    const f = player.field;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (f[y][x]) drawBlock(ctx, ox + x * s, oy + y * s, s, f[y][x], player.alive ? 1 : 0.35);

    // Special inventory drawn inside the top row of the field, semi-transparent so the
    // blocks underneath stay visible; the falling piece is drawn on top of it.
    if (opts.inv && opts.inv.length && player.alive) drawInventory(ctx, opts.inv, ox, oy, s, opts.invAlpha ?? 0.6);

    const p = player.piece;
    if (p && player.alive) {
      const color = SHAPES[p.type].color;
      if (opts.ghost) {
        const gy = player.ghostY();
        for (const [x, y] of pieceCells(p.type, p.rot, p.x, gy))
          if (y >= 0) drawBlock(ctx, ox + x * s, oy + y * s, s, color, 0.22);
      }
      for (const [x, y] of player.cells())
        if (y >= 0) drawBlock(ctx, ox + x * s, oy + y * s, s, color);
    }

    if (player.flash > 0) {
      const info = SPECIAL_INFO[player.flashKind];
      ctx.fillStyle = (info ? info.color : '#ff4040');
      ctx.globalAlpha = (player.flash / 600) * 0.28;
      ctx.fillRect(ox, oy, s * W, s * H);
      ctx.globalAlpha = 1;
    }

    if (opts.frame) {
      ctx.strokeStyle = opts.frame;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + 1, oy + 1, s * W - 2, s * H - 2);
    }

    if (opts.highlight) {
      ctx.strokeStyle = opts.highlight;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + 1, oy + 1, s * W - 2, s * H - 2);
    }

    if (!player.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(ox, oy, s * W, s * H);
      ctx.fillStyle = '#ff5050';
      ctx.font = `700 ${Math.max(9, Math.floor(s * 1.6))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('OUT', ox + (s * W) / 2, oy + (s * H) / 2);
    }
    return { s, ox, oy };
  }

  function drawInventory(ctx, inv, ox, oy, s, alpha) {
    const SHOW = 6;
    const n = Math.min(inv.length, SHOW);
    const pad = Math.max(1, Math.round(s * 0.08));
    const t = s - pad * 2;
    for (let i = 0; i < n; i++) drawBlock(ctx, ox + i * s + pad, oy + pad, t, inv[i], alpha);
    // The one that fires next: bright outline.
    ctx.globalAlpha = Math.min(1, alpha + 0.3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, s / 12);
    ctx.strokeRect(ox + pad / 2, oy + pad / 2, s - pad, s - pad);
    let x = ox + n * s + s * 0.15;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (inv.length > SHOW) {
      ctx.font = `700 ${Math.floor(s * 0.5)}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`+${inv.length - SHOW}`, x, oy + s / 2);
      x += s * 1.1;
    }
    const info = SPECIAL_INFO[inv[0]];
    const room = ox + 12 * s - x - s * 0.15;
    if (room > s * 1.2) {
      ctx.font = `700 ${Math.floor(s * 0.42)}px system-ui, sans-serif`;
      ctx.fillStyle = info.color;
      let name = info.name;
      while (name.length > 3 && ctx.measureText(name).width > room) name = name.slice(0, -2) + '…';
      ctx.fillText(name, x, oy + s / 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawNext(canvas, type) {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!type) return;
    const m = SHAPES[type].rots[0];
    const cells = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) cells.push([x, y]);
    const minX = Math.min(...cells.map(c => c[0])), maxX = Math.max(...cells.map(c => c[0]));
    const minY = Math.min(...cells.map(c => c[1])), maxY = Math.max(...cells.map(c => c[1]));
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const s = Math.floor(Math.min(w / 4.4, h / 2.6));
    const ox = (w - cw * s) / 2, oy = (h - ch * s) / 2;
    for (const [x, y] of cells) drawBlock(ctx, ox + (x - minX) * s, oy + (y - minY) * s, s, SHAPES[type].color);
  }

  // Inventory as a row of special tiles; first one is the one that will be used.
  function drawSpecials(canvas, inv, slots = BN.MAX_INV) {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(h, w / slots);
    for (let i = 0; i < slots; i++) {
      const x = i * s;
      if (inv[i]) drawBlock(ctx, x, 0, s - 1, inv[i]);
      else { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, 0, s - 1, s - 1); }
    }
    if (inv[0]) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, s - 3, s - 3);
    }
  }

  BN.render = { fit, drawBlock, drawField, drawNext, drawSpecials };
})(window.BN);
