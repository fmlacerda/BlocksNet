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
          <div class="bn-sound-test"><button class="bn-btn-ghost" id="bn-test-sound" type="button">&#128266; Test sound</button><span id="bn-sound-status"></span></div>
          <p class="bn-status error" id="bn-lobby-msg"></p>
          <button class="bn-btn-primary" id="bn-start">Play vs bots</button>
          ${BN.net ? `<div class="bn-divider"><span>or play online</span></div>
          ${BN.net.serverURL() ? '<button class="bn-btn-secondary bn-mp-btn" id="bn-mp-open" type="button">Multiplayer · public rooms</button>' : ''}
          <div class="bn-row bn-private-row">
            <button class="bn-btn-secondary" id="bn-host">${BN.net.serverURL() ? 'Private room' : 'Host a room'}</button>
            <button class="bn-btn-secondary" id="bn-join-open">${BN.net.serverURL() ? 'Join with code' : 'Join a room'}</button>
          </div>` : ''}
          <p class="bn-version">v${BN.VERSION}${BN.net ? ' · <button class="bn-linkbtn" id="bn-diag-open" type="button">connection details</button>' : ''}</p>
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-mp">
        <div class="bn-panel bn-mp-panel">
          <div class="bn-mp-top"><div class="bn-logo">Blocks<span>Net</span></div><span>Multiplayer</span></div>
          <div class="bn-mp-me" id="bn-mp-me">Loading…</div>
          <p class="bn-status error" id="bn-mp-msg"></p>
          <div class="bn-h2">Rooms</div>
          <div class="bn-rooms" id="bn-rooms"></div>
          <div class="bn-h2">Top players</div>
          <div class="bn-rank">
            <div class="bn-period"><button class="on" data-period="top" type="button">All time</button><button data-period="week" type="button">This week</button></div>
            <ol id="bn-rank-list"></ol>
            <p class="bn-hint bn-rank-note">Games with 2 or more real players count. The server decides the winner.</p>
          </div>
          <button class="bn-btn-ghost" id="bn-mp-back" type="button">&larr; Back</button>
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-online">
        <div class="bn-panel" id="bn-on-panel">
          <div class="bn-logo bn-on-logo">Blocks<span>Net</span></div>
          <div class="bn-sub" id="bn-on-title">Online room</div>
          <div id="bn-on-join" class="bn-stack hidden">
            <label>Your nickname<input id="bn-join-name" maxlength="12" autocomplete="off"></label>
            <label>Room code<input id="bn-code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDE"></label>
            <button class="bn-btn-primary" id="bn-join">Join</button>
          </div>
          <div id="bn-on-room" class="bn-room hidden">
            <div class="bn-room-head">
              <div class="bn-code-box"><small id="bn-code-label">Room code</small><b id="bn-code-show">·····</b></div>
              <button class="bn-btn-secondary" id="bn-share" type="button">Invite</button>
            </div>
            <ol class="bn-plist" id="bn-plist"></ol>
            <div class="bn-chat" id="bn-chat" aria-live="polite"></div>
            <form class="bn-chat-form" id="bn-chat-form">
              <input id="bn-chat-in" maxlength="200" autocomplete="off" enterkeyhint="send" placeholder="Say something…">
              <button type="submit">Send</button>
            </form>
            <div id="bn-host-ctl" class="bn-host-row">
              <label>Bots<select id="bn-fill">${[0, 1, 2, 3].map(n => `<option ${n === 0 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <button class="bn-btn-primary" id="bn-on-start" type="button">Start game</button>
            </div>
            <p class="bn-hint" id="bn-wait">Waiting for the host to start the game…</p>
          </div>
          <p class="bn-status" id="bn-on-status"></p>
          <div class="bn-row bn-room-foot">
            <button class="bn-btn-ghost" id="bn-leave" type="button">Leave room</button>
            <button class="bn-btn-ghost" id="bn-diag-open2" type="button">Connection details</button>
          </div>
        </div>
      </div>
      <div class="bn-overlay hidden" id="bn-diag-sheet">
        <div class="bn-panel bn-panel-room">
          <div class="bn-sub">Connection details</div>
          <p class="bn-hint">If online play fails, tap Copy and send this to whoever is helping you.</p>
          <pre class="bn-diag" id="bn-diag"></pre>
          <div class="bn-row">
            <button class="bn-btn-secondary" id="bn-diag-copy" type="button">Copy</button>
            <button class="bn-btn-primary" id="bn-diag-close" type="button">Close</button>
          </div>
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
    if (BN.sound) {
      // Plays a short beep (even if game sound is muted) and shows the audio status,
      // so a player can tell whether the phone is blocking sound.
      $('bn-test-sound').addEventListener('click', () => {
        BN.sound.unlock();
        $('bn-sound-status').textContent = 'starting…';
        setTimeout(() => { BN.sound.play('test', null, true); $('bn-sound-status').textContent = BN.sound.status(); }, 250);
      });
    } else $('bn-test-sound').parentElement.remove();
    $('bn-again').addEventListener('click', () => { if (session && session.isHost) hostStart(); else if (!session) start(); });
    $('bn-lobby-btn').addEventListener('click', () => {
      $('bn-end').classList.add('hidden');
      $((session ? 'bn-online' : 'bn-lobby')).classList.remove('hidden');
    });

    // ---------------------------------------------------------- online play
    let session = null;
    app.session = () => session;   // for debugging and tests
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
      $('bn-on-panel').classList.toggle('bn-panel-room', mode !== 'join');
      show('bn-host-ctl', mode === 'host');
      show('bn-wait', mode === 'guest');
      $('bn-on-title').textContent = mode === 'join' ? 'Join a room' : 'Partyline';
      if (mode !== 'join') setTimeout(() => { const c = $('bn-chat'); c.scrollTop = c.scrollHeight; }, 0);
    }

    function leaveOnline(message) {
      if (session) { const s = session; session = null; s.close(); }
      room.net = null;
      room.authority = true;
      room.running = false;
      show('bn-online', false); show('bn-end', false); show('bn-lobby', true);
      if (message) room.log(message, 'system');
      setup();
      setTimeout(maybeUpdate, 0);
    }

    // Room chat (the partyline before and between games).
    function roomChat(text, kind = 'chat') {
      const c = $('bn-chat');
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
      const div = document.createElement('div');
      div.className = 'log-line log-' + kind;
      div.textContent = text;
      c.appendChild(div);
      while (c.children.length > 200) c.firstChild.remove();
      if (atBottom || kind !== 'chat') c.scrollTop = c.scrollHeight;
    }

    function newSession(kind = 'p2p') {
      $('bn-chat').innerHTML = '';
      if (session) session.close();
      const s = session = kind === 'server' ? new BN.net.ServerSession() : new BN.net.Session();
      $('bn-code-label').textContent = s.public ? 'Public room' : 'Room code';
      $('bn-code-show').classList.toggle('bn-room-name', !!s.public);
      s.on('status', t => status(t));
      s.on('error', t => {
        if (s.public) { if (session === s) { session = null; show('bn-online', false); openMP(t); } return; }
        status(t, true); if (!s.isHost && !s.conn) { s.close(); session = null; }
      });
      s.on('closed', t => {
        if (session !== s) return;
        leaveOnline();
        if (s.public) openMP(t); else $('bn-lobby-msg').textContent = t;
      });
      s.on('ready', code => {
        $('bn-code-show').textContent = code;
        roomChat(s.public
          ? (s.spectator
            ? `You are watching ${code} (all 4 seats are taken). You will get a seat when one is free after a game.`
            : `Welcome to ${code}. Chat here; ${s.isHost ? 'you are the host, so you start the game when everyone is ready.' : 'the host starts the game.'}`)
          : `Room ${code} is open. Tap Invite to send the link, chat here, then start the game.`, 'system');
      });
      s.on('role', isHost => {
        if (session !== s || room.running) return;
        if (!$('bn-online').classList.contains('hidden') || !$('bn-end').classList.contains('hidden')) openOnline(isHost ? 'host' : 'guest');
      });
      s.on('lobby', l => {
        if (!s.isHost && $('bn-on-join') && !$('bn-on-join').classList.contains('hidden')) openOnline('guest');
        $('bn-code-show').textContent = l.code || s.code;
        $('bn-plist').innerHTML = l.players.map(p => `<li>${p.name}${p.host ? ' <em>host</em>' : ''}</li>`).join('')
          + (l.watchers || []).map(n => `<li class="watcher">&#128065; ${n}</li>`).join('');
        const free = MAX_PLAYERS - l.players.length;
        const fill = $('bn-fill');
        [...fill.options].forEach(o => { o.disabled = +o.value > free; });
        if (+fill.value > free) fill.value = String(free);
      });
      s.on('start', msg => {
        if (session !== s) return;
        if (!msg.players.some(p => p.owner === msg.me)) { enterWatch(s, msg, false); return; }
        setWatching(false);
        room.settings = sanitizeSettings(msg.settings);
        room.players = []; room.bots = [];
        for (const p of msg.players) {
          const mine = p.owner === msg.me;
          room.addPlayer(p.name, { slot: p.slot, remote: !mine, bot: mine && p.bot, local: mine && !p.bot, skill: p.skill ?? 0.5 });
        }
        app.me = room.players.find(p => p.isLocal) || room.players[0];
        room.net = s;
        room.authority = s.serverAuthority ? false : s.isHost;
        config.onSetup && config.onSetup(app);
        show('bn-online', false);
        start();
      });
      s.on('game', m => room.receive(m));
      s.on('watch', snap => { if (session === s) enterWatch(s, snap, true); });
      s.on('seat', () => { if (session === s) roomChat('A seat is free – you will play in the next game.', 'system'); });
      s.on('reconnecting', () => {
        if (session !== s) return;
        if (room.running) { room.running = false; if (!app.watching) room.log('*** Connection lost – you are out of this game ***', 'death'); }
        setWatching(false);
        show('bn-end', false);
        openOnline('guest');
        roomChat(`Connection to the ${s.public ? 'server' : 'host'} was lost – reconnecting…`, 'death');
      });
      s.on('reconnected', () => { if (session === s) roomChat('Reconnected. Waiting for the host to start the next game…', 'system'); });
      s.on('chat', c => {
        const text = c.system ? c.text : `<${c.name}> ${c.text}`;
        room.log(text, c.system ? 'system' : 'chat');
        roomChat(text, c.system ? 'system' : 'chat');
      });
      return s;
    }

    // ---------------------------------------------------------- public rooms screen
    let mpTimer = null, mpData = null, mpPeriod = 'top';
    const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    function openMP(message) {
      show('bn-lobby', false); show('bn-online', false); show('bn-end', false); show('bn-mp', true);
      $('bn-mp-msg').textContent = message || '';
      refreshMP();
      clearInterval(mpTimer);
      mpTimer = setInterval(() => { if ($('bn-mp').classList.contains('hidden')) clearInterval(mpTimer); else refreshMP(); }, 3000);
    }
    async function refreshMP() {
      try { mpData = await BN.net.fetchLobby(); renderMP(); }
      catch (e) { $('bn-mp-me').textContent = `Can't load the rooms: ${e.message}. Retrying…`; }
    }
    function renderMP() {
      const d = mpData, name = readSettings().name;
      const me = d.me;
      $('bn-mp-me').innerHTML = `Playing as <b>${esc(name)}</b>` + (me ? ` · rank #${me.rank} · ${me.wins} win${me.wins === 1 ? '' : 's'}` : ' · not ranked yet');
      const max = d.maxPlayers || MAX_PLAYERS;
      $('bn-rooms').innerHTML = d.rooms.map(r => {
        const st = { empty: ['Empty', 'st-empty'], waiting: ['Waiting', 'st-wait'], playing: ['Playing', 'st-play'] }[r.state] || ['?', 'st-empty'];
        const seats = Array.from({ length: max }, (_, k) => r.players[k]
          ? `<div class="bn-seat p p${k + 1}">${esc(r.players[k])}</div>` : '<div class="bn-seat">open</div>').join('');
        const n = r.players.length;
        const btn = n >= max ? `<button class="bn-join watch" data-room="${r.n}" data-watch="1" type="button">&#128065; Watch</button>`
          : r.state === 'playing' ? `<button class="bn-join" data-room="${r.n}" type="button">Join · watch now · ${n}/${max}</button>`
          : `<button class="bn-join" data-room="${r.n}" type="button">${n ? 'Join' : 'Open room'} · ${n}/${max}</button>`;
        const eye = r.watchers ? `<span class="eye">&#128065; ${r.watchers}</span>` : '';
        return `<div class="bn-rcard"><div class="head"><span class="name">Room ${r.n}</span>${eye}<span class="state ${st[1]}">${st[0]}</span></div><div class="bn-seats">${seats}</div>${btn}</div>`;
      }).join('');
      const list = d[mpPeriod] || [];
      $('bn-rank-list').innerHTML = list.length ? list.map((p, i) =>
        `<li class="${p.you ? 'you' : ''}"><span class="n">${i + 1}</span><span class="who">${esc(p.name)}</span><span class="w">${p.wins}<small>${p.games} game${p.games === 1 ? '' : 's'}</small></span></li>`).join('')
        : '<li class="empty">No ranked games yet. Win a game with 2+ players to get here.</li>';
    }
    function joinPublic(n, watch = false) {
      const { name } = readSettings();
      if (app.fullscreen) enterFullscreen(config.orientation);
      clearInterval(mpTimer);
      show('bn-mp', false);
      $('bn-plist').innerHTML = '';
      $('bn-code-show').textContent = `Room ${n}`;
      openOnline('guest');
      newSession('server').joinRoom(n, name, watch);
    }

    // ---------------------------------------------------------- watching a game
    function setWatching(on) {
      if (!!app.watching === !!on) return;
      app.watching = !!on;
      document.body.classList.toggle('watching', !!on);
      dispatchEvent(new Event('resize'));          // layout gives the pad's space to the field
    }
    // Every field is a remote mirror; the big field follows one player (tap others to switch).
    function enterWatch(s, msg, snapshot) {
      room.settings = sanitizeSettings(msg.settings);
      room.players = []; room.bots = [];
      for (const p of msg.players) room.addPlayer(p.name, { slot: p.slot, remote: true });
      room.net = s;
      room.authority = false;
      setWatching(true);
      app.me = room.players[0];
      show('bn-online', false);
      start();
      if (snapshot) {
        for (const f of msg.fields) room.receive(f);
        for (const sl of msg.dead) { const p = room.bySlot(sl); if (p && p.alive) p.die(); }
      }
      app.me = room.players.find(p => p.alive) || room.players[0];
      config.onSetup && config.onSetup(app);
      room.log(`*** Watching${snapshot ? ' the game in progress' : ''} – you play in the next game with a free seat ***`, 'system');
    }
    app.follow = p => { if (app.watching && p) { app.me = p; config.onSetup && config.onSetup(app); } };
    app.leaveWatch = () => { const pub = session && session.public; leaveOnline(); if (pub) openMP(); };

    function hostStart() {
      if (!session || !session.isHost) return;   // only the host can start a game
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
      $('bn-chat-form').addEventListener('submit', e => {
        e.preventDefault();
        if (session) session.chat($('bn-chat-in').value);
        $('bn-chat-in').value = '';
      });
      $('bn-leave').addEventListener('click', () => { const pub = session && session.public; leaveOnline(); if (pub) openMP(); });
      if ($('bn-mp-open')) {
        $('bn-mp-open').addEventListener('click', () => { $('bn-lobby-msg').textContent = ''; readSettings(); openMP(); });
        $('bn-mp-back').addEventListener('click', () => { clearInterval(mpTimer); show('bn-mp', false); show('bn-lobby', true); });
        $('bn-rooms').addEventListener('click', e => { const b = e.target.closest('.bn-join[data-room]'); if (b) joinPublic(+b.dataset.room, !!b.dataset.watch); });
        document.querySelectorAll('.bn-period button').forEach(b => b.addEventListener('click', () => {
          mpPeriod = b.dataset.period;
          document.querySelectorAll('.bn-period button').forEach(x => x.classList.toggle('on', x === b));
          if (mpData) renderMP();
        }));
        if (new URLSearchParams(location.search).get('room')) openMP();
      }
      const openDiag = () => {
        $('bn-diag').textContent = BN.net.diag() + `\n\nscreen ${innerWidth}x${innerHeight} · online=${navigator.onLine} · ${new Date().toISOString()}`;
        show('bn-diag-sheet', true);
        const pre = $('bn-diag'); pre.scrollTop = pre.scrollHeight;
      };
      $('bn-diag-open').addEventListener('click', openDiag);
      $('bn-diag-open2').addEventListener('click', openDiag);
      $('bn-diag-close').addEventListener('click', () => show('bn-diag-sheet', false));
      $('bn-diag-copy').addEventListener('click', async () => {
        const text = $('bn-diag').textContent;
        try { await navigator.clipboard.writeText(text); $('bn-diag-copy').textContent = 'Copied ✓'; }
        catch (e) {
          const r = document.createRange(); r.selectNodeContents($('bn-diag'));
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          $('bn-diag-copy').textContent = 'Selected – use Copy';
        }
        setTimeout(() => { $('bn-diag-copy').textContent = 'Copy'; }, 2500);
      });
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
      if (session) {
        setWatching(false);
        roomChat(winner ? `*** ${winner.name} wins! ***` : '*** Game over ***', 'system');
        if (!session.isHost) roomChat('Waiting for the host to start the next game…', 'info');
        setTimeout(() => { if (session && !room.running) openOnline(session.isHost ? 'host' : 'guest'); }, 1500);
        return;
      }
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

    // ---------------------------------------------------------- sound effects
    const sfx = (name, arg) => { if (!demo && !app.watching && BN.sound) BN.sound.play(name, arg); return true; };
    room.on('start', () => sfx('start'));
    room.on('lock', e => { if (e.player === app.me) sfx(e.hard ? 'drop' : 'lock'); });
    room.on('clear', e => {
      if (e.player !== app.me) return;
      sfx('clear', Math.min(4, e.count));
      if (e.collected > 0) setTimeout(() => sfx('collect'), 180);
    });
    room.on('special', e => {
      if (e.from === app.me) sfx('zap');
      else if (e.target === app.me) sfx(BN.SPECIAL_INFO[e.special].hostile ? 'hit' : 'help');
    });
    room.on('lines', e => { if (e.from !== app.me && e.targets.includes(app.me)) sfx('hit'); });
    room.on('death', p => { if (p === app.me) sfx('dead'); });
    room.on('end', w => { if (w && w === app.me) setTimeout(() => sfx('win'), 300); });
    room.on('log', e => { if (e.kind === 'chat' && app.me && !e.text.startsWith(`<${app.me.name}>`)) sfx('chat'); });

    const act = {
      left: () => app.me && app.me.move(-1) && sfx('move'),
      right: () => app.me && app.me.move(1) && sfx('move'),
      rotate: () => app.me && app.me.rotate(1) && sfx('rotate'),
      soft: () => { if (app.me && app.me.piece) { const y = app.me.piece.y; app.me.softDrop(); if (app.me.piece && app.me.piece.y > y) sfx('soft'); } },
      drop: () => app.me && app.me.hardDrop(),
      use: slot => app.me && room.useSpecial(app.me, slot),
      discard: () => app.me && room.discardSpecial(app.me),
      say: text => {
        if (session) session.chat(text);
        else if (text.trim()) room.log(`<${app.me ? app.me.name : 'you'}> ${text.trim()}`, 'chat');
      },
    };
    for (const k of ['left', 'right', 'rotate', 'soft', 'drop', 'use', 'discard']) {
      const f = act[k];
      act[k] = (...a) => (app.watching ? undefined : f(...a));
    }
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
    // ---------------------------------------------------------- auto-update
    // Phones (iOS Home Screen apps especially) can keep an old copy of the page. Ask the
    // server for the current version on launch and whenever the app comes back to the
    // front; if this copy is older, reload a fresh one (never mid-game or in a room).
    let pendingUpdate = null;
    function applyUpdate(v) {
      let n = 0;
      try { n = +(sessionStorage.getItem('bn.upd.' + v) || 0); sessionStorage.setItem('bn.upd.' + v, n + 1); } catch (e) { /* ignore */ }
      if (n >= 2) return;            // don't loop if a stale copy keeps coming back
      const u = new URL(location.href);
      u.searchParams.set('v', v);
      location.replace(u.toString());
    }
    function maybeUpdate() {
      if (demo || !pendingUpdate) return;
      if (room.running || session) return;   // wait until back in the lobby
      applyUpdate(pendingUpdate);
    }
    async function checkUpdate() {
      if (demo || location.protocol === 'file:') return;
      try {
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const v = String((await r.json()).version || '');
        if (v && v !== BN.VERSION) { pendingUpdate = v; maybeUpdate(); }
      } catch (e) { /* offline: keep playing this copy */ }
    }
    checkUpdate();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
    room.on('end', () => setTimeout(maybeUpdate, 4000));

    return app;
  }

  BN.app = create;
  BN.store = store;
})(window.BN);
