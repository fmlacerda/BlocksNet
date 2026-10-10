/*
 * Online play, "host is the referee" style.
 *
 * One phone hosts a room and gets a short room code. Other phones join with the
 * code (or an invite link); up to 4 players per room. Guests connect only to the host,
 * which relays game messages between them and runs the bots. Each phone simulates its
 * own field; see Room in engine.js for which messages are exchanged.
 *
 * Robustness:
 *  - Heartbeat: both sides ping every 4 s; a link silent for 15 s is treated as dead.
 *    A device that was itself paused (app in background) does not judge others by it.
 *  - A guest whose link drops stays in the room and reconnects for up to 45 s; the host
 *    recognises the returning guest by a per-tab client id.
 *  - Every step is written to a small log (BN.net.diag()) shown under "Connection details".
 *
 * Transports:
 *  - PeerTransport: WebRTC data channels via PeerJS (js/vendor/peerjs.min.js).
 *    Uses the free PeerJS cloud server to introduce phones to each other, unless
 *    ?peerhost=…&peerport=…&peersecure=0|1&peerpath=… points at your own PeerServer.
 *    Extra TURN relays can be added in js/config.js (BN_CONFIG.turn).
 *  - LocalTransport (?net=local): BroadcastChannel between tabs of one browser,
 *    for testing on a single computer.
 */
(function (BN) {
  'use strict';

  const PROTO = 1;
  const MAX_PLAYERS = 4;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'blocksnet-v1-';
  const PING_MS = 4000;
  const DEAD_MS = 15000;
  const RECONNECT_FOR_MS = 45000;

  const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  // Names travel between phones and end up in the page, so keep them to safe characters.
  const cleanName = n => (String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12)) || 'Player';
  const cleanText = t => String(t || '').slice(0, 200);
  const rid = () => Math.random().toString(36).slice(2, 10);

  const params = new URLSearchParams(location.search);
  const JOIN_TIMEOUT = 20000;
  const NO_DIRECT = "Couldn't connect to the host's phone. Check that the host still has BlocksNet open " +
    "on the room screen (not switched to another app), then tap Join again. If it keeps failing, put both " +
    'phones on the same Wi-Fi: some mobile networks block direct phone-to-phone connections.';

  // ------------------------------------------------------------ diagnostics
  const DIAG = [];
  const T0 = Date.now();
  function note(text) {
    const t = ((Date.now() - T0) / 1000).toFixed(1).padStart(6);
    DIAG.push(`${t}s  ${text}`);
    if (DIAG.length > 400) DIAG.shift();
  }
  note(`BlocksNet ${BN.VERSION || '?'} · ${navigator.userAgent}`);

  // Log what the browser's WebRTC layer is doing for one data connection.
  function watchConnection(conn, who) {
    const pc = conn && conn.peerConnection;
    if (!pc || pc.__bnWatched) return;
    pc.__bnWatched = true;
    const types = {};
    pc.addEventListener('icecandidate', e => {
      if (e.candidate && e.candidate.candidate) {
        const m = e.candidate.candidate.match(/ typ (\w+)/);
        const k = (m ? m[1] : '?') + (/ tcp /i.test(e.candidate.candidate) ? '/tcp' : '');
        types[k] = (types[k] || 0) + 1;
      } else note(`${who}: own network addresses found: ${JSON.stringify(types)} (host=local, srflx=public, relay=TURN)`);
    });
    pc.addEventListener('iceconnectionstatechange', () => note(`${who}: ICE ${pc.iceConnectionState}`));
    pc.addEventListener('connectionstatechange', () => {
      note(`${who}: link ${pc.connectionState}`);
      if (pc.connectionState === 'connected') notePath(pc, who);
    });
  }
  async function notePath(pc, who) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
      note(`${who}: connected via ${l ? l.candidateType : '?'}/${l ? (l.protocol || '') : ''} ↔ ${r ? r.candidateType : '?'} (relay = through a TURN server)`);
    } catch (e) { /* stats not available */ }
  }

  // ------------------------------------------------------------ transports
  // A connection is { id, send(msg), onMessage(fn), onClose(fn), close() }.

  function wrapPeerConn(conn, who) {
    const closeFns = [];
    let closed = false;
    const fire = why => { if (!closed) { closed = true; note(`${who}: data channel with ${conn.peer.slice(0, 18)} closed (${why})`); closeFns.forEach(f => f()); } };
    conn.on('close', () => fire('closed'));
    conn.on('error', e => fire('error ' + (e && (e.type || e.message))));
    return {
      id: conn.peer,
      send: m => { try { if (conn.open) conn.send(m); } catch (e) { /* channel closing */ } },
      onMessage: fn => conn.on('data', fn),
      onClose: fn => closeFns.push(fn),
      close: () => { try { conn.close(); } catch (e) { /* ignore */ } fire('closed by this device'); },
    };
  }

  // STUN servers let each phone learn its public address; TURN relays carry the data when
  // the phones cannot reach each other directly. PeerJS's own servers are kept, plus extras.
  function iceServers() {
    const list = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ];
    const extra = (window.BN_CONFIG && window.BN_CONFIG.turn) || [];
    return list.concat(extra);
  }

  function peerOptions() {
    const o = { debug: 0, config: { iceServers: iceServers(), sdpSemantics: 'unified-plan' } };
    if (params.get('peerhost')) {
      o.host = params.get('peerhost');
      o.port = +(params.get('peerport') || 443);
      o.secure = params.get('peersecure') !== '0';
      o.path = params.get('peerpath') || '/';
    }
    return o;
  }

  function peerErrorText(err) {
    const map = {
      'peer-unavailable': 'Room not found. Check the code, and that the host is still in the room.',
      'network': 'Could not reach the connection server. Check your internet connection.',
      'server-error': 'The connection server is not responding. Try again in a moment.',
      'socket-error': 'Lost contact with the connection server.',
      'socket-closed': 'Lost contact with the connection server.',
      'browser-incompatible': 'This browser does not support online play (WebRTC).',
      'webrtc': NO_DIRECT,
    };
    return map[err && err.type] || ('Connection problem: ' + (err && (err.type || err.message) || 'unknown'));
  }

  // One PeerJS client per page for joining, reused between attempts: Safari with iCloud
  // Private Relay may stall a second WebSocket to the same server (WebKit bug 302561).
  let guestPeer = null;
  function getGuestPeer() {
    if (guestPeer && !guestPeer.destroyed) {
      if (guestPeer.disconnected) { note('guest: reconnecting to the connection server'); try { guestPeer.reconnect(); } catch (e) { /* ignore */ } }
      return guestPeer;
    }
    note('guest: contacting the connection server' + (params.get('peerhost') ? ` ${params.get('peerhost')}` : ' (PeerJS cloud)'));
    guestPeer = new window.Peer(peerOptions());
    guestPeer.on('open', id => note(`guest: connection server OK (id ${id.slice(0, 8)}…)`));
    guestPeer.on('disconnected', () => {
      note('guest: connection server dropped; reconnecting');
      setTimeout(() => { try { if (guestPeer && !guestPeer.destroyed && guestPeer.disconnected) guestPeer.reconnect(); } catch (e) { /* ignore */ } }, 1000);
    });
    guestPeer.on('error', e => note(`guest: error ${e.type}${e.message ? ' – ' + String(e.message).slice(0, 120) : ''}`));
    return guestPeer;
  }

  const PeerTransport = {
    name: 'peerjs',
    host(code, { onConnection, onReady, onError }) {
      if (!window.Peer) { onError('Online library failed to load.'); return () => {}; }
      note(`host: opening room ${code}` + (params.get('peerhost') ? ` on ${params.get('peerhost')}` : ' on PeerJS cloud'));
      const peer = new window.Peer(ID_PREFIX + code.toLowerCase(), peerOptions());
      peer.on('open', () => { note('host: room registered on the connection server'); onReady(code); });
      peer.on('connection', conn => {
        note(`host: a guest is connecting (${conn.peer.slice(0, 8)}…)`);
        watchConnection(conn, 'host');
        conn.on('open', () => { note(`host: guest ${conn.peer.slice(0, 8)}… connected`); onConnection(wrapPeerConn(conn, 'host')); });
      });
      peer.on('error', err => { note(`host: error ${err.type}${err.message ? ' – ' + String(err.message).slice(0, 120) : ''}`); onError(peerErrorText(err), err.type); });
      // The signalling socket may drop while the game keeps running; reconnect quietly.
      peer.on('disconnected', () => {
        note('host: connection server dropped; reconnecting');
        setTimeout(() => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) { /* ignore */ } }, 1000);
      });
      return () => { try { peer.destroy(); } catch (e) { /* ignore */ } };
    },
    join(code, { onOpen, onError, onStage, timeout = JOIN_TIMEOUT }) {
      if (!window.Peer) { onError('Online library failed to load.'); return () => {}; }
      const peer = getGuestPeer();
      let opened = false, failed = false, conn = null;
      const fail = (text, type) => {
        if (opened || failed) return;
        failed = true;
        clearTimeout(timer);
        note(`guest: join attempt failed (${type})`);
        if (conn) { try { conn.close(); } catch (e) { /* ignore */ } }
        onError(text, type);
      };
      // Without this, a connection that can never be made (e.g. strict mobile networks and no
      // working relay) would leave the guest on "Connecting…" forever.
      const timer = setTimeout(() => fail(NO_DIRECT, 'timeout'), timeout);
      const go = () => {
        if (failed) return;
        onStage && onStage(`Contacting the host's phone (room ${code})…`);
        note(`guest: asking the host of room ${code} to connect`);
        conn = peer.connect(ID_PREFIX + code.toLowerCase(), { reliable: true });
        watchConnection(conn, 'guest');
        conn.on('open', () => {
          if (failed) return;
          opened = true; clearTimeout(timer);
          note('guest: connected to the host');
          onOpen(wrapPeerConn(conn, 'guest'));
        });
        conn.on('error', e => fail(NO_DIRECT, 'webrtc ' + (e && e.type)));
        conn.on('close', () => fail(NO_DIRECT, 'webrtc closed'));
      };
      const onPeerError = err => {
        if (opened) return;
        if (['peer-unavailable', 'network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'webrtc'].includes(err.type)) fail(peerErrorText(err), err.type);
      };
      peer.on('error', onPeerError);
      if (peer.open) go();
      else { onStage && onStage('Reaching the connection server…'); peer.once('open', go); }
      return () => {
        clearTimeout(timer);
        peer.removeListener('error', onPeerError);
        peer.removeListener('open', go);
        if (conn && !opened) { try { conn.close(); } catch (e) { /* ignore */ } }
      };
    },
  };

  const LocalTransport = {
    name: 'local',
    host(code, { onConnection, onReady }) {
      const ch = new BroadcastChannel('blocksnet-room-' + code);
      const conns = {};
      ch.onmessage = ({ data: d }) => {
        if (d.k === 'hello') {
          const handlers = { msg: [], close: [] };
          conns[d.id] = handlers;
          ch.postMessage({ k: 'welcome', to: d.id });
          onConnection({
            id: d.id,
            send: m => ch.postMessage({ k: 'msg', to: d.id, m }),
            onMessage: fn => handlers.msg.push(fn),
            onClose: fn => handlers.close.push(fn),
            close: () => { ch.postMessage({ k: 'bye', to: d.id }); handlers.close.forEach(f => f()); delete conns[d.id]; },
          });
        } else if (d.k === 'msg' && d.from && conns[d.from]) conns[d.from].msg.forEach(f => f(d.m));
        else if (d.k === 'bye' && d.from && conns[d.from]) { conns[d.from].close.forEach(f => f()); delete conns[d.from]; }
      };
      setTimeout(() => onReady(code), 50);
      return () => { ch.postMessage({ k: 'bye', to: '*' }); ch.close(); };
    },
    join(code, { onOpen, onError }) {
      const ch = new BroadcastChannel('blocksnet-room-' + code);
      const post = m => { try { ch.postMessage(m); } catch (e) { /* channel already closed */ } };
      const id = 'tab-' + Math.random().toString(36).slice(2);
      const handlers = { msg: [], close: [] };
      let opened = false;
      ch.onmessage = ({ data: d }) => {
        if (d.to !== id && d.to !== '*') return;
        if (d.k === 'welcome' && !opened) {
          opened = true;
          onOpen({
            id: 'host',
            send: m => post({ k: 'msg', from: id, m }),
            onMessage: fn => handlers.msg.push(fn),
            onClose: fn => handlers.close.push(fn),
            close: () => { post({ k: 'bye', from: id }); handlers.close.forEach(f => f()); },
          });
        } else if (d.k === 'msg') handlers.msg.forEach(f => f(d.m));
        else if (d.k === 'bye') handlers.close.forEach(f => f());
      };
      post({ k: 'hello', id });
      setTimeout(() => { if (!opened) onError('Room not found. Check the code, and that the host is still in the room.', 'peer-unavailable'); }, 1500);
      addEventListener('pagehide', () => post({ k: 'bye', from: id }));
      return () => ch.close();
    },
  };


  const transport = params.get('net') === 'local' ? LocalTransport : PeerTransport;

  // ------------------------------------------------------------ session
  /*
   * Session events (on): 'lobby' {players, code}, 'start' {players, settings, me},
   * 'game' (engine message), 'chat' {name, text}, 'status' text, 'error' text, 'closed' text,
   * 'ready' code (host), 'reconnecting' / 'reconnected' (guest).
   */
  class Session {
    constructor() {
      this.listeners = {};
      this.isHost = false;
      this.code = '';
      this.guests = new Map();   // host only: connId -> { conn, name, cid, rx }
      this.conn = null;          // guest only: connection to host
      this.myId = 'host';
      this.inGame = new Map();   // slot -> owner id, for the current game
      this.teardown = null;
      this.closed = false;
      this.reconnecting = null;
      try { this.cid = sessionStorage.getItem('bn.cid') || rid(); sessionStorage.setItem('bn.cid', this.cid); }
      catch (e) { this.cid = rid(); }
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, d) { (this.listeners[ev] || []).forEach(fn => fn(d)); }

    // ---- heartbeat (both sides)
    startHeartbeat() {
      if (this.hb) return;
      let last = Date.now();
      this.hb = setInterval(() => {
        const now = Date.now();
        const gap = now - last;
        last = now;
        // Timers stop while the app is in the background; don't blame the others for our pause.
        const paused = gap > PING_MS * 2.5;
        if (paused) note(`this device was paused for about ${Math.round(gap / 1000)}s (app in background?)`);
        if (this.isHost) {
          for (const [id, g] of this.guests) {
            if (paused) g.rx = now;
            g.conn.send({ t: 'ping' });
            if (now - g.rx > DEAD_MS) { note(`host: no messages from ${g.name} for ${DEAD_MS / 1000}s – dropping`); g.conn.close(); }
          }
        } else if (this.conn) {
          if (paused) this.rx = now;
          this.conn.send({ t: 'ping' });
          if (now - this.rx > DEAD_MS) { note(`guest: no messages from the host for ${DEAD_MS / 1000}s`); this.conn.close(); }
        }
      }, PING_MS);
    }

    // ---- host
    host(name, attempt = 0) {
      this.isHost = true;
      this.name = cleanName(name);
      this.code = newCode();
      this.emit('status', 'Creating room…');
      this.ready = false;
      this.teardown = transport.host(this.code, {
        onReady: code => {
          if (this.ready) { this.emit('status', ''); return; }   // signalling reconnected
          this.ready = true;
          this.startHeartbeat();
          this.emit('status', ''); this.broadcastLobby(); this.emit('ready', code);
        },
        onConnection: conn => this.acceptGuest(conn),
        onError: (text, type) => {
          if (type === 'unavailable-id' && !this.ready && attempt < 3) { this.teardown && this.teardown(); this.host(name, attempt + 1); return; }
          if (this.ready) {
            // Room already open: the connection server dropped (e.g. app was in the background),
            // or one guest's connection failed. Players already in the room stay connected.
            if (['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected', 'unavailable-id'].includes(type))
              this.emit('status', 'Reconnecting to the connection server… new players may not be able to join for a moment.');
            return;
          }
          this.emit('error', text);
        },
      });
    }

    acceptGuest(conn) {
      conn.onMessage(m => this.fromGuest(conn, m));
      conn.onClose(() => this.guestLeft(conn));
    }

    fromGuest(conn, m) {
      if (!m || typeof m !== 'object') return;
      const g = this.guests.get(conn.id);
      if (g) g.rx = Date.now();
      if (m.t === 'ping') return;
      if (m.t === 'hello') {
        if (m.v !== PROTO) { conn.send({ t: 'reject', reason: 'This room runs a different version of BlocksNet. Reload the page on both phones.' }); return; }
        const cid = String(m.cid || conn.id).slice(0, 20);
        // A guest coming back after a dropped connection replaces its old, dead entry.
        let back = false;
        for (const [id, old] of this.guests) {
          if (old.cid === cid && id !== conn.id) { back = true; this.guestLeft(old.conn, true); old.conn.close(); }
        }
        if (this.guests.size >= MAX_PLAYERS - 1) { conn.send({ t: 'reject', reason: `The room is full (${MAX_PLAYERS} players).` }); return; }
        const name = cleanName(m.name);
        this.guests.set(conn.id, { conn, name, cid, rx: Date.now() });
        note(`host: ${name} ${back ? 'rejoined' : 'joined'} (version ${String(m.ver || '?').slice(0, 20)})`);
        conn.send({ t: 'welcome', id: conn.id, code: this.code });
        this.broadcastLobby();
        const joined = { t: 'chat', system: true, text: `${name} ${back ? 'is back in' : 'joined'} the room` };
        this.emit('chat', joined);
        this.toGuests(joined);
        return;
      }
      if (!g) return;
      if (m.t === 'chat') {
        const msg = { t: 'chat', name: g.name, text: cleanText(m.text) };
        this.emit('chat', msg);
        this.toGuests(msg, conn.id);
        return;
      }
      // Game messages: a guest may only speak for the player it owns.
      const slot = m.from || m.slot;
      if (!slot || this.inGame.get(slot) !== conn.id) return;
      if (!['f', 'lines', 'special', 'dead'].includes(m.t)) return;
      this.emit('game', m);
      this.toGuests(m, conn.id);
    }

    guestLeft(conn, quiet = false) {
      const g = this.guests.get(conn.id);
      if (!g) return;
      this.guests.delete(conn.id);
      note(`host: ${g.name} ${quiet ? 'reconnected on a new link' : 'left'}`);
      if (!quiet) {
        this.emit('chat', { system: true, text: `${g.name} left the room` });
        this.toGuests({ t: 'chat', system: true, text: `${g.name} left the room` });
      }
      for (const [slot, owner] of this.inGame) {
        if (owner === conn.id) {
          const m = { t: 'dead', slot };
          this.emit('game', m);
          this.toGuests(m);
          this.inGame.delete(slot);
        }
      }
      this.broadcastLobby();
    }

    lobbyPlayers() {
      return [{ name: this.name, host: true }, ...[...this.guests.values()].map(g => ({ name: g.name }))];
    }

    broadcastLobby() {
      const msg = { t: 'lobby', code: this.code, players: this.lobbyPlayers() };
      this.emit('lobby', msg);
      this.toGuests(msg);
    }

    toGuests(m, exceptId) {
      for (const [id, g] of this.guests) if (id !== exceptId) g.conn.send(m);
    }

    // Host: build the player list (humans first, then bots to fill) and start everyone.
    startGame(settings, botCount, botSkill) {
      if (!this.isHost) return;
      const players = [{ slot: 1, name: this.name, owner: 'host' }];
      for (const [id, g] of this.guests) players.push({ slot: players.length + 1, name: g.name, owner: id });
      const names = ['Blockhead', 'LineLord', 'Nukem', 'Gravitas', 'QuakeBot', 'Specialist', 'T-Spin'].sort(() => Math.random() - 0.5);
      for (let i = 0; i < botCount && players.length < MAX_PLAYERS; i++)
        players.push({ slot: players.length + 1, name: names[i], owner: 'host', bot: true, skill: botSkill });
      this.inGame = new Map(players.map(p => [p.slot, p.owner]));
      note(`host: game started with ${players.length} players`);
      const msg = { t: 'start', players, settings };
      this.toGuests(msg);
      this.emit('start', Object.assign({}, msg, { me: 'host' }));
    }

    // ---- guest
    join(code, name) {
      this.isHost = false;
      this.code = cleanCode(code);
      this.name = cleanName(name);
      if (this.code.length !== 5) { this.emit('error', 'Room codes have 5 letters or digits.'); return; }
      note(`guest: joining room ${this.code} as ${this.name}`);
      this.emit('status', 'Connecting to room ' + this.code + '…');
      this.attempt();
    }

    attempt() {
      if (this.closed) return;
      if (this.teardown) this.teardown();
      this.teardown = transport.join(this.code, {
        timeout: this.reconnecting ? 12000 : JOIN_TIMEOUT,
        onOpen: conn => {
          if (this.closed) { conn.close(); return; }
          this.conn = conn;
          this.rx = Date.now();
          conn.onMessage(m => { this.rx = Date.now(); this.fromHost(m); });
          conn.onClose(() => this.lost(conn));
          conn.send({ t: 'hello', v: PROTO, name: this.name, cid: this.cid, ver: BN.VERSION });
          this.startHeartbeat();
        },
        onError: (text, type) => {
          if (this.reconnecting) { this.retryLater(); return; }
          this.emit('error', text);
        },
        onStage: text => { if (!this.reconnecting) this.emit('status', text); },
      });
    }

    // The link to the host died: stay in the room and try to get back in.
    lost(conn) {
      if (this.closed || conn !== this.conn) return;
      this.conn = null;
      if (this.hostLeft) { this.close(); this.emit('closed', 'The host closed the room.'); return; }
      if (!this.welcomed) { this.close(); this.emit('closed', 'Lost connection to the host.'); return; }
      if (!this.reconnecting) {
        this.reconnecting = { until: Date.now() + RECONNECT_FOR_MS, tries: 0 };
        note('guest: lost the host; reconnecting');
        this.emit('reconnecting');
      }
      this.retryLater();
    }

    retryLater() {
      if (this.closed) return;
      const r = this.reconnecting;
      if (Date.now() > r.until) {
        note('guest: could not reconnect; giving up');
        this.close();
        this.emit('closed', "Lost connection to the host and couldn't reconnect. Check that the host still has BlocksNet open.");
        return;
      }
      r.tries++;
      this.emit('status', `Connection to the host lost – reconnecting (try ${r.tries})…`);
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.attempt(), r.tries === 1 ? 500 : 2500);
    }

    fromHost(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'ping': break;
        case 'welcome':
          this.myId = m.id;
          this.welcomed = true;
          this.emit('status', '');
          if (this.reconnecting) { this.reconnecting = null; note('guest: back in the room'); this.emit('reconnected'); }
          break;
        case 'bye': this.hostLeft = true; break;
        case 'reject': note(`guest: rejected – ${m.reason}`); this.emit('error', m.reason); this.close(); break;
        case 'lobby': this.emit('lobby', { code: m.code, players: (m.players || []).map(p => ({ name: cleanName(p.name), host: !!p.host })) }); break;
        case 'start':
          note('guest: game started by the host');
          this.emit('start', {
            players: (m.players || []).map(p => ({ slot: p.slot | 0, name: cleanName(p.name), owner: String(p.owner), bot: !!p.bot })),
            settings: m.settings, me: this.myId,
          });
          break;
        case 'chat': this.emit('chat', { name: m.system ? '' : cleanName(m.name), text: cleanText(m.text), system: !!m.system }); break;
        default: this.emit('game', m);
      }
    }

    // ---- both
    // Engine messages from our own players.
    send(m) {
      if (this.isHost) this.toGuests(m);
      else if (this.conn) this.conn.send(m);
    }

    chat(text) {
      const t = cleanText(text).trim();
      if (!t) return;
      const msg = { t: 'chat', name: this.name, text: t };
      if (this.isHost) { this.toGuests(msg); this.emit('chat', msg); }
      else if (this.conn) { this.conn.send(msg); this.emit('chat', msg); }
    }

    inviteLink() {
      const u = new URL(location.href);
      u.search = '';
      u.searchParams.set('join', this.code);
      for (const k of ['net', 'peerhost', 'peerport', 'peersecure', 'peerpath']) if (params.get(k)) u.searchParams.set(k, params.get(k));
      return u.toString();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.hb);
      clearTimeout(this.retryT);
      note(`${this.isHost ? 'host' : 'guest'}: left the room`);
      if (this.isHost) {
        // Tell guests the room is closing (so they don't try to reconnect), then hang up.
        const conns = [...this.guests.values()].map(g => g.conn);
        conns.forEach(c => c.send({ t: 'bye' }));
        setTimeout(() => conns.forEach(c => c.close()), 300);
      }
      if (this.conn) this.conn.close();
      this.guests.clear();
      if (this.teardown) this.teardown();
      this.teardown = null;
    }
  }

  // ------------------------------------------------------------ public rooms (server)
  /*
   * Public rooms run on the BlocksNet server (server/worker.js) instead of phone-to-phone:
   * every phone holds one WebSocket to the server, which relays messages, picks the host
   * (first player in the room), and decides when a game ends. Same events as Session.
   */
  function serverURL() {
    const u = params.get('server') || (window.BN_CONFIG && window.BN_CONFIG.server) || '';
    return u.replace(/\/+$/, '');
  }
  function playerId() {
    try {
      let id = localStorage.getItem('bn.pid');
      if (!id) { id = rid() + rid(); localStorage.setItem('bn.pid', id); }
      return id;
    } catch (e) { return rid() + rid(); }
  }
  // Errors carry a short, human-readable reason that the Multiplayer screen shows.
  async function fetchLobby() {
    const base = serverURL();
    if (!base) throw new Error('no server address set');
    const url = `${base}/lobby?pid=${encodeURIComponent(playerId())}&t=${Date.now()}`;
    let r;
    try { r = await fetch(url, { cache: 'no-store' }); }
    catch (e) {
      // The browser hides the difference between "unreachable" and "something else answered
      // without permission for this page" (CORS), so say both.
      const why = `no usable reply from ${base} – the server may be down, still deploying, or not the BlocksNet server (${e.message || e})`;
      note('lobby: ' + why); throw new Error(why);
    }
    const body = await r.text();
    if (!r.ok) { const why = `server answered ${r.status}${body ? ': ' + body.slice(0, 80) : ''}`; note('lobby: ' + why); throw new Error(why); }
    let data;
    try { data = JSON.parse(body); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.rooms)) {
      const why = `${base} is not running the BlocksNet server (it answered: "${body.slice(0, 60).replace(/\s+/g, ' ')}")`;
      note('lobby: ' + why); throw new Error(why);
    }
    return data;
  }

  class ServerSession {
    constructor() {
      this.listeners = {};
      this.isHost = false;
      this.serverAuthority = true;   // the server announces the end of each game
      this.public = true;
      this.code = '';
      this.conn = null;
      this.myId = null;
      this.closed = false;
      this.reconnecting = null;
      this.pid = playerId();
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, d) { (this.listeners[ev] || []).forEach(fn => fn(d)); }

    joinRoom(n, name, watch = false) {
      this.watch = !!watch;
      this.room = n | 0;
      this.code = `Room ${this.room}`;
      this.name = cleanName(name);
      note(`server: joining ${this.code} as ${this.name} (${serverURL()})`);
      this.emit('status', `Joining ${this.code}…`);
      this.connect();
    }

    connect() {
      if (this.closed) return;
      const base = serverURL().replace(/^http/, 'ws');
      let ws;
      try { ws = new WebSocket(`${base}/ws/room/${this.room}`); }
      catch (e) { this.failed('Could not reach the BlocksNet server.'); return; }
      const timer = setTimeout(() => { if (ws.readyState !== 1) { note('server: no answer within 12 s'); try { ws.close(); } catch (e) { /* ignore */ } ended_(0, 'timeout'); } }, 12000);
      let opened = false, ended = false;
      // Handle the end of this socket once, whether the browser reports it or we close it
      // ourselves (some servers never answer the close, so don't wait for onclose).
      const ended_ = (code, reason) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        ws.onopen = ws.onmessage = ws.onclose = null;
        if (this.ws === ws) { this.ws = null; this.conn = null; }
        note(`server: connection closed (${code}${reason ? ' ' + reason : ''})`);
        if (this.closed) return;
        if (!opened && !this.reconnecting) { this.failed("Couldn't reach the BlocksNet server. Check your internet connection and try again."); return; }
        this.lost();
      };
      ws.onopen = () => {
        opened = true; clearTimeout(timer);
        note('server: connected');
        this.ws = ws;
        this.rx = Date.now();
        this.conn = { send: m => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch (e) { /* closing */ } }, close: () => { try { ws.close(); } catch (e) { /* ignore */ } ended_(1000, 'closed by this device'); } };
        this.conn.send({ t: 'hello', v: PROTO, name: this.name, pid: this.pid, ver: BN.VERSION, watch: this.watch && !this.welcomed });
        this.startHeartbeat();
      };
      ws.onmessage = e => {
        this.rx = Date.now();
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        this.fromServer(m);
      };
      ws.onclose = ev => ended_(ev.code, ev.reason);
    }

    failed(text) { this.close(); this.emit('error', text); }

    startHeartbeat() {
      if (this.hb) return;
      let last = Date.now();
      this.hb = setInterval(() => {
        const now = Date.now(), gap = now - last;
        last = now;
        if (gap > PING_MS * 2.5) { note(`this device was paused for about ${Math.round(gap / 1000)}s`); this.rx = now; }
        if (!this.conn) return;
        this.conn.send({ t: 'ping' });
        if (now - this.rx > DEAD_MS) { note(`server: silent for ${DEAD_MS / 1000}s`); this.conn.close(); }
      }, PING_MS);
    }

    lost() {
      if (this.closed) return;
      if (!this.welcomed) { this.close(); this.emit('closed', 'Lost connection to the server.'); return; }
      if (!this.reconnecting) {
        this.reconnecting = { until: Date.now() + RECONNECT_FOR_MS, tries: 0 };
        note('server: connection lost; reconnecting');
        this.emit('reconnecting');
      }
      const r = this.reconnecting;
      if (Date.now() > r.until) { this.close(); this.emit('closed', "Lost connection to the server and couldn't reconnect."); return; }
      r.tries++;
      this.emit('status', `Connection lost – reconnecting (try ${r.tries})…`);
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.connect(), r.tries === 1 ? 500 : 2500);
    }

    fromServer(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'ping': break;
        case 'welcome': {
          this.myId = m.id;
          this.isHost = !!m.host;
          this.spectator = !!m.spectator;
          const first = !this.welcomed;
          this.welcomed = true;
          this.emit('status', '');
          note(`server: in ${this.code}${this.isHost ? ' as host' : ''}`);
          if (first) this.emit('ready', this.code);
          if (this.reconnecting) { this.reconnecting = null; note(`server: ${m.resumed ? 'seat kept – game continues' : 'back in the room'}`); this.emit('reconnected', { resumed: !!m.resumed }); }
          this.emit('role', this.isHost);
          break;
        }
        case 'watch':
          note('server: watching the game in progress');
          this.emit('watch', {
            players: (m.players || []).map(p => ({ slot: p.slot | 0, name: cleanName(p.name), owner: String(p.owner), bot: !!p.bot })),
            settings: m.settings, fields: Array.isArray(m.fields) ? m.fields : [], dead: Array.isArray(m.dead) ? m.dead.map(x => x | 0) : [], me: this.myId,
          });
          break;
        case 'seat':
          this.spectator = false;
          this.isHost = !!m.host;
          note('server: took a free seat');
          this.emit('seat');
          this.emit('role', this.isHost);
          break;
        case 'role': this.isHost = !!m.host; note(`server: you are now ${this.isHost ? 'the host' : 'a guest'}`); this.emit('role', this.isHost); break;
        case 'reject': note(`server: rejected – ${m.reason}`); this.failed(String(m.reason || 'Could not join.')); break;
        case 'lobby': this.emit('lobby', { code: this.code, players: (m.players || []).map(p => ({ name: cleanName(p.name), host: !!p.host })), watchers: (m.watchers || []).map(cleanName) }); break;
        case 'start':
          note('server: game started');
          this.emit('start', {
            players: (m.players || []).map(p => ({ slot: p.slot | 0, name: cleanName(p.name), owner: String(p.owner), bot: !!p.bot, skill: +p.skill || 0.5 })),
            settings: m.settings, me: this.myId,
          });
          break;
        case 'chat': this.emit('chat', { name: m.system ? '' : cleanName(m.name), text: cleanText(m.text), system: !!m.system }); break;
        default: this.emit('game', m);
      }
    }

    // Host only: the server builds the player list and starts everyone.
    startGame(settings, botCount, botSkill) {
      if (!this.isHost || !this.conn) return;
      this.conn.send({ t: 'start', settings, bots: botCount, skill: botSkill });
    }
    send(m) { if (this.conn) this.conn.send(m); }
    chat(text) {
      const t = cleanText(text).trim();
      if (!t || !this.conn) return;
      this.conn.send({ t: 'chat', text: t });
      this.emit('chat', { name: this.name, text: t });
    }
    inviteLink() {
      const u = new URL(location.href);
      u.search = '';
      u.searchParams.set('room', this.room);
      if (params.get('server')) u.searchParams.set('server', params.get('server'));
      return u.toString();
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.hb);
      clearTimeout(this.retryT);
      note('server: left the room');
      if (this.ws) { try { this.ws.close(1000); } catch (e) { /* ignore */ } }
      this.conn = null;
    }
  }

  BN.net = { Session, ServerSession, fetchLobby, serverURL, playerId, transport: transport.name, cleanCode, cleanName, PROTO, diag: () => DIAG.join('\n'), note };
})(window.BN);
