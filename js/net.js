/*
 * Online play, "host is the referee" style.
 *
 * One phone hosts a room and gets a short room code. Other phones join with the
 * code (or an invite link); up to 4 players per room. Guests connect only to the host, which relays game
 * messages between them and runs the bots. Each phone simulates its own field;
 * see Room in engine.js for which messages are exchanged.
 *
 * Transports:
 *  - PeerTransport: WebRTC data channels via PeerJS (js/vendor/peerjs.min.js).
 *    Uses the free PeerJS cloud server to introduce phones to each other, unless
 *    ?peerhost=…&peerport=…&peersecure=0|1&peerpath=… points at your own PeerServer.
 *  - LocalTransport (?net=local): BroadcastChannel between tabs of one browser,
 *    for testing on a single computer.
 */
(function (BN) {
  'use strict';

  const PROTO = 1;
  const MAX_PLAYERS = 4;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'blocksnet-v1-';

  const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  // Names travel between phones and end up in the page, so keep them to safe characters.
  const cleanName = n => (String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12)) || 'Player';
  const cleanText = t => String(t || '').slice(0, 200);

  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------ transports
  // A connection is { id, send(msg), onMessage(fn), onClose(fn), close() }.

  function wrapPeerConn(conn) {
    const closeFns = [];
    let closed = false;
    const fire = () => { if (!closed) { closed = true; closeFns.forEach(f => f()); } };
    conn.on('close', fire);
    conn.on('error', fire);
    return {
      id: conn.peer,
      send: m => { try { if (conn.open) conn.send(m); } catch (e) { /* channel closing */ } },
      onMessage: fn => conn.on('data', fn),
      onClose: fn => closeFns.push(fn),
      close: () => { try { conn.close(); } catch (e) { /* ignore */ } fire(); },
    };
  }

  function peerOptions() {
    const o = { debug: 0 };
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
      'browser-incompatible': 'This browser does not support online play (WebRTC).',
      'webrtc': 'The phones could not connect directly. Try another network (e.g. Wi-Fi instead of mobile data).',
    };
    return map[err && err.type] || ('Connection problem: ' + (err && (err.type || err.message) || 'unknown'));
  }

  const PeerTransport = {
    name: 'peerjs',
    host(code, { onConnection, onReady, onError }) {
      if (!window.Peer) { onError('Online library failed to load.'); return () => {}; }
      const peer = new window.Peer(ID_PREFIX + code.toLowerCase(), peerOptions());
      peer.on('open', () => onReady(code));
      peer.on('connection', conn => conn.on('open', () => onConnection(wrapPeerConn(conn))));
      peer.on('error', err => onError(peerErrorText(err), err.type));
      // The signalling socket may drop while the game keeps running; reconnect quietly.
      peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } });
      return () => { try { peer.destroy(); } catch (e) { /* ignore */ } };
    },
    join(code, { onOpen, onError }) {
      if (!window.Peer) { onError('Online library failed to load.'); return () => {}; }
      const peer = new window.Peer(peerOptions());
      let opened = false;
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code.toLowerCase(), { reliable: true });
        conn.on('open', () => { opened = true; onOpen(wrapPeerConn(conn)); });
      });
      peer.on('error', err => { if (!opened || err.type !== 'peer-unavailable') onError(peerErrorText(err), err.type); });
      peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } });
      return () => { try { peer.destroy(); } catch (e) { /* ignore */ } };
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
   * 'game' (engine message), 'chat' {name, text}, 'status' text, 'error' text, 'closed' text.
   */
  class Session {
    constructor() {
      this.listeners = {};
      this.isHost = false;
      this.code = '';
      this.guests = new Map();   // host only: connId -> { conn, name }
      this.conn = null;          // guest only: connection to host
      this.myId = 'host';
      this.inGame = new Map();   // slot -> owner id, for the current game
      this.teardown = null;
      this.closed = false;
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, d) { (this.listeners[ev] || []).forEach(fn => fn(d)); }

    // ---- host
    host(name, attempt = 0) {
      this.isHost = true;
      this.name = cleanName(name);
      this.code = newCode();
      this.emit('status', 'Creating room…');
      this.teardown = transport.host(this.code, {
        onReady: code => { this.emit('status', ''); this.broadcastLobby(); this.emit('ready', code); },
        onConnection: conn => this.acceptGuest(conn),
        onError: (text, type) => {
          if (type === 'unavailable-id' && attempt < 3) { this.teardown && this.teardown(); this.host(name, attempt + 1); return; }
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
      if (m.t === 'hello') {
        if (m.v !== PROTO) { conn.send({ t: 'reject', reason: 'This room runs a different version of BlocksNet. Reload the page on both phones.' }); return; }
        if (this.guests.size >= MAX_PLAYERS - 1) { conn.send({ t: 'reject', reason: `The room is full (${MAX_PLAYERS} players).` }); return; }
        this.guests.set(conn.id, { conn, name: cleanName(m.name) });
        conn.send({ t: 'welcome', id: conn.id, code: this.code });
        this.broadcastLobby();
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

    guestLeft(conn) {
      const g = this.guests.get(conn.id);
      if (!g) return;
      this.guests.delete(conn.id);
      this.emit('chat', { system: true, text: `${g.name} left the room` });
      this.toGuests({ t: 'chat', system: true, text: `${g.name} left the room` });
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
      const players = [{ slot: 1, name: this.name, owner: 'host' }];
      for (const [id, g] of this.guests) players.push({ slot: players.length + 1, name: g.name, owner: id });
      const names = ['Blockhead', 'LineLord', 'Nukem', 'Gravitas', 'QuakeBot', 'Specialist', 'T-Spin'].sort(() => Math.random() - 0.5);
      for (let i = 0; i < botCount && players.length < MAX_PLAYERS; i++)
        players.push({ slot: players.length + 1, name: names[i], owner: 'host', bot: true, skill: botSkill });
      this.inGame = new Map(players.map(p => [p.slot, p.owner]));
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
      this.emit('status', 'Connecting to room ' + this.code + '…');
      this.teardown = transport.join(this.code, {
        onOpen: conn => {
          this.conn = conn;
          conn.onMessage(m => this.fromHost(m));
          conn.onClose(() => { if (!this.closed) { this.close(); this.emit('closed', 'Lost connection to the host.'); } });
          conn.send({ t: 'hello', v: PROTO, name: this.name });
        },
        onError: text => this.emit('error', text),
      });
    }

    fromHost(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'welcome': this.myId = m.id; this.emit('status', ''); break;
        case 'reject': this.emit('error', m.reason); this.close(); break;
        case 'lobby': this.emit('lobby', { code: m.code, players: (m.players || []).map(p => ({ name: cleanName(p.name), host: !!p.host })) }); break;
        case 'start':
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
      this.closed = true;
      if (this.isHost) for (const g of this.guests.values()) g.conn.close();
      if (this.conn) this.conn.close();
      this.guests.clear();
      if (this.teardown) this.teardown();
      this.teardown = null;
    }
  }

  BN.net = { Session, transport: transport.name, cleanCode, cleanName, PROTO };
})(window.BN);
