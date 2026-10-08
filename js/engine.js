/*
 * BlocksNet game engine (study prototype).
 *
 * Rules:
 *  - 12x22 playfield, up to 6 players, free-for-all or teams.
 *  - "Classic" line sending: 2 lines -> 1, 3 lines -> 2, 4 lines -> 4 to every opponent.
 *  - Clearing lines drops special blocks onto your own field; clearing a line that
 *    contains a special puts it in your inventory (max 18). Use the first special
 *    on any player (1-6) or discard it.
 *  - Specials: a c n r s b g q o (see SPECIAL_INFO).
 *
 * Plain script (no modules) so pages also work from file:// on a phone.
 */
(function (global) {
  'use strict';

  const W = 12;
  const H = 22;
  const MAX_INV = 18;

  // Block palette: blue, yellow, green, purple, red.
  const COLORS = [null, '#2f5bff', '#f2cf1d', '#27c24c', '#a63de0', '#e3343c'];

  const SPECIAL_INFO = {
    a: { name: 'Add Line', hostile: true, color: '#ff5a5a', desc: 'Adds a garbage line to the bottom of the target field.' },
    c: { name: 'Clear Line', hostile: false, color: '#5ad1ff', desc: 'Removes the bottom line of the target field.' },
    n: { name: 'Nuke Field', hostile: false, color: '#ffffff', desc: 'Clears the whole target field.' },
    r: { name: 'Random Clear', hostile: true, color: '#ff9f43', desc: 'Removes 10 random blocks from the target field.' },
    s: { name: 'Switch Fields', hostile: true, color: '#ff6bd6', desc: 'You and the target swap fields.' },
    b: { name: 'Clear Specials', hostile: true, color: '#9aa4b1', desc: 'Turns all specials on the target field into normal blocks.' },
    g: { name: 'Block Gravity', hostile: false, color: '#7dff8a', desc: 'Blocks fall into every gap; completed lines vanish.' },
    q: { name: 'Blockquake', hostile: true, color: '#ffd84d', desc: 'Shakes every row of the target field sideways.' },
    o: { name: 'Block Bomb', hostile: true, color: '#ff3b3b', desc: 'Every "o" on the target field explodes, scattering blocks.' },
  };
  // Special frequencies (percent).
  const SPECIAL_FREQ = { a: 32, c: 18, n: 1, r: 11, s: 3, b: 14, g: 6, q: 6, o: 9 };

  const SHAPES = {
    I: { color: 1, m: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    O: { color: 2, m: [[1, 1], [1, 1]] },
    J: { color: 3, m: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    L: { color: 4, m: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
    Z: { color: 5, m: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    S: { color: 1, m: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    T: { color: 4, m: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  };
  const TYPES = Object.keys(SHAPES);

  function rotateCW(m) {
    const n = m.length;
    const r = m.map(row => row.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[y][x] = m[n - 1 - x][y];
    return r;
  }
  for (const t of TYPES) {
    const s = SHAPES[t];
    s.rots = [s.m];
    for (let i = 1; i < 4; i++) s.rots.push(rotateCW(s.rots[i - 1]));
  }

  const rand = n => Math.floor(Math.random() * n);
  const randomType = () => TYPES[rand(TYPES.length)];
  function randomSpecial() {
    let r = Math.random() * 100;
    for (const k in SPECIAL_FREQ) { r -= SPECIAL_FREQ[k]; if (r < 0) return k; }
    return 'a';
  }
  const emptyRow = () => new Array(W).fill(0);
  const emptyField = () => Array.from({ length: H }, emptyRow);
  const isSpecial = v => typeof v === 'string';

  function pieceCells(type, rot, px, py) {
    const m = SHAPES[type].rots[rot];
    const out = [];
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m.length; x++)
        if (m[y][x]) out.push([px + x, py + y]);
    return out;
  }

  function collides(field, cells) {
    for (const [x, y] of cells) {
      if (x < 0 || x >= W || y >= H) return true;
      if (y >= 0 && field[y][x]) return true;
    }
    return false;
  }

  function stackHeight(field) {
    for (let y = 0; y < H; y++) if (field[y].some(v => v)) return H - y;
    return 0;
  }

  // ---------------------------------------------------------------- Player
  class Player {
    constructor(room, slot, name, opts = {}) {
      this.room = room;
      this.slot = slot;            // 1..6, also the hotkey used to target this player
      this.name = name;
      this.team = opts.team || '';
      this.isBot = !!opts.bot;
      this.isLocal = !!opts.local;
      this.reset();
    }

    reset() {
      this.field = emptyField();
      this.inv = [];
      this.alive = true;
      this.lines = 0;
      this.level = 1;
      this.piece = null;
      this.next = randomType();
      this.dropTimer = 0;
      this.flash = 0;              // UI hint: >0 while recently hit by something
      this.flashKind = '';
    }

    get height() { return stackHeight(this.field); }

    get dropInterval() { return Math.max(90, 1000 - (this.level - 1) * 12); }

    spawn() {
      const type = this.next;
      this.next = randomType();
      const m = SHAPES[type].rots[0];
      let top = 0;
      while (!m[top].some(Boolean)) top++;
      this.piece = { type, rot: 0, x: Math.floor((W - m.length) / 2), y: -top };
      this.dropTimer = 0;
      if (collides(this.field, this.cells())) this.die();
    }

    cells(p = this.piece) { return pieceCells(p.type, p.rot, p.x, p.y); }

    tryMove(dx, dy) {
      if (!this.alive || !this.piece) return false;
      const p = this.piece;
      if (collides(this.field, pieceCells(p.type, p.rot, p.x + dx, p.y + dy))) return false;
      p.x += dx; p.y += dy;
      return true;
    }

    move(dx) { return this.tryMove(dx, 0); }

    rotate(dir = 1) {
      if (!this.alive || !this.piece) return false;
      const p = this.piece;
      const rot = (p.rot + dir + 4) % 4;
      for (const k of [0, -1, 1, -2, 2]) {
        if (!collides(this.field, pieceCells(p.type, rot, p.x + k, p.y))) {
          p.rot = rot; p.x += k;
          return true;
        }
      }
      return false;
    }

    softDrop() {
      if (!this.alive || !this.piece) return;
      if (!this.tryMove(0, 1)) this.lock();
      this.dropTimer = 0;
    }

    hardDrop() {
      if (!this.alive || !this.piece) return;
      while (this.tryMove(0, 1));
      this.lock();
    }

    ghostY() {
      const p = this.piece;
      let y = p.y;
      while (!collides(this.field, pieceCells(p.type, p.rot, p.x, y + 1))) y++;
      return y;
    }

    lock() {
      const p = this.piece;
      const color = SHAPES[p.type].color;
      let overflow = false;
      for (const [x, y] of this.cells()) {
        if (y < 0) overflow = true; else this.field[y][x] = color;
      }
      this.piece = null;
      if (overflow) return this.die();
      this.clearLines();
      if (this.alive) this.spawn();
    }

    clearLines() {
      let cleared = 0;
      for (let y = H - 1; y >= 0; y--) {
        if (this.field[y].every(v => v)) {
          for (const v of this.field[y]) if (isSpecial(v) && this.inv.length < MAX_INV) this.inv.push(v);
          this.field.splice(y, 1);
          this.field.unshift(emptyRow());
          cleared++;
          y++;
        }
      }
      if (!cleared) return;
      this.lines += cleared;
      this.level = 1 + Math.floor(this.lines / 2);
      this.room.onLinesCleared(this, cleared);
      for (let i = 0; i < cleared; i++) this.addSpecialToField();
    }

    addSpecialToField() {
      const spots = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (this.field[y][x] && !isSpecial(this.field[y][x])) spots.push([x, y]);
      if (!spots.length) return;
      const [x, y] = spots[rand(spots.length)];
      this.field[y][x] = randomSpecial();
    }

    die() {
      if (!this.alive) return;
      this.alive = false;
      this.piece = null;
      // A dead player's field is filled with random garbage.
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.field[y][x] = 1 + rand(5);
      this.room.onDeath(this);
    }

    // After a field is modified by an attack, push the falling piece up if needed.
    fixPiece() {
      if (!this.piece) return;
      let guard = 0;
      while (collides(this.field, this.cells()) && guard++ < H) this.piece.y--;
    }

    update(dt) {
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
      if (!this.alive || !this.piece) return;
      this.dropTimer += dt;
      const iv = this.dropInterval;
      while (this.dropTimer >= iv && this.piece) {
        this.dropTimer -= iv;
        if (!this.tryMove(0, 1)) this.lock();
      }
    }

    hit(kind) { this.flash = 600; this.flashKind = kind; }

    // ----- field operations used by line sending and specials
    addLines(n) {
      for (let i = 0; i < n; i++) {
        if (this.field[0].some(v => v)) { this.die(); return; }
        this.field.shift();
        const row = emptyRow().map(() => (Math.random() < 0.55 ? 1 + rand(5) : 0));
        row[rand(W)] = 0;
        this.field.push(row);
      }
      this.fixPiece();
    }

    clearBottomLine() {
      this.field.pop();
      this.field.unshift(emptyRow());
    }

    nuke() { this.field = emptyField(); }

    randomClear() {
      for (let i = 0; i < 10; i++) {
        const y = rand(H), x = rand(W);
        this.field[y][x] = 0;
      }
    }

    clearSpecials() {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (isSpecial(this.field[y][x])) this.field[y][x] = 1 + rand(5);
    }

    gravity() {
      for (let x = 0; x < W; x++) {
        const col = [];
        for (let y = H - 1; y >= 0; y--) if (this.field[y][x]) col.push(this.field[y][x]);
        for (let y = H - 1, i = 0; y >= 0; y--, i++) this.field[y][x] = i < col.length ? col[i] : 0;
      }
      // Lines completed by gravity vanish without sending lines or awarding specials.
      for (let y = H - 1; y >= 0; y--) {
        if (this.field[y].every(v => v)) { this.field.splice(y, 1); this.field.unshift(emptyRow()); y++; }
      }
    }

    quake() {
      for (let y = 0; y < H; y++) {
        const s = rand(5) - 2;
        if (!s) continue;
        const row = this.field[y];
        this.field[y] = row.map((_, x) => row[(x - s + W) % W]);
      }
    }

    bomb() {
      const scattered = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (this.field[y][x] !== 'o') continue;
        this.field[y][x] = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          const v = this.field[ny][nx];
          if (v && v !== 'o') { scattered.push(v); this.field[ny][nx] = 0; }
        }
      }
      for (const v of scattered) {
        const y = 6 + rand(H - 6), x = rand(W);
        if (!this.field[y][x]) this.field[y][x] = v;
      }
    }

    // Keep the top 6 rows free after a field switch.
    makeHeadroom() {
      // A received field taller than 16 rows is shifted down (bottom rows drop off).
      while (this.field.slice(0, 6).some(r => r.some(v => v))) {
        this.field.pop();
        this.field.unshift(emptyRow());
      }
    }
  }

  // ---------------------------------------------------------------- Bot brain
  // Pierre Dellacherie-style heuristic placement, with skill-dependent speed and noise.
  class BotBrain {
    constructor(player, skill = 0.5) {
      this.p = player;
      this.skill = skill;
      this.plan = null;
      this.planFor = null;
      this.actTimer = 0;
      this.specialTimer = 1500 + Math.random() * 3000;
    }

    get actDelay() { return 220 - this.skill * 170; }

    evaluate(field) {
      let agg = 0, holes = 0, bump = 0, prev = -1;
      for (let x = 0; x < W; x++) {
        let h = 0, seen = false;
        for (let y = 0; y < H; y++) {
          if (field[y][x]) { if (!seen) { h = H - y; seen = true; } }
          else if (seen) holes++;
        }
        agg += h;
        if (prev >= 0) bump += Math.abs(h - prev);
        prev = h;
      }
      return { agg, holes, bump };
    }

    choose() {
      const p = this.p, piece = p.piece;
      let best = null;
      for (let rot = 0; rot < 4; rot++) {
        for (let x = -3; x < W; x++) {
          if (collides(p.field, pieceCells(piece.type, rot, x, piece.y))) continue;
          let y = piece.y;
          while (!collides(p.field, pieceCells(piece.type, rot, x, y + 1))) y++;
          const f = p.field.map(r => r.slice());
          for (const [cx, cy] of pieceCells(piece.type, rot, x, y)) if (cy >= 0) f[cy][cx] = 1;
          let lines = 0;
          for (let r = 0; r < H; r++) if (f[r].every(v => v)) lines++;
          const e = this.evaluate(f);
          let score = -0.51 * e.agg + 0.76 * lines - 0.36 * e.holes - 0.18 * e.bump;
          score += (Math.random() - 0.5) * (1 - this.skill) * 6;
          if (!best || score > best.score) best = { rot, x, score };
        }
      }
      return best;
    }

    useSpecials(dt) {
      const p = this.p;
      if (!p.inv.length) return;
      this.specialTimer -= dt;
      if (this.specialTimer > 0) return;
      this.specialTimer = 1200 + Math.random() * (4000 - this.skill * 2500);
      const s = p.inv[0];
      const room = p.room;
      const opps = room.opponentsOf(p);
      const h = p.height;
      const tallest = opps.slice().sort((a, b) => b.height - a.height)[0];
      const lowest = opps.slice().sort((a, b) => a.height - b.height)[0];
      let target = null;
      if (s === 'n') target = h > 12 ? p : null;
      else if (s === 'c' || s === 'g') target = h > 6 ? p : null;
      else if (s === 's') target = h > 13 && lowest ? lowest : null;
      else if (s === 'b') target = opps.find(o => o.inv.length > 2 || o.field.some(r => r.some(isSpecial))) || null;
      else if (opps.length) target = Math.random() < 0.5 ? tallest : opps[rand(opps.length)];
      if (target) room.useSpecial(p, target.slot);
      else if (p.inv.length > 8) room.discardSpecial(p);
    }

    update(dt) {
      const p = this.p;
      if (!p.alive || !p.piece) return;
      this.useSpecials(dt);
      if (this.planFor !== p.piece) { this.plan = this.choose(); this.planFor = p.piece; }
      this.actTimer += dt;
      while (this.actTimer >= this.actDelay && p.piece && this.planFor === p.piece) {
        this.actTimer -= this.actDelay;
        const pl = this.plan, pc = p.piece;
        if (!pl) { p.hardDrop(); break; }
        if (pc.rot !== pl.rot) { if (!p.rotate(1)) pl.rot = pc.rot; }
        else if (pc.x < pl.x) { if (!p.move(1)) pl.x = pc.x; }
        else if (pc.x > pl.x) { if (!p.move(-1)) pl.x = pc.x; }
        else if (this.skill > 0.3 || Math.random() < 0.5) { p.hardDrop(); }
        else p.softDrop();
      }
    }
  }

  // ---------------------------------------------------------------- Room
  // A Room is the authority that routes lines and specials between players.
  // For real multiplayer this same object runs on a server; clients send
  // intents (move/rotate/drop/useSpecial) and receive field snapshots.
  class Room {
    constructor() {
      this.players = [];
      this.bots = [];
      this.listeners = {};
      this.running = false;
      this.paused = false;
      this.elapsed = 0;
      this.winner = null;
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, data) { (this.listeners[ev] || []).forEach(fn => fn(data)); }

    addPlayer(name, opts = {}) {
      const p = new Player(this, this.players.length + 1, name, opts);
      this.players.push(p);
      if (opts.bot) this.bots.push(new BotBrain(p, opts.skill ?? 0.5));
      return p;
    }

    bySlot(slot) { return this.players.find(p => p.slot === slot); }

    opponentsOf(p) {
      return this.players.filter(o => o !== p && o.alive && (!p.team || o.team !== p.team));
    }

    log(text, kind = 'info') { this.emit('log', { text, kind, t: this.elapsed }); }

    start() {
      this.players.forEach(p => p.reset());
      this.players.forEach(p => p.spawn());
      this.running = true;
      this.paused = false;
      this.elapsed = 0;
      this.winner = null;
      this.log('*** The game has started ***', 'system');
      this.emit('start');
    }

    update(dt) {
      if (!this.running || this.paused) return;
      dt = Math.min(dt, 100);
      this.elapsed += dt;
      for (const b of this.bots) b.update(dt);
      for (const p of this.players) p.update(dt);
    }

    onLinesCleared(p, n) {
      const send = { 2: 1, 3: 2, 4: 4 }[n] || 0;
      if (!send) return;
      const targets = this.opponentsOf(p);
      targets.forEach(o => { o.addLines(send); o.hit('a'); });
      this.log(`${send} line${send > 1 ? 's' : ''} added to all by ${p.name}`, 'lines');
      this.emit('lines', { from: p, count: send, targets });
    }

    useSpecial(from, slot) {
      if (!this.running || !from.alive || !from.inv.length) return false;
      const target = this.bySlot(slot);
      if (!target || !target.alive) return false;
      const s = from.inv.shift();
      switch (s) {
        case 'a': target.addLines(1); break;
        case 'c': target.clearBottomLine(); break;
        case 'n': target.nuke(); break;
        case 'r': target.randomClear(); break;
        case 'b': target.clearSpecials(); break;
        case 'g': target.gravity(); break;
        case 'q': target.quake(); break;
        case 'o': target.bomb(); break;
        case 's': {
          if (target !== from) {
            const tmp = from.field; from.field = target.field; target.field = tmp;
            from.makeHeadroom(); target.makeHeadroom();
            from.fixPiece();
          }
          break;
        }
      }
      target.fixPiece();
      target.hit(s);
      const info = SPECIAL_INFO[s];
      const kind = target === from ? 'self' : (info.hostile ? 'attack' : 'special');
      this.log(`${info.name} on ${target === from ? 'self' : target.name} by ${from.name}`, kind);
      this.emit('special', { from, target, special: s });
      return true;
    }

    discardSpecial(p) {
      if (!p.inv.length) return;
      p.inv.shift();
    }

    onDeath(p) {
      this.log(`${p.name} has been eliminated`, 'death');
      this.emit('death', p);
      const alive = this.players.filter(o => o.alive);
      const teams = new Set(alive.map(o => o.team || '#' + o.slot));
      if (this.players.length > 1 && teams.size <= 1) this.finish(alive[0] || p);
      else if (this.players.length === 1) this.finish(null);
    }

    finish(winner) {
      if (!this.running) return;
      this.running = false;
      this.winner = winner;
      this.log(winner ? `*** ${winner.team ? 'Team ' + winner.team : winner.name} wins! ***` : '*** Game over ***', 'system');
      this.emit('end', winner);
    }
  }

  global.BN = Object.assign(global.BN || {}, {
    W, H, MAX_INV, COLORS, SHAPES, SPECIAL_INFO, SPECIAL_FREQ,
    Room, Player, BotBrain, pieceCells, isSpecial,
  });
})(window);
