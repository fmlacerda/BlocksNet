/*
 * Shared shell for every UI option: lobby, game loop, keyboard, hold-to-repeat
 * buttons, winlist and haptics. Each layout only supplies a render() function
 * and wires its own touch controls to `app.act`.
 */
(function (RB) {
  'use strict';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('rb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rb.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
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

  // Rowbusters logo: the mark (a row of blocks bursting apart) and the wordmark.
  const MARK = `<svg class="rb-mark" viewBox="0 0 120 120" aria-hidden="true">
    <g fill="#FF2E88"><rect x="10" y="10" width="22" height="22" rx="3" opacity=".45"/><rect x="62" y="10" width="22" height="22" rx="3" opacity=".45"/>
    <rect x="10" y="88" width="22" height="22" rx="3"/><rect x="36" y="88" width="22" height="22" rx="3"/><rect x="62" y="88" width="22" height="22" rx="3"/><rect x="88" y="88" width="22" height="22" rx="3"/></g>
    <g fill="#C6FF3D"><rect x="2" y="50" width="22" height="22" rx="3" transform="rotate(-16 13 61)"/><rect x="34" y="42" width="22" height="22" rx="3" transform="rotate(8 45 53)"/>
    <rect x="64" y="54" width="22" height="22" rx="3" transform="rotate(-6 75 65)"/><rect x="96" y="44" width="22" height="22" rx="3" transform="rotate(18 107 55)"/>
    <rect x="56" y="36" width="6" height="6" rx="1"/><rect x="88" y="36" width="5" height="5" rx="1"/><rect x="26" y="78" width="5" height="5" rx="1"/><rect x="112" y="74" width="6" height="6" rx="1"/></g></svg>`;
  const LOGO = `<span class="rb-mark-wrap">${MARK}</span><span class="rb-word"><b>ROW</b>BUSTERS</span>`;
  RB.LOGO = LOGO;

  // Device icons for the round stats, the ranking and the Partyline player list.
  const DEV_SVG = {
    phone: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.6"/><path d="M7 12.2h2"/></svg>',
    computer: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="7.5" rx="1"/><path d="M1 13h14"/></svg>',
  };
  const DEV_LABEL = { phone: 'Phone or tablet', computer: 'Computer' };
  const devIcon = d => (DEV_SVG[d] ? `<span class="rb-dev" title="${DEV_LABEL[d]}" role="img" aria-label="${DEV_LABEL[d]}">${DEV_SVG[d]}</span>` : '');
  // Ranking rows carry a bit mask of every device the player has played ranked games on.
  const devIcons = mask => (mask & 1 ? devIcon('phone') : '') + (mask & 2 ? devIcon('computer') : '');

  function lobbyHTML(title, subtitle) {
    const s = Object.assign({}, DEFAULTS, store.get('settings', {}));
    s.bots = Math.max(1, Math.min(MAX_PLAYERS - 1, s.bots | 0));
    const opt = (list, cur, label = v => v) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label(v)}</option>`).join('');
    const fsRow = fsSupported
      ? `<label class="rb-check"><input type="checkbox" id="rb-fs" ${s.fullscreen ? 'checked' : ''}> Play fullscreen</label>`
      : (isIOS && !isStandalone() ? `<p class="rb-hint rb-fs-hint">For full screen on iPhone: Share &rarr; <b>Add to Home Screen</b>, then open Rowbusters from the icon.</p>` : '');
    return `
      <div class="rb-overlay" id="rb-lobby">
        <div class="rb-panel">
          <div class="rb-logo" role="img" aria-label="Rowbusters">${LOGO}</div>
          <div class="rb-tagline">Clear lines. Send trouble.</div>
          <div class="rb-sub">${title}</div>
          <p class="rb-hint">${subtitle}</p>
          <label>Nickname<input id="rb-name" maxlength="12" value="${String(s.name).replace(/"/g, '')}" autocomplete="off"></label>
          <div class="rb-row">
            <label>Opponents<select id="rb-bots">${[1, 2, 3].map(n => `<option ${n === s.bots ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Bot skill<select id="rb-skill">${opt(Object.keys(SKILLS), s.skill)}</select></label>
          </div>
          <div class="rb-row">
            <label>Speed<select id="rb-speed">${opt(Object.keys(RB.SPEEDS), s.speed, k => RB.SPEEDS[k].label)}</select></label>
            <label>Start level<select id="rb-level">${opt(START_LEVELS, s.startLevel)}</select></label>
            <label>Level up<select id="rb-lpl">${opt(LINES_PER_LEVEL, s.linesPerLevel, n => `${n} line${n > 1 ? 's' : ''}`)}</select></label>
          </div>
          ${fsRow}
          <div class="rb-sound-test"><button class="rb-btn-ghost" id="rb-test-sound" type="button">&#128266; Test sound</button><span id="rb-sound-status"></span></div>
          <p class="rb-status error" id="rb-lobby-msg"></p>
          <button class="rb-btn-primary" id="rb-start">Play vs bots</button>
          ${RB.net ? `<div class="rb-divider"><span>or play online</span></div>
          ${RB.net.serverURL() ? '<button class="rb-btn-secondary rb-mp-btn" id="rb-mp-open" type="button">Multiplayer · public rooms</button>' : ''}
          <div class="rb-row rb-private-row">
            <button class="rb-btn-secondary" id="rb-host">${RB.net.serverURL() ? 'Private room' : 'Host a room'}</button>
            <button class="rb-btn-secondary" id="rb-join-open">${RB.net.serverURL() ? 'Join with code' : 'Join a room'}</button>
          </div>` : ''}
          <p class="rb-version">v${RB.VERSION}${RB.net ? ' · <button class="rb-linkbtn" id="rb-diag-open" type="button">connection details</button>' : ''}</p>
        </div>
      </div>
      <div class="rb-overlay hidden" id="rb-mp">
        <div class="rb-panel rb-mp-panel">
          <div class="rb-mp-top"><div class="rb-logo" role="img" aria-label="Rowbusters">${LOGO}</div><span>Multiplayer</span></div>
          <div class="rb-mp-me" id="rb-mp-me">Loading…</div>
          <p class="rb-status error" id="rb-mp-msg"></p>
          <div class="rb-h2">Rooms</div>
          <div class="rb-rooms" id="rb-rooms"></div>
          <div class="rb-h2">Top players</div>
          <div class="rb-rank">
            <div class="rb-period"><button class="on" data-period="top" type="button">All time</button><button data-period="week" type="button">This week</button></div>
            <ol id="rb-rank-list"></ol>
            <p class="rb-hint rb-rank-note">Games with 2 or more real players count. The server decides the winner.</p>
          </div>
          <button class="rb-btn-ghost" id="rb-mp-back" type="button">&larr; Back</button>
        </div>
      </div>
      <div class="rb-overlay hidden" id="rb-online">
        <div class="rb-panel" id="rb-on-panel">
          <div class="rb-logo rb-on-logo" role="img" aria-label="Rowbusters">${LOGO}</div>
          <div class="rb-sub" id="rb-on-title">Online room</div>
          <div id="rb-on-join" class="rb-stack hidden">
            <label>Your nickname<input id="rb-join-name" maxlength="12" autocomplete="off"></label>
            <label>Room code<input id="rb-code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDE"></label>
            <button class="rb-btn-primary" id="rb-join">Join</button>
          </div>
          <div id="rb-on-room" class="rb-room hidden">
            <div class="rb-room-head">
              <div class="rb-code-box"><small id="rb-code-label">Room code</small><b id="rb-code-show">·····</b></div>
              <button class="rb-btn-secondary" id="rb-share" type="button">Invite</button>
            </div>
            <ol class="rb-plist" id="rb-plist"></ol>
            <div class="rb-teams hidden" id="rb-teams">
              <button type="button" data-team="A"></button>
              <button type="button" data-team="B"></button>
            </div>
            <div class="rb-chat" id="rb-chat" aria-live="polite"></div>
            <form class="rb-chat-form" id="rb-chat-form">
              <input id="rb-chat-in" maxlength="200" autocomplete="off" enterkeyhint="send" placeholder="Say something…">
              <button type="submit">Send</button>
            </form>
            <div id="rb-host-ctl" class="rb-host-row">
              <label>Bots<select id="rb-fill">${[0, 1, 2, 3].map(n => `<option ${n === 0 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <button class="rb-btn-primary" id="rb-on-start" type="button">Start game</button>
            </div>
            <p class="rb-hint" id="rb-wait">Waiting for the host to start the game…</p>
          </div>
          <p class="rb-status" id="rb-on-status"></p>
          <div class="rb-row rb-room-foot">
            <button class="rb-btn-ghost" id="rb-leave" type="button">Leave room</button>
            <button class="rb-btn-ghost" id="rb-diag-open2" type="button">Connection details</button>
          </div>
        </div>
      </div>
      <div class="rb-overlay hidden" id="rb-summary">
        <div class="rb-panel rb-sum-panel">
          <div class="rb-sum-body" id="rb-sum-body"></div>
          <div class="rb-row">
            <button class="rb-btn-secondary" id="rb-sum-copy" type="button">Copy image</button>
            <button class="rb-btn-primary" id="rb-sum-close" type="button">Close</button>
          </div>
        </div>
      </div>
      <div class="rb-overlay hidden" id="rb-diag-sheet">
        <div class="rb-panel rb-panel-room">
          <div class="rb-sub">Connection details</div>
          <p class="rb-hint">If online play fails, tap Copy and send this to whoever is helping you.</p>
          <pre class="rb-diag" id="rb-diag"></pre>
          <div class="rb-row">
            <button class="rb-btn-secondary" id="rb-diag-copy" type="button">Copy</button>
            <button class="rb-btn-primary" id="rb-diag-close" type="button">Close</button>
          </div>
        </div>
      </div>
      <div class="rb-overlay hidden" id="rb-end">
        <div class="rb-panel">
          <div class="rb-title" id="rb-end-title">Game over</div>
          <div class="rb-sub">Winlist</div>
          <ol class="rb-winlist" id="rb-winlist"></ol>
          <p class="rb-hint hidden" id="rb-end-wait">Waiting for the host to start the next game…</p>
          <button class="rb-btn-primary" id="rb-again">Play again</button>
          <button class="rb-btn-ghost" id="rb-lobby-btn">Change settings</button>
        </div>
      </div>`;
  }

  function create(config) {
    const demo = /[?&]demo\b/.test(location.search);   // autoplay preview used by the hub page
    const room = new RB.Room();
    const app = { room, me: null, config };
    const wrap = document.createElement('div');
    wrap.innerHTML = lobbyHTML(config.title || 'Study prototype', config.subtitle || '');
    document.body.appendChild(wrap);
    const $ = id => document.getElementById(id);

    function readSettings() {
      const name = RB.net ? RB.net.cleanName($('rb-name').value) : ($('rb-name').value.trim() || 'Player').slice(0, 12);
      const bots = +$('rb-bots').value;
      const skill = $('rb-skill').value;
      const speed = $('rb-speed').value;
      const startLevel = +$('rb-level').value;
      const linesPerLevel = +$('rb-lpl').value;
      const fullscreen = $('rb-fs') ? $('rb-fs').checked : DEFAULTS.fullscreen;
      store.set('settings', { name, bots, skill, speed, startLevel, linesPerLevel, fullscreen });
      app.fullscreen = fullscreen;
      return { name, bots, skill, game: { speed, startLevel, linesPerLevel } };
    }

    function setup() {
      const { name, bots, skill, game } = readSettings();
      room.settings = demo ? Object.assign({}, RB.DEFAULT_SETTINGS) : game;
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
      $('rb-lobby').classList.add('hidden');
      $('rb-end').classList.add('hidden');
      room.start();
    }

    $('rb-start').addEventListener('click', () => { setup(); start(); });
    if (RB.sound) {
      // Plays a short beep (even if game sound is muted) and shows the audio status,
      // so a player can tell whether the phone is blocking sound.
      $('rb-test-sound').addEventListener('click', () => {
        RB.sound.unlock();
        $('rb-sound-status').textContent = 'starting…';
        setTimeout(() => { RB.sound.play('test', null, true); $('rb-sound-status').textContent = RB.sound.status(); }, 250);
      });
    } else $('rb-test-sound').parentElement.remove();
    $('rb-again').addEventListener('click', () => { if (session && session.isHost) hostStart(); else if (!session) start(); });
    $('rb-lobby-btn').addEventListener('click', () => {
      $('rb-end').classList.add('hidden');
      $((session ? 'rb-online' : 'rb-lobby')).classList.remove('hidden');
    });

    // ---------------------------------------------------------- online play
    let session = null;
    app.session = () => session;   // for debugging and tests
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    const status = (text, isError) => { $('rb-on-status').textContent = text || ''; $('rb-on-status').classList.toggle('error', !!isError); };

    function sanitizeSettings(g) {
      g = g || {};
      return {
        speed: RB.SPEEDS[g.speed] ? g.speed : 'classic',
        startLevel: Math.max(1, Math.min(99, g.startLevel | 0 || 1)),
        linesPerLevel: Math.max(1, Math.min(20, g.linesPerLevel | 0 || 2)),
        mode: RB.MODES[g.mode] ? g.mode : 'normal',
      };
    }

    function openOnline(mode) {
      show('rb-lobby', false); show('rb-end', false); show('rb-online', true);
      show('rb-on-join', mode === 'join');
      show('rb-on-room', mode !== 'join');
      $('rb-on-panel').classList.toggle('rb-panel-room', mode !== 'join');
      show('rb-host-ctl', mode === 'host');
      show('rb-wait', mode === 'guest');
      $('rb-on-title').textContent = mode === 'join' ? 'Join a room' : 'Partyline';
      if (mode !== 'join') setTimeout(() => { const c = $('rb-chat'); c.scrollTop = c.scrollHeight; }, 0);
    }

    function leaveOnline(message) {
      if (session) { const s = session; session = null; s.close(); }
      room.net = null;
      room.authority = true;
      room.running = false;
      show('rb-online', false); show('rb-end', false); show('rb-lobby', true);
      if (message) room.log(message, 'system');
      setup();
      setTimeout(maybeUpdate, 0);
    }

    // Room chat (the partyline before and between games).
    function roomChat(text, kind = 'chat') {
      const c = $('rb-chat');
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
      const div = document.createElement('div');
      div.className = 'log-line log-' + kind;
      div.textContent = text;
      c.appendChild(div);
      while (c.children.length > 200) c.firstChild.remove();
      if (atBottom || kind !== 'chat') c.scrollTop = c.scrollHeight;
    }

    // Round stats card (public rooms): the server sends it right after a game ends.
    // Every round's stats since joining this room, for the game summary.
    let rounds = [];
    const fmtTime = ms => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    const SUM_COLORS = ['#4DA3FF', '#FF9A3D', '#C6FF3D', '#FF5FA8', '#3DFFE0', '#B28CFF'];
    const roomName = () => (session && session.public ? $('rb-code-show').textContent : 'Private room');
    const homeLink = () => (location.hostname.endsWith('rowbusters.com') ? 'rowbusters.com' : location.origin + location.pathname);

    // Everything the summary shows, worked out from the rounds: one entry per player (matched by
    // nickname; bots keep their names in a room) and one per game.
    function summaryData() {
      const by = new Map();
      const keyOf = p => (p.bot ? 'bot:' : '') + p.name;
      const games = rounds.map((st, i) => {
        const cells = new Map();
        for (const p of st.players) {
          const k = keyOf(p);
          const t = by.get(k) || { key: k, name: p.name, bot: p.bot, devs: [], games: 0, wins: 0, ms: 0, pieces: 0, lines: 0, busts: 0, sent: 0, used: 0, recv: 0 };
          t.games++; t.wins += p.win ? 1 : 0; t.ms += p.ms; t.pieces += p.pieces; t.lines += p.lines;
          t.busts += p.busts; t.sent += p.sent; t.used += p.used; t.recv += p.recv;
          if (p.dev && !t.devs.includes(p.dev)) t.devs.push(p.dev);
          by.set(k, t);
          cells.set(k, p);
        }
        const winners = st.players.filter(p => p.win);
        const teamWin = winners.length > 1 && winners[0].team;
        return { n: i + 1, ms: st.ms, cells, winKey: !teamWin && winners[0] ? keyOf(winners[0]) : '',
          winner: teamWin ? `Team ${winners[0].team}` : winners[0] ? winners[0].name : 'nobody' };
      });
      const players = [...by.values()].map(t => Object.assign(t, { ppm: Math.round(t.pieces / Math.max(1, t.ms / 60000)) }))
        .sort((a, b) => b.wins - a.wins || b.lines - a.lines || b.ppm - a.ppm);
      players.forEach((t, i) => { t.color = SUM_COLORS[i % SUM_COLORS.length]; });
      // Short column labels: initials, or two letters where initials clash.
      players.forEach(t => { t.short = t.name.slice(0, 1).toUpperCase(); });
      players.forEach(t => { if (players.some(o => o !== t && o.short === t.short)) t.short = t.name.slice(0, 2); });
      const P = k => players.find(t => t.key === k);
      // A few highlights.
      const notes = [];
      let run = 0, best = { k: '', n: 0, end: 0 };
      games.forEach((g, i) => { run = g.winKey && i && games[i - 1].winKey === g.winKey ? run + 1 : 1; if (g.winKey && run > best.n) best = { k: g.winKey, n: run, end: g.n }; });
      if (best.n >= 2) notes.push(`${P(best.k).name} won ${best.n === games.length ? `all ${best.n}` : `${best.n} in a row`}${best.n < games.length ? ` (games ${best.end - best.n + 1}–${best.end})` : ''}.`);
      if (games.length >= 2) {
        const q = games.reduce((a, g) => (g.ms < a.ms ? g : a)), l = games.reduce((a, g) => (g.ms > a.ms ? g : a));
        notes.push(`Quickest game: #${q.n}, just ${fmtTime(q.ms)} — won by ${q.winner}.`);
        if (l !== q) notes.push(`Longest game: #${l.n} (${fmtTime(l.ms)}) — won by ${l.winner}.`);
      }
      const top = (f, min = 1) => { const m = Math.max(...players.map(f)); const at = players.filter(t => f(t) === m); return m >= min && at.length === 1 ? at[0] : null; };
      const b = top(t => t.busts);
      if (b) notes.push(`${b.name} made the most rowbusts (${b.busts}).`);
      const sn = top(t => t.sent);
      if (sn) notes.push(`${sn.name} sent the most lines (${sn.sent}).`);
      return { players, games, notes: notes.slice(0, 4), ms: rounds.reduce((n, r) => n + r.ms, 0), at: rounds[0] ? rounds[0].at : Date.now() };
    }
    const sumDate = at => new Date(at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    // "12–5" style cell: one number per player, in the summary's player order ('·' = not in that game).
    const perPlayer = (d, g, f) => d.players.map(t => (g.cells.has(t.key) ? f(g.cells.get(t.key)) : '·')).join('–');

    function summaryHTML() {
      const d = summaryData();
      const own = room.players.find(p => p.isLocal);
      const nm = t => `<span style="color:${t.color}">${esc(t.name)}</span>`;
      const score = d.players.map(t => `<div class="rb-sum-cell"><b style="color:${t.color}">${esc(t.name)}</b><strong>${t.wins}</strong>${t.bot ? '<i>bot</i>' : ''}</div>`)
        .join(d.players.length === 2 ? '<div class="rb-sum-dash">–</div>' : '');
      const initials = d.players.map(t => esc(t.short)).join('–');
      const gameRows = d.games.map(g => {
        const w = g.winKey ? d.players.find(t => t.key === g.winKey) : null;
        return `<tr><td>${g.n}</td><td class="w">${w ? nm(w) : esc(g.winner)}</td><td>${fmtTime(g.ms)}</td><td>${perPlayer(d, g, p => p.lines)}</td><td>${perPlayer(d, g, p => p.sent)}</td></tr>`;
      }).join('');
      const totRow = (label, f) => `<tr><td class="l">${label}</td>${d.players.map(t => `<td>${f(t)}</td>`).join('')}</tr>`;
      return `<div class="rb-sum-top"><b>Rowbusters · ${esc(roomName())}</b><span>${sumDate(d.at)}</span></div>` +
        `<div class="rb-sum-box rb-sum-score${d.players.length > 2 ? ' many' : ''}"${d.players.length > 2 ? ` style="grid-template-columns:repeat(${Math.min(d.players.length, 4)},minmax(0,1fr))"` : ''}>${score}</div>` +
        `<div class="rb-sum-box"><table class="rb-sum-games${d.players.length > 2 ? ' many' : ''}"><thead><tr><th>#</th><th>Winner</th><th>Time</th><th>Lines ${initials}</th><th>Sent ${initials}</th></tr></thead><tbody>${gameRows}</tbody></table></div>` +
        `<div class="rb-sum-box"><div class="rb-sum-h">Totals · ${fmtTime(d.ms)} played</div>` +
        (d.players.length <= 2
          // Two players: one column each, like a head-to-head.
          ? `<table class="rb-sum-tot"><thead><tr><th></th>${d.players.map(t => `<th>${nm(t)}${t.bot ? ' <i>bot</i>' : ''}</th>`).join('')}</tr></thead><tbody>` +
            totRow('Games won', t => `${t.wins}/${t.games}`) + totRow('Lines cleared', t => t.lines) + totRow('Lines sent', t => t.sent) +
            totRow('Rowbusts (4&times;)', t => t.busts) + totRow('Avg speed (PPM)', t => t.ppm) + totRow('Specials used', t => t.used) + `</tbody></table>`
          // More players: one row each, so it fits a phone.
          : `<table class="rb-sum-rows"><thead><tr><th class="nm">Player</th><th>Won</th><th>Lines</th><th>Sent</th><th>4&times;</th><th>PPM</th><th>Spec</th></tr></thead><tbody>` +
            d.players.map(t => `<tr class="${own && !t.bot && t.name === own.name ? 'you' : ''}"><td class="nm">${nm(t)}${t.bot ? ' <i>bot</i>' : ''}</td><td>${t.wins}/${t.games}</td><td>${t.lines}</td><td>${t.sent}</td><td>${t.busts}</td><td>${t.ppm}</td><td>${t.used}</td></tr>`).join('') +
            `</tbody></table><p class="rb-sum-legend">4&times; rowbusts &middot; PPM average pieces per minute &middot; Spec specials used</p>`) +
        `</div>` +
        (d.notes.length ? `<ul class="rb-sum-notes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '');
    }
    // The summary as a picture (js/statsimage.js draws it), for pasting into a chat app.
    function summaryImageData() {
      const d = summaryData();
      return {
        title: `Rowbusters · ${roomName()}`, date: sumDate(d.at), footer: homeLink(), total: fmtTime(d.ms), notes: d.notes,
        players: d.players.map(({ name, color, bot, wins, games, lines, sent, busts, ppm, used, short }) => ({ name, color, bot, wins, games, lines, sent, busts, ppm, used, short })),
        games: d.games.map(g => {
          const w = g.winKey && d.players.find(t => t.key === g.winKey);
          return { n: g.n, winner: w ? w.name : g.winner, winColor: w ? w.color : '', time: fmtTime(g.ms), lines: perPlayer(d, g, p => p.lines), sent: perPlayer(d, g, p => p.sent) };
        }),
      };
    }
    // Must start the clipboard write within the tap (Safari), so nothing is awaited before it.
    function copyImage(b) {
      const label = b.textContent;
      b.textContent = 'Making image…';
      RB.statsImage.copy(RB.statsImage.render(summaryImageData())).then(res => {
        b.textContent = { copied: 'Image copied ✓', shared: 'Shared ✓', saved: 'Image saved ✓', failed: 'Couldn’t copy' }[res] || label;
        b.classList.toggle('done', res === 'copied' || res === 'shared' || res === 'saved');
        setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 2200);
      });
    }
    function openSummary() {
      $('rb-sum-body').innerHTML = summaryHTML();
      show('rb-summary', true);
      $('rb-sum-body').scrollTop = 0;
    }

    function statsCard(st) {
      const own = room.players.find(p => p.isLocal), mine = own ? own.slot : 0;
      const name = sl => { const p = st.players.find(x => x.slot === sl); return p ? esc(p.name) : '?'; };
      const time = fmtTime;
      const place = p => p.win ? '&#127942;' : p.place;
      const rows = st.players.map(p => `<tr class="${p.slot === mine ? 'you' : ''}"><td>${place(p)}</td><td class="nm">${p.team ? `<span class="rb-tm rb-tm-${p.team}">${p.team}</span> ` : ''}${esc(p.name)}${p.bot ? ' <i>bot</i>' : devIcon(p.dev)}</td>` +
        `<td>${time(p.ms)}</td><td>${p.ppm}</td><td>${p.lines}</td><td>${p.busts}</td><td>${p.sent}</td><td>${p.used}/${p.recv}</td></tr>`).join('');
      const aw = [], A = st.awards, P = sl => st.players.find(x => x.slot === sl);
      if (A.attacker) aw.push(`&#128163; Top attacker: <b>${name(A.attacker)}</b>`);
      if (A.fastest) aw.push(`&#9889; Fastest: <b>${name(A.fastest)}</b> (${P(A.fastest).ppm} pieces/min)`);
      if (A.busts) aw.push(`&#128165; Most rowbusts: <b>${name(A.busts)}</b> (${P(A.busts).busts})`);
      const me = mine && P(mine);
      if (me) {
        const top = Object.entries(me.by).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0) aw.push(`&#127919; Hit you most: <b>${name(top[0] | 0)}</b> &times;${top[1]}`);
      }
      const n = rounds.indexOf(st) + 1;
      return `<div class="rb-st-head">&#128202; Game ${n} stats <span>${time(st.ms)}</span></div>` +
        `<table><thead><tr><th></th><th class="nm">Player</th><th>Time</th><th>PPM</th><th>Lines</th><th>4&times;</th><th>Sent</th><th>Spec</th></tr></thead><tbody>${rows}</tbody></table>` +
        (aw.length ? `<ul>${aw.map(x => `<li>${x}</li>`).join('')}</ul>` : '') +
        `<p>PPM pieces per minute &middot; 4&times; rowbusts (4 lines at once) &middot; Sent lines sent &middot; Spec specials used/received</p>` +
        `<div class="rb-st-btns">${n > 1 ? `<button class="rb-st-sum" type="button">&#128202; Summary &middot; ${n} games</button>` : ''}<button class="rb-st-copy" type="button">Copy image</button></div>`;
    }
    function roomStats(st) {
      const c = $('rb-chat');
      const div = document.createElement('div');
      div.className = 'rb-stats';
      st.at = Date.now();
      rounds.push(st);
      div.innerHTML = statsCard(st);
      c.appendChild(div);
      while (c.children.length > 200) c.firstChild.remove();
      c.scrollTop = c.scrollHeight;
    }

    function newSession(kind = 'p2p') {
      $('rb-chat').innerHTML = '';
      rounds = [];
      if (session) session.close();
      const s = session = kind === 'server' ? new RB.net.ServerSession() : new RB.net.Session();
      $('rb-code-label').textContent = s.public ? 'Public room' : 'Room code';
      $('rb-code-show').classList.toggle('rb-room-name', !!s.public);
      s.on('status', t => status(t));
      s.on('error', t => {
        if (s.public) { if (session === s) { session = null; show('rb-online', false); openMP(t); } return; }
        status(t, true); if (!s.isHost && !s.conn) { s.close(); session = null; }
      });
      s.on('closed', t => {
        if (session !== s) return;
        leaveOnline();
        if (s.public) openMP(t); else $('rb-lobby-msg').textContent = t;
      });
      s.on('ready', code => {
        $('rb-code-show').textContent = code;
        roomChat(s.public
          ? (s.spectator
            ? `You are watching ${code} (all 4 seats are taken). You will get a seat when one is free after a game.`
            : `Welcome to ${code}. Chat here; ${s.isHost ? 'you are the host, so you start the game when everyone is ready.' : 'the host starts the game.'}`)
          : `Room ${code} is open. Tap Invite to send the link, chat here, then start the game.`, 'system');
      });
      s.on('role', isHost => {
        if (session !== s || room.running) return;
        if (!$('rb-online').classList.contains('hidden') || !$('rb-end').classList.contains('hidden')) openOnline(isHost ? 'host' : 'guest');
      });
      s.on('lobby', l => {
        if (!s.isHost && $('rb-on-join') && !$('rb-on-join').classList.contains('hidden')) openOnline('guest');
        $('rb-code-show').textContent = l.code || s.code;
        if (s.public) { const md = RB.MODES[l.mode]; $('rb-code-label').textContent = md && md.desc ? `${md.label} · ${md.desc}` : 'Public room'; }
        const teamTag = t => (t ? `<span class="rb-tm rb-tm-${t}">${t}</span> ` : '');
        $('rb-plist').innerHTML = l.players.map(p => `<li>${teamTag(p.team)}${p.name}${devIcon(p.dev)}${p.host ? ' <em>host</em>' : ''}</li>`).join('')
          + (l.watchers || []).map(n => `<li class="watcher">&#128065; ${n}</li>`).join('');
        // Teams room: pick team A or B (between games; 2 players per team).
        const teams = l.mode === 'teams', mine = l.players.find(p => p.me);
        show('rb-teams', teams && !!mine);
        if (teams && mine) {
          $('rb-teams').querySelectorAll('button').forEach(b => {
            const t = b.dataset.team, n = l.players.filter(p => p.team === t).length;
            b.classList.toggle('on', mine.team === t);
            b.classList.toggle('rb-tm-' + t, true);
            b.disabled = mine.team !== t && n >= 2;
            b.innerHTML = `Team ${t} <small>${mine.team === t ? 'your team' : n >= 2 ? 'full' : 'tap to join'} · ${n}/2</small>`;
          });
        }
        const free = MAX_PLAYERS - l.players.length;
        const fill = $('rb-fill');
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
          room.addPlayer(p.name, { slot: p.slot, remote: !mine, bot: mine && p.bot, local: mine && !p.bot, skill: p.skill ?? 0.5, team: p.team || '' });
        }
        app.me = room.players.find(p => p.isLocal) || room.players[0];
        room.net = s;
        room.authority = s.serverAuthority ? false : s.isHost;
        config.onSetup && config.onSetup(app);
        show('rb-online', false);
        start();
        if (app.me && app.me.team) {
          const mates = room.players.filter(p => p !== app.me && p.team === app.me.team).map(p => p.name);
          room.log(`*** You are team ${app.me.team}${mates.length ? ' with ' + mates.join(', ') : ''} ***`, 'system');
        }
      });
      s.on('game', m => room.receive(m));
      s.on('watch', snap => { if (session === s) enterWatch(s, snap, true); });
      s.on('seat', () => { if (session === s) roomChat('A seat is free – you will play in the next game.', 'system'); });
      s.on('reconnecting', () => {
        if (session !== s) return;
        // Public rooms: the server keeps your seat for a few seconds, so keep playing.
        if (s.public && room.running && !app.watching) { room.log('*** Connection lost – reconnecting… keep playing ***', 'death'); return; }
        if (room.running) { room.running = false; if (!app.watching) room.log('*** Connection lost – you are out of this game ***', 'death'); }
        setWatching(false);
        show('rb-end', false);
        openOnline('guest');
        roomChat(`Connection to the ${s.public ? 'server' : 'host'} was lost – reconnecting…`, 'death');
      });
      s.on('reconnected', info => {
        if (session !== s) return;
        if (s.public && room.running && !app.watching) {
          if (info && info.resumed) { room.log('*** Reconnected – the game goes on ***', 'system'); return; }
          // Seat not kept (game over, or away too long): stop here; if the game is still
          // going, the server's snapshot that follows switches to watching it.
          room.running = false;
          room.log('*** You were out of this game while disconnected ***', 'death');
          show('rb-end', false);
          openOnline(s.isHost ? 'host' : 'guest');
          roomChat('Reconnected, but this game went on without you. You play in the next one.', 'system');
          return;
        }
        roomChat('Reconnected. Waiting for the host to start the next game…', 'system');
      });
      s.on('stats', st => { if (session === s) roomStats(st); });
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
      show('rb-lobby', false); show('rb-online', false); show('rb-end', false); show('rb-mp', true);
      $('rb-mp-msg').textContent = message || '';
      refreshMP();
      clearInterval(mpTimer);
      mpTimer = setInterval(() => { if ($('rb-mp').classList.contains('hidden')) clearInterval(mpTimer); else refreshMP(); }, 3000);
    }
    async function refreshMP() {
      try { mpData = await RB.net.fetchLobby(); renderMP(); }
      catch (e) { $('rb-mp-me').textContent = `Can't load the rooms: ${e.message}. Retrying…`; }
    }
    function renderMP() {
      const d = mpData, name = readSettings().name;
      const me = d.me;
      $('rb-mp-me').innerHTML = `Playing as <b>${esc(name)}</b>` + (me ? ` · rank #${me.rank} · ${me.wins} win${me.wins === 1 ? '' : 's'}` : ' · not ranked yet') +
        (me && me.stats && me.stats.pieces ? `<small>${me.games} game${me.games === 1 ? '' : 's'} · ${me.stats.lines} lines · ${me.stats.busts} rowbusts · ` +
          `${me.stats.ppm} pieces/min${me.stats.bestPpm ? ` (best ${me.stats.bestPpm})` : ''} · ${me.stats.sent} lines sent · ${me.stats.specials} specials used</small>` : '');
      const max = d.maxPlayers || MAX_PLAYERS;
      $('rb-rooms').innerHTML = d.rooms.map(r => {
        const st = { empty: ['Empty', 'st-empty'], waiting: ['Waiting', 'st-wait'], playing: ['Playing', 'st-play'] }[r.state] || ['?', 'st-empty'];
        const seats = Array.from({ length: max }, (_, k) => r.players[k]
          ? `<div class="rb-seat p p${k + 1}">${esc(r.players[k])}</div>` : '<div class="rb-seat">open</div>').join('');
        const n = r.players.length;
        const btn = n >= max ? `<button class="rb-join watch" data-room="${r.n}" data-watch="1" type="button">&#128065; Watch</button>`
          : r.state === 'playing' ? `<button class="rb-join" data-room="${r.n}" type="button">Join · watch now · ${n}/${max}</button>`
          : `<button class="rb-join" data-room="${r.n}" type="button">${n ? 'Join' : 'Open room'} · ${n}/${max}</button>`;
        const eye = r.watchers ? `<span class="eye">&#128065; ${r.watchers}</span>` : '';
        const md = RB.MODES[r.mode];
        const mode = md && md.desc ? `<div class="rb-rmode"><b>${md.label}</b> ${md.short}</div>` : '';
        return `<div class="rb-rcard"><div class="head"><span class="name">Room ${r.n}</span>${eye}<span class="state ${st[1]}">${st[0]}</span></div>${mode}<div class="rb-seats">${seats}</div>${btn}</div>`;
      }).join('');
      const list = d[mpPeriod] || [];
      $('rb-rank-list').innerHTML = list.length ? list.map((p, i) =>
        `<li class="${p.you ? 'you' : ''}"><span class="n">${i + 1}</span><span class="who">${esc(p.name)}${devIcons(p.devices | 0)}</span><span class="w">${p.wins}<small>${p.games} game${p.games === 1 ? '' : 's'}</small></span></li>`).join('')
        : '<li class="empty">No ranked games yet. Win a game with 2+ players to get here.</li>';
    }
    function joinPublic(n, watch = false) {
      const { name } = readSettings();
      if (app.fullscreen) enterFullscreen(config.orientation);
      clearInterval(mpTimer);
      show('rb-mp', false);
      $('rb-plist').innerHTML = '';
      $('rb-code-show').textContent = `Room ${n}`;
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
      for (const p of msg.players) room.addPlayer(p.name, { slot: p.slot, remote: true, team: p.team || '' });
      room.net = s;
      room.authority = false;
      setWatching(true);
      app.me = room.players[0];
      show('rb-online', false);
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
      session.startGame(game, +$('rb-fill').value, SKILLS[skill]);
    }

    if (RB.net && !demo) {
      const clearMsg = () => { $('rb-lobby-msg').textContent = ''; };
      ['rb-host', 'rb-join-open', 'rb-start'].forEach(id => $(id).addEventListener('click', clearMsg));
      $('rb-host').addEventListener('click', () => {
        const { name } = readSettings();
        if (app.fullscreen) enterFullscreen(config.orientation);
        $('rb-plist').innerHTML = '';
        $('rb-code-show').textContent = '·····';
        openOnline('host');
        newSession().host(name);
      });
      const openJoin = () => { status(''); $('rb-join-name').value = $('rb-name').value; openOnline('join'); };
      $('rb-join-open').addEventListener('click', () => { openJoin(); $('rb-code').focus(); });
      $('rb-join').addEventListener('click', () => {
        $('rb-name').value = $('rb-join-name').value;
        const { name } = readSettings();
        if (app.fullscreen) enterFullscreen(config.orientation);
        $('rb-plist').innerHTML = '';
        newSession().join($('rb-code').value, name);
      });
      $('rb-code').addEventListener('input', e => { e.target.value = RB.net.cleanCode(e.target.value); });
      $('rb-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('rb-join').click(); });
      $('rb-on-start').addEventListener('click', hostStart);
      // "Copy stats" on a stats card: the stats as plain text, for pasting into a chat app.
      $('rb-chat').addEventListener('click', e => {
        if (e.target.closest('.rb-st-sum')) { openSummary(); return; }
        const b = e.target.closest('.rb-st-copy');
        if (b) copyImage(b);
      });
      $('rb-sum-copy').addEventListener('click', e => copyImage(e.currentTarget));
      $('rb-sum-close').addEventListener('click', () => show('rb-summary', false));
      $('rb-teams').addEventListener('click', e => {
        const b = e.target.closest('button[data-team]');
        if (b && !b.disabled && !b.classList.contains('on') && session && session.setTeam) session.setTeam(b.dataset.team);
      });
      $('rb-chat-form').addEventListener('submit', e => {
        e.preventDefault();
        if (session) session.chat($('rb-chat-in').value);
        $('rb-chat-in').value = '';
      });
      $('rb-leave').addEventListener('click', () => { const pub = session && session.public; leaveOnline(); if (pub) openMP(); });
      if ($('rb-mp-open')) {
        $('rb-mp-open').addEventListener('click', () => { $('rb-lobby-msg').textContent = ''; readSettings(); openMP(); });
        $('rb-mp-back').addEventListener('click', () => { clearInterval(mpTimer); show('rb-mp', false); show('rb-lobby', true); });
        $('rb-rooms').addEventListener('click', e => { const b = e.target.closest('.rb-join[data-room]'); if (b) joinPublic(+b.dataset.room, !!b.dataset.watch); });
        document.querySelectorAll('.rb-period button').forEach(b => b.addEventListener('click', () => {
          mpPeriod = b.dataset.period;
          document.querySelectorAll('.rb-period button').forEach(x => x.classList.toggle('on', x === b));
          if (mpData) renderMP();
        }));
        if (new URLSearchParams(location.search).get('room')) openMP();
      }
      const openDiag = () => {
        $('rb-diag').textContent = RB.net.diag() + `\n\nscreen ${innerWidth}x${innerHeight} · online=${navigator.onLine} · ${new Date().toISOString()}`;
        show('rb-diag-sheet', true);
        const pre = $('rb-diag'); pre.scrollTop = pre.scrollHeight;
      };
      $('rb-diag-open').addEventListener('click', openDiag);
      $('rb-diag-open2').addEventListener('click', openDiag);
      $('rb-diag-close').addEventListener('click', () => show('rb-diag-sheet', false));
      $('rb-diag-copy').addEventListener('click', async () => {
        const text = $('rb-diag').textContent;
        try { await navigator.clipboard.writeText(text); $('rb-diag-copy').textContent = 'Copied ✓'; }
        catch (e) {
          const r = document.createRange(); r.selectNodeContents($('rb-diag'));
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          $('rb-diag-copy').textContent = 'Selected – use Copy';
        }
        setTimeout(() => { $('rb-diag-copy').textContent = 'Copy'; }, 2500);
      });
      $('rb-share').addEventListener('click', async () => {
        if (!session) return;
        const url = session.inviteLink();
        try {
          if (navigator.share) { await navigator.share({ title: 'Rowbusters', text: `Join my Rowbusters room ${session.code}`, url }); return; }
        } catch (e) { if (e && e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(url); status('Invite link copied.'); }
        catch (e) { status(url); }
      });
      addEventListener('pagehide', () => { if (session) session.close(); });
      // Invite links look like ...?join=ABCDE
      const invite = new URLSearchParams(location.search).get('join');
      if (invite) { $('rb-code').value = RB.net.cleanCode(invite); openJoin(); }
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
        roomChat(winner ? `*** ${winner.team ? 'Team ' + winner.team : winner.name} wins! ***` : '*** Game over ***', 'system');
        if (!session.isHost) roomChat('Waiting for the host to start the next game…', 'info');
        setTimeout(() => { if (session && !room.running) openOnline(session.isHost ? 'host' : 'guest'); }, 1500);
        return;
      }
      const guest = !!(session && !session.isHost);
      show('rb-again', !guest);
      show('rb-end-wait', guest);
      $('rb-lobby-btn').textContent = session ? 'Back to room' : 'Change settings';
      setTimeout(() => {
        if (!room.running) show('rb-online', false);
        $('rb-end-title').innerHTML = winner ? (youWon ? 'You <span>win!</span>' : `${winner.name} <span>wins</span>`) : 'Game <span>over</span>';
        $('rb-winlist').innerHTML = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([n, w]) => `<li><span>${n}</span><b>${w}</b></li>`).join('');
        if (!room.running) $('rb-end').classList.remove('hidden');
      }, 900);
      const b = room.players.find(p => p.isBot);
      if (b) setTimeout(() => room.log(`<${b.name}> ${BOT_CHAT[Math.floor(Math.random() * BOT_CHAT.length)]}`, 'chat'), 500);
    });

    room.on('special', e => {
      if (e.target === app.me && e.from !== app.me) haptic(RB.SPECIAL_INFO[e.special].hostile ? 40 : 15);
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
    const sfx = (name, arg) => { if (!demo && !app.watching && RB.sound) RB.sound.play(name, arg); return true; };
    room.on('start', () => sfx('start'));
    room.on('lock', e => { if (e.player === app.me) sfx(e.hard ? 'drop' : 'lock'); });
    room.on('clear', e => {
      if (e.player !== app.me) return;
      sfx('clear', Math.min(4, e.count));
      if (e.collected > 0) setTimeout(() => sfx('collect'), 180);
    });
    room.on('special', e => {
      if (e.from === app.me) sfx('zap');
      else if (e.target === app.me) sfx(RB.SPECIAL_INFO[e.special].hostile ? 'hit' : 'help');
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
    RB.current = app;   // handy from the dev console
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
      if (now - lastTouch < 300 && !e.target.closest('input,select,button,a,.opp')) e.preventDefault();
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
      try { n = +(sessionStorage.getItem('rb.upd.' + v) || 0); sessionStorage.setItem('rb.upd.' + v, n + 1); } catch (e) { /* ignore */ }
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
        if (v && v !== RB.VERSION) { pendingUpdate = v; maybeUpdate(); }
      } catch (e) { /* offline: keep playing this copy */ }
    }
    checkUpdate();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
    room.on('end', () => setTimeout(maybeUpdate, 4000));

    return app;
  }

  RB.app = create;
  RB.store = store;
})(window.RB);
