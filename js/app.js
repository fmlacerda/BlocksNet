/*
 * Shared shell for every UI option: lobby, game loop, keyboard, hold-to-repeat
 * buttons, winlist and haptics. Each layout only supplies a render() function
 * and wires its own touch controls to `app.act`.
 */
(function (BN) {
  'use strict';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('bn.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bn.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const BOT_NAMES = ['Blockhead', 'LineLord', 'Nukem', 'Gravitas', 'QuakeBot', 'Specialist', 'T-Spin'];
  const SKILLS = { easy: 0.15, normal: 0.5, hard: 0.85 };
  const BOT_CHAT = ['gg', 'nice!', 'who sent the nuke?', 'lol', 'argh lines', 'wp', 'again?', 's on me pls no'];

  const START_LEVELS = [1, 5, 10, 15, 20, 30, 50];
  const LINES_PER_LEVEL = [1, 2, 3, 5, 10];
  const DEFAULTS = { name: 'Player', bots: 5, skill: 'normal', speed: 'classic', startLevel: 1, linesPerLevel: 2, fullscreen: true };

  // Fullscreen API: works in Android / Linux phone browsers and on desktop. iPhone Safari has
  // no page fullscreen; there the page is full screen when launched from "Add to Home Screen".
  const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function enterFullscreen(landscape) {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      const lock = () => { if (landscape && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); };
      if (p && p.then) p.then(lock).catch(() => {}); else lock();
    } catch (e) { /* refused, e.g. not triggered by a tap */ }
  }

  let muted = false;
  function haptic(ms) {
    if (muted) return;
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* not supported */ }
  }

  // Press-and-hold with DAS/ARR style auto-repeat, using pointer events (works on iOS + Linux phones).
  function bindHold(el, fn, { repeat = true, delay = 160, rate = 45 } = {}) {
    let t1 = null, t2 = null;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      el.classList.add('pressed');
      fn();
      haptic(5);
      if (repeat) t1 = setTimeout(() => { t2 = setInterval(fn, rate); }, delay);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => el.addEventListener(ev, stop));
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  function lobbyHTML(title, subtitle) {
    const s = Object.assign({}, DEFAULTS, store.get('settings', {}));
    const opt = (list, cur, label = v => v) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label(v)}</option>`).join('');
    const fsRow = fsSupported
      ? `<label class="bn-check"><input type="checkbox" id="bn-fs" ${s.fullscreen ? 'checked' : ''}> Play fullscreen</label>`
      : (isIOS && !isStandalone() ? `<p class="bn-hint bn-fs-hint">For full screen on iPhone: Share &rarr; <b>Add to Home Screen</b>, then open BlocksNet from the icon.</p>` : '');
    return `
      <div class="bn-overlay" id="bn-lobby">
        <div class="bn-panel">
          <div class="bn-logo">Blocks<span>Net</span></div>
          <div class="bn-sub">${title}</div>
          <p class="bn-hint">${subtitle}</p>
          <label>Nickname<input id="bn-name" maxlength="12" value="${String(s.name).replace(/"/g, '')}" autocomplete="off"></label>
          <div class="bn-row">
            <label>Opponents<select id="bn-bots">${[1, 2, 3, 4, 5].map(n => `<option ${n === s.bots ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Bot skill<select id="bn-skill">${opt(Object.keys(SKILLS), s.skill)}</select></label>
          </div>
          <div class="bn-row">
            <label>Speed<select id="bn-speed">${opt(Object.keys(BN.SPEEDS), s.speed, k => BN.SPEEDS[k].label)}</select></label>
            <label>Start level<select id="bn-level">${opt(START_LEVELS, s.startLevel)}</select></label>
            <label>Level up<select id="bn-lpl">${opt(LINES_PER_LEVEL, s.linesPerLevel, n => `${n} line${n > 1 ? 's' : ''}`)}</select></label>
          </div>
          ${fsRow}
          <button class="bn-btn-primary" id="bn-start">Start game</button>
          <a class="bn-back" href="index.html">&larr; all UI options</a>
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-end">
        <div class="bn-panel">
          <div class="bn-logo" id="bn-end-title">Game over</div>
          <div class="bn-sub">Winlist</div>
          <ol class="bn-winlist" id="bn-winlist"></ol>
          <button class="bn-btn-primary" id="bn-again">Play again</button>
          <button class="bn-btn-ghost" id="bn-lobby-btn">Change settings</button>
        </div>
      </div>`;
  }

  function create(config) {
    const demo = /[?&]demo\b/.test(location.search);   // autoplay preview used by the hub page
    const room = new BN.Room();
    const app = { room, me: null, config };
    const wrap = document.createElement('div');
    wrap.innerHTML = lobbyHTML(config.title || 'Study prototype', config.subtitle || '');
    document.body.appendChild(wrap);
    const $ = id => document.getElementById(id);

    function setup() {
      const name = ($('bn-name').value.trim() || 'Player').slice(0, 12);
      const bots = +$('bn-bots').value;
      const skill = $('bn-skill').value;
      const speed = $('bn-speed').value;
      const startLevel = +$('bn-level').value;
      const linesPerLevel = +$('bn-lpl').value;
      const fullscreen = $('bn-fs') ? $('bn-fs').checked : DEFAULTS.fullscreen;
      store.set('settings', { name, bots, skill, speed, startLevel, linesPerLevel, fullscreen });
      room.settings = demo ? Object.assign({}, BN.DEFAULT_SETTINGS) : { speed, startLevel, linesPerLevel };
      app.fullscreen = fullscreen;
      room.players = []; room.bots = [];
      app.me = room.addPlayer(name, demo ? { local: true, bot: true, skill: 0.6 } : { local: true });
      const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < bots; i++) {
        const jitter = (Math.random() - 0.5) * 0.2;
        room.addPlayer(names[i], { bot: true, skill: Math.max(0, Math.min(1, SKILLS[skill] + jitter)) });
      }
      config.onSetup && config.onSetup(app);
    }

    function start() {
      if (app.fullscreen && !demo) enterFullscreen(!!config.landscape);
      $('bn-lobby').classList.add('hidden');
      $('bn-end').classList.add('hidden');
      room.start();
    }

    $('bn-start').addEventListener('click', () => { setup(); start(); });
    $('bn-again').addEventListener('click', start);
    $('bn-lobby-btn').addEventListener('click', () => { $('bn-end').classList.add('hidden'); $('bn-lobby').classList.remove('hidden'); });

    room.on('end', winner => {
      if (demo) { setTimeout(start, 2500); return; }
      const wins = store.get('winlist', {});
      if (winner) wins[winner.name] = (wins[winner.name] || 0) + 1;
      store.set('winlist', wins);
      const youWon = winner === app.me;
      if (youWon) haptic([30, 40, 30, 40, 80]);
      setTimeout(() => {
        $('bn-end-title').innerHTML = winner ? (youWon ? 'You <span>win!</span>' : `${winner.name} <span>wins</span>`) : 'Game <span>over</span>';
        $('bn-winlist').innerHTML = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([n, w]) => `<li><span>${n}</span><b>${w}</b></li>`).join('');
        $('bn-end').classList.remove('hidden');
      }, 900);
      const b = room.players.find(p => p.isBot);
      if (b) setTimeout(() => room.log(`<${b.name}> ${BOT_CHAT[Math.floor(Math.random() * BOT_CHAT.length)]}`, 'chat'), 500);
    });

    room.on('special', e => {
      if (e.target === app.me && e.from !== app.me) haptic(BN.SPECIAL_INFO[e.special].hostile ? 40 : 15);
    });
    room.on('lines', e => { if (e.targets.includes(app.me)) haptic(25); });
    room.on('death', p => {
      if (p === app.me) haptic(200);
      else if (Math.random() < 0.3) {
        const b = room.players.find(x => x.isBot && x !== p);
        if (b) setTimeout(() => room.log(`<${b.name}> ${BOT_CHAT[Math.floor(Math.random() * BOT_CHAT.length)]}`, 'chat'), 700);
      }
    });

    const act = {
      left: () => app.me && app.me.move(-1),
      right: () => app.me && app.me.move(1),
      rotate: () => app.me && app.me.rotate(1),
      rotateCCW: () => app.me && app.me.rotate(-1),
      soft: () => app.me && app.me.softDrop(),
      drop: () => app.me && app.me.hardDrop(),
      use: slot => app.me && room.useSpecial(app.me, slot),
      discard: () => app.me && room.discardSpecial(app.me),
      say: text => { if (text.trim()) room.log(`<${app.me ? app.me.name : 'you'}> ${text.trim()}`, 'chat'); },
    };
    app.act = act;
    BN.current = app;   // handy from the dev console
    app.bindHold = bindHold;

    // Keyboard (handy for desktop testing and Bluetooth keyboards on phones).
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (!room.running) return;
      const k = e.key;
      const map = { ArrowLeft: act.left, ArrowRight: act.right, ArrowUp: act.rotate, z: act.rotateCCW, x: act.rotate, ArrowDown: act.soft, ' ': act.drop, d: act.discard };
      if (map[k]) { map[k](); e.preventDefault(); }
      else if (/^[1-6]$/.test(k)) act.use(+k);
    });

    document.addEventListener('visibilitychange', () => { room.paused = document.hidden; });
    // Block iOS pinch / double-tap zoom while playing.
    document.addEventListener('gesturestart', e => e.preventDefault());
    let lastTouch = 0;
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouch < 300 && !e.target.closest('input,select,button,a')) e.preventDefault();
      lastTouch = now;
    }, { passive: false });

    let last = performance.now();
    function frame(now) {
      room.update(now - last);
      last = now;
      if (app.me) config.render(app);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Render an idle board behind the lobby so the layout is visible.
    setup();
    if (demo) { muted = true; start(); }
    return app;
  }

  BN.app = create;
  BN.store = store;
})(window.BN);
