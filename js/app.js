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
  const MAX_PLAYERS = 4;
  const DEFAULTS = { name: 'Player', bots: 3, skill: 'normal', speed: 'classic', startLevel: 1, linesPerLevel: 2, fullscreen: true };

  // Fullscreen API: works in Android / Linux phone browsers and on desktop. iPhone Safari has
  // no page fullscreen; there the page is full screen when launched from "Add to Home Screen".
  const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function enterFullscreen(orientation) {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      const lock = () => { if (orientation && screen.orientation && screen.orientation.lock) screen.orientation.lock(orientation).catch(() => {}); };
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
    s.bots = Math.max(1, Math.min(MAX_PLAYERS - 1, s.bots | 0));
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
            <label>Opponents<select id="bn-bots">${[1, 2, 3].map(n => `<option ${n === s.bots ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Bot skill<select id="bn-skill">${opt(Object.keys(SKILLS), s.skill)}</select></label>
          </div>
          <div class="bn-row">
            <label>Speed<select id="bn-speed">${opt(Object.keys(BN.SPEEDS), s.speed, k => BN.SPEEDS[k].label)}</select></label>
            <label>Start level<select id="bn-level">${opt(START_LEVELS, s.startLevel)}</select></label>
            <label>Level up<select id="bn-lpl">${opt(LINES_PER_LEVEL, s.linesPerLevel, n => `${n} line${n > 1 ? 's' : ''}`)}</select></label>
          </div>
          ${fsRow}
          <p class="bn-status error" id="bn-lobby-msg"></p>
          <button class="bn-btn-primary" id="bn-start">Play vs bots</button>
          ${BN.net ? `<div class="bn-divider"><span>or play online with friends</span></div>
          <div class="bn-row">
            <button class="bn-btn-secondary" id="bn-host">Host a room</button>
            <button class="bn-btn-secondary" id="bn-join-open">Join a room</button>
          </div>` : ''}
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-online">
        <div class="bn-panel">
          <div class="bn-logo">Blocks<span>Net</span></div>
          <div class="bn-sub" id="bn-on-title">Online room</div>
          <div id="bn-on-join" class="bn-stack hidden">
            <label>Your nickname<input id="bn-join-name" maxlength="12" autocomplete="off"></label>
            <label>Room code<input id="bn-code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDE"></label>
            <button class="bn-btn-primary" id="bn-join">Join</button>
          </div>
          <div id="bn-on-room" class="bn-stack hidden">
            <div class="bn-code-box"><small>Room code</small><b id="bn-code-show">·····</b></div>
            <button class="bn-btn-secondary" id="bn-share">Share invite link</button>
            <ol class="bn-plist" id="bn-plist"></ol>
            <div id="bn-host-ctl" class="bn-stack">
              <label>Fill empty slots with bots<select id="bn-fill">${[0, 1, 2, 3].map(n => `<option ${n === 0 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <button class="bn-btn-primary" id="bn-on-start">Start game</button>
            </div>
            <p class="bn-hint" id="bn-wait">Waiting for the host to start the game…</p>
          </div>
          <p class="bn-status" id="bn-on-status"></p>
          <button class="bn-btn-ghost" id="bn-leave">Leave room</button>
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-end">
        <div class="bn-panel">
          <div class="bn-logo" id="bn-end-title">Game over</div>
          <div class="bn-sub">Winlist</div>
          <ol class="bn-winlist" id="bn-winlist"></ol>
          <p class="bn-hint hidden" id="bn-end-wait">Waiting for the host to start the next game…</p>
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

    function readSettings() {
      const name = BN.net ? BN.net.cleanName($('bn-name').value) : ($('bn-name').value.trim() || 'Player').slice(0, 12);
      const bots = +$('bn-bots').value;
      const skill = $('bn-skill').value;
      const speed = $('bn-speed').value;
      const startLevel = +$('bn-level').value;
      const linesPerLevel = +$('bn-lpl').value;
      const fullscreen = $('bn-fs') ? $('bn-fs').checked : DEFAULTS.fullscreen;
      store.set('settings', { name, bots, skill, speed, startLevel, linesPerLevel, fullscreen });
      app.fullscreen = fullscreen;
      return { name, bots, skill, game: { speed, startLevel, linesPerLevel } };
    }

    function setup() {
      const { name, bots, skill, game } = readSettings();
      room.settings = demo ? Object.assign({}, BN.DEFAULT_SETTINGS) : game;
      room.net = null;
      room.authority = true;
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
      if (app.fullscreen && !demo) enterFullscreen(config.orientation);
      $('bn-lobby').classList.add('hidden');
      $('bn-end').classList.add('hidden');
      room.start();
    }

    $('bn-start').addEventListener('click', () => { setup(); start(); });
    $('bn-again').addEventListener('click', () => { if (session && session.isHost) hostStart(); else if (!session) start(); });
    $('bn-lobby-btn').addEventListener('click', () => {
      $('bn-end').classList.add('hidden');
      $((session ? 'bn-online' : 'bn-lobby')).classList.remove('hidden');
    });

    // ---------------------------------------------------------- online play
    let session = null;
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    const status = (text, isError) => { $('bn-on-status').textContent = text || ''; $('bn-on-status').classList.toggle('error', !!isError); };

    function sanitizeSettings(g) {
      g = g || {};
      return {
        speed: BN.SPEEDS[g.speed] ? g.speed : 'classic',
        startLevel: Math.max(1, Math.min(99, g.startLevel | 0 || 1)),
        linesPerLevel: Math.max(1, Math.min(20, g.linesPerLevel | 0 || 2)),
      };
    }

    function openOnline(mode) {
      show('bn-lobby', false); show('bn-end', false); show('bn-online', true);
      show('bn-on-join', mode === 'join');
      show('bn-on-room', mode !== 'join');
      show('bn-host-ctl', mode === 'host');
      show('bn-wait', mode === 'guest');
      $('bn-on-title').textContent = mode === 'host' ? 'Your room' : mode === 'guest' ? 'Joined room' : 'Join a room';
    }

    function leaveOnline(message) {
      if (session) { const s = session; session = null; s.close(); }
      room.net = null;
      room.authority = true;
      room.running = false;
      show('bn-online', false); show('bn-end', false); show('bn-lobby', true);
      if (message) room.log(message, 'system');
      setup();
    }

    function newSession() {
      if (session) session.close();
      const s = session = new BN.net.Session();
      s.on('status', t => status(t));
      s.on('error', t => { status(t, true); if (!s.isHost && !s.conn) { s.close(); session = null; } });
      s.on('closed', t => { if (session === s) { leaveOnline(); $('bn-lobby-msg').textContent = t; } });
      s.on('ready', code => { $('bn-code-show').textContent = code; });
      s.on('lobby', l => {
        if (!s.isHost && $('bn-on-join') && !$('bn-on-join').classList.contains('hidden')) openOnline('guest');
        $('bn-code-show').textContent = l.code || s.code;
        $('bn-plist').innerHTML = l.players.map(p => `<li>${p.name}${p.host ? ' <em>host</em>' : ''}</li>`).join('');
        const free = MAX_PLAYERS - l.players.length;
        const fill = $('bn-fill');
        [...fill.options].forEach(o => { o.disabled = +o.value > free; });
        if (+fill.value > free) fill.value = String(free);
      });
      s.on('start', msg => {
        if (session !== s) return;
        room.settings = sanitizeSettings(msg.settings);
        room.players = []; room.bots = [];
        for (const p of msg.players) {
          const mine = p.owner === msg.me;
          room.addPlayer(p.name, { slot: p.slot, remote: !mine, bot: mine && p.bot, local: mine && !p.bot, skill: p.skill ?? 0.5 });
        }
        app.me = room.players.find(p => p.isLocal) || room.players[0];
        room.net = s;
        room.authority = s.isHost;
        config.onSetup && config.onSetup(app);
        show('bn-online', false);
        start();
      });
      s.on('game', m => room.receive(m));
      s.on('chat', c => room.log(c.system ? c.text : `<${c.name}> ${c.text}`, c.system ? 'system' : 'chat'));
      return s;
    }

    function hostStart() {
      const { skill, game } = readSettings();
      session.startGame(game, +$('bn-fill').value, SKILLS[skill]);
    }

    if (BN.net && !demo) {
      const clearMsg = () => { $('bn-lobby-msg').textContent = ''; };
      ['bn-host', 'bn-join-open', 'bn-start'].forEach(id => $(id).addEventListener('click', clearMsg));
      $('bn-host').addEventListener('click', () => {
        const { name } = readSettings();
        if (app.fullscreen) enterFullscreen(config.orientation);
        $('bn-plist').innerHTML = '';
        $('bn-code-show').textContent = '·····';
        openOnline('host');
        newSession().host(name);
      });
      const openJoin = () => { status(''); $('bn-join-name').value = $('bn-name').value; openOnline('join'); };
      $('bn-join-open').addEventListener('click', () => { openJoin(); $('bn-code').focus(); });
      $('bn-join').addEventListener('click', () => {
        $('bn-name').value = $('bn-join-name').value;
        const { name } = readSettings();
        if (app.fullscreen) enterFullscreen(config.orientation);
        $('bn-plist').innerHTML = '';
        newSession().join($('bn-code').value, name);
      });
      $('bn-code').addEventListener('input', e => { e.target.value = BN.net.cleanCode(e.target.value); });
      $('bn-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('bn-join').click(); });
      $('bn-on-start').addEventListener('click', hostStart);
      $('bn-leave').addEventListener('click', () => leaveOnline());
      $('bn-share').addEventListener('click', async () => {
        if (!session) return;
        const url = session.inviteLink();
        try {
          if (navigator.share) { await navigator.share({ title: 'BlocksNet', text: `Join my BlocksNet room ${session.code}`, url }); return; }
        } catch (e) { if (e && e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(url); status('Invite link copied.'); }
        catch (e) { status(url); }
      });
      addEventListener('pagehide', () => { if (session) session.close(); });
      // Invite links look like ...?join=ABCDE
      const invite = new URLSearchParams(location.search).get('join');
      if (invite) { $('bn-code').value = BN.net.cleanCode(invite); openJoin(); }
    }

    room.on('end', winner => {
      if (demo) { setTimeout(start, 2500); return; }
      const wins = store.get('winlist', {});
      if (winner) wins[winner.name] = (wins[winner.name] || 0) + 1;
      store.set('winlist', wins);
      const youWon = winner === app.me;
      if (youWon) haptic([30, 40, 30, 40, 80]);
      const guest = !!(session && !session.isHost);
      show('bn-again', !guest);
      show('bn-end-wait', guest);
      $('bn-lobby-btn').textContent = session ? 'Back to room' : 'Change settings';
      setTimeout(() => {
        if (!room.running) show('bn-online', false);
        $('bn-end-title').innerHTML = winner ? (youWon ? 'You <span>win!</span>' : `${winner.name} <span>wins</span>`) : 'Game <span>over</span>';
        $('bn-winlist').innerHTML = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([n, w]) => `<li><span>${n}</span><b>${w}</b></li>`).join('');
        if (!room.running) $('bn-end').classList.remove('hidden');
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
      soft: () => app.me && app.me.softDrop(),
      drop: () => app.me && app.me.hardDrop(),
      use: slot => app.me && room.useSpecial(app.me, slot),
      discard: () => app.me && room.discardSpecial(app.me),
      say: text => {
        if (session) session.chat(text);
        else if (text.trim()) room.log(`<${app.me ? app.me.name : 'you'}> ${text.trim()}`, 'chat');
      },
    };
    app.act = act;
    BN.current = app;   // handy from the dev console
    app.bindHold = bindHold;

    // Keyboard (handy for desktop testing and Bluetooth keyboards on phones).
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (!room.running) return;
      const k = e.key;
      const map = { ArrowLeft: act.left, ArrowRight: act.right, ArrowUp: act.rotate, z: act.rotate, x: act.rotate, ArrowDown: act.soft, ' ': act.drop, d: act.discard };
      if (map[k]) { map[k](); e.preventDefault(); }
      else if (/^[1-6]$/.test(k)) act.use(+k);
    });

    // Online games can't pause: other phones keep playing.
    document.addEventListener('visibilitychange', () => { room.paused = document.hidden && !room.net; });
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
