/*
 * BlocksNet game server (Cloudflare Worker + one Durable Object).
 *
 * - Six public rooms (1-6), up to 4 players each. Players connect with a WebSocket to
 *   /ws/room/<n>. The first player in a room is its host: the host starts games and runs
 *   the bots; if the host leaves, the next player becomes host.
 * - The server relays game messages between the players in a room (each phone still
 *   simulates its own field, exactly as in phone-to-phone play) and checks that a player
 *   only sends messages for the slots it owns.
 * - The server is the referee for the end of a game: it tracks who is still alive and
 *   announces the winner itself, then records the result in the ranking. Games only count
 *   for the ranking when at least two real players took part.
 * - GET /lobby returns the rooms, the top players (all time and last 7 days) and, with
 *   ?pid=, your own rank.
 */
import { DurableObject } from 'cloudflare:workers';

const SERVER_VERSION = '2026.10.09h';   // shown on /health, to check which code is deployed
const ROOMS = 6;
const MAX_PLAYERS = 4;
const PROTO = 1;
const BOT_NAMES = ['Blockhead', 'LineLord', 'Nukem', 'Gravitas', 'QuakeBot', 'Specialist', 'T-Spin'];
const SPEEDS = ['relaxed', 'classic', 'fast', 'turbo', 'insane'];
const GAME_TYPES = ['f', 'lines', 'special', 'dead'];
const WEEK_MS = 7 * 24 * 3600 * 1000;

const cleanName = n => (String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12)) || 'Player';
const cleanPid = p => String(p || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
const cleanText = t => String(t || '').slice(0, 200);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'blocksnet', version: SERVER_VERSION, rooms: ROOMS });
    if (url.pathname === '/lobby' || url.pathname.startsWith('/ws/room/')) {
      const hub = env.HUB.get(env.HUB.idFromName('main'));
      return hub.fetch(request);
    }
    return json({ error: 'not found' }, 404);
  },
};

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      pid TEXT PRIMARY KEY, name TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS results (pid TEXT NOT NULL, ts INTEGER NOT NULL, win INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS results_ts ON results (ts)`);
    this.rooms = Array.from({ length: ROOMS }, (_, i) => ({ n: i + 1, clients: [], hostId: null, game: null }));
    this.nextId = 1;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/lobby') return json(this.summary(cleanPid(url.searchParams.get('pid'))));
    const m = url.pathname.match(/^\/ws\/room\/(\d+)$/);
    const room = m && this.rooms[+m[1] - 1];
    if (!room) return json({ error: 'no such room' }, 404);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a WebSocket' }, 426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(room, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------ lobby data
  summary(pid) {
    const rooms = this.rooms.map(r => ({
      n: r.n,
      state: r.game ? 'playing' : r.clients.length ? 'waiting' : 'empty',
      players: r.clients.map(c => c.name),
    }));
    // Player ids never leave the server; 'you' marks the caller's own row.
    const mark = rows => rows.map(({ pid: p, ...r }) => ({ ...r, you: !!pid && p === pid }));
    const top = mark(this.sql.exec(`SELECT pid, name, wins, games FROM players WHERE games > 0
      ORDER BY wins DESC, games ASC, updated ASC LIMIT 10`).toArray());
    const week = mark(this.sql.exec(`SELECT r.pid AS pid, p.name AS name, SUM(r.win) AS wins, COUNT(*) AS games
      FROM results r JOIN players p ON p.pid = r.pid WHERE r.ts > ?
      GROUP BY r.pid ORDER BY wins DESC, games ASC LIMIT 10`, Date.now() - WEEK_MS).toArray());
    let me = null;
    if (pid) {
      const row = this.sql.exec(`SELECT name, wins, games FROM players WHERE pid = ?`, pid).toArray()[0];
      if (row) {
        const better = this.sql.exec(`SELECT COUNT(*) AS c FROM players WHERE games > 0 AND (wins > ? OR (wins = ? AND games < ?))`,
          row.wins, row.wins, row.games).one().c;
        me = { name: row.name, wins: row.wins, games: row.games, rank: better + 1 };
      }
    }
    return { rooms, top, week, me, maxPlayers: MAX_PLAYERS };
  }

  // ------------------------------------------------------------ connections
  attach(room, ws) {
    const c = { id: 'c' + (this.nextId++), ws, room, name: '', pid: '', joined: false };
    ws.addEventListener('message', ev => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      try { this.onMessage(c, m); } catch (e) { /* never let one bad message break the room */ }
    });
    const gone = () => this.leave(c);
    ws.addEventListener('close', ev => {
      // Complete the closing handshake, otherwise the phone keeps waiting for it.
      try { ws.close(ev.code === 1005 ? 1000 : ev.code, 'bye'); } catch (e) { /* already closed */ }
      gone();
    });
    ws.addEventListener('error', gone);
  }

  send(c, m) { try { c.ws.send(JSON.stringify(m)); } catch (e) { /* socket closing */ } }
  toRoom(room, m, except) { for (const c of room.clients) if (c !== except) this.send(c, m); }
  system(room, text) { this.toRoom(room, { t: 'chat', system: true, text }); }

  onMessage(c, m) {
    const room = c.room;
    if (m.t === 'ping') { this.send(c, { t: 'ping' }); return; }
    if (!c.joined) {
      if (m.t !== 'hello') return;
      if (m.v !== PROTO) { this.send(c, { t: 'reject', reason: 'This version of BlocksNet is out of date. Reload the page.' }); c.ws.close(1000); return; }
      c.name = cleanName(m.name);
      c.pid = cleanPid(m.pid) || c.id;
      // Same player coming back (e.g. after a dropped connection): replace the old link.
      const old = room.clients.find(x => x.pid === c.pid);
      if (old) { this.leave(old, true); try { old.ws.close(1000, 'replaced'); } catch (e) { /* ignore */ } }
      if (room.clients.length >= MAX_PLAYERS) { this.send(c, { t: 'reject', reason: `Room ${room.n} is full (${MAX_PLAYERS} players). Try another room.` }); c.ws.close(1000); return; }
      c.joined = true;
      room.clients.push(c);
      if (!room.hostId) room.hostId = c.id;
      this.send(c, { t: 'welcome', id: c.id, room: room.n, host: room.hostId === c.id, playing: !!room.game });
      this.system(room, `${c.name} ${old ? 'is back in' : 'joined'} the room`);
      this.broadcastLobby(room);
      return;
    }
    switch (m.t) {
      case 'chat': {
        const text = cleanText(m.text).trim();
        if (text) this.toRoom(room, { t: 'chat', name: c.name, text }, c);
        return;
      }
      case 'start': return this.start(c, m);
      default:
        if (!GAME_TYPES.includes(m.t) || !room.game) return;
        this.gameMessage(c, m);
    }
  }

  start(c, m) {
    const room = c.room;
    if (room.hostId !== c.id || room.game) return;
    const s = m.settings || {};
    const settings = {
      speed: SPEEDS.includes(s.speed) ? s.speed : 'classic',
      startLevel: Math.max(1, Math.min(99, s.startLevel | 0 || 1)),
      linesPerLevel: Math.max(1, Math.min(20, s.linesPerLevel | 0 || 2)),
    };
    const players = room.clients.map((x, i) => ({ slot: i + 1, name: x.name, owner: x.id, pid: x.pid }));
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const bots = Math.max(0, Math.min(MAX_PLAYERS - players.length, m.bots | 0));
    const skill = Math.max(0, Math.min(1, +m.skill || 0.5));
    for (let i = 0; i < bots; i++) players.push({ slot: players.length + 1, name: names[i], owner: c.id, bot: true, skill });
    room.game = { players, alive: new Set(players.map(p => p.slot)), owners: new Map(players.map(p => [p.slot, p.owner])), started: Date.now() };
    this.toRoom(room, { t: 'start', players: players.map(({ pid, ...p }) => p), settings });
    this.broadcastLobby(room);
  }

  gameMessage(c, m) {
    const room = c.room, g = room.game;
    const slot = m.t === 'f' || m.t === 'dead' ? m.slot : m.from;
    if (g.owners.get(slot) !== c.id) return;            // only for your own players
    this.toRoom(room, m, c);
    if (m.t === 'dead') { g.alive.delete(slot); this.checkEnd(room); }
  }

  // Server is the referee: the game ends when at most one player is left.
  checkEnd(room) {
    const g = room.game;
    if (!g) return;
    if (g.alive.size > 1 || (g.alive.size === 1 && g.players.length === 1)) return;
    const winner = g.alive.size === 1 ? [...g.alive][0] : 0;
    room.game = null;
    this.toRoom(room, { t: 'end', winner });
    this.record(g, winner);
    this.broadcastLobby(room);
  }

  record(g, winner) {
    const humans = g.players.filter(p => !p.bot && p.pid);
    if (humans.length < 2) return;                      // vs-bots games don't count
    const now = Date.now();
    for (const p of humans) {
      const win = p.slot === winner ? 1 : 0;
      this.sql.exec(`INSERT INTO players (pid, name, wins, games, updated) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(pid) DO UPDATE SET name = excluded.name, wins = wins + excluded.wins, games = games + 1, updated = excluded.updated`,
        p.pid, p.name, win, now);
      this.sql.exec(`INSERT INTO results (pid, ts, win) VALUES (?, ?, ?)`, p.pid, now, win);
    }
    this.sql.exec(`DELETE FROM results WHERE ts < ?`, now - 8 * 24 * 3600 * 1000);
  }

  leave(c, replaced = false) {
    const room = c.room;
    const i = room.clients.indexOf(c);
    if (i < 0) return;
    room.clients.splice(i, 1);
    // Their players (and the bots, if they were host) are out of the current game.
    if (room.game) {
      for (const [slot, owner] of room.game.owners) {
        if (owner === c.id && room.game.alive.has(slot)) { room.game.alive.delete(slot); this.toRoom(room, { t: 'dead', slot }); }
      }
    }
    if (room.hostId === c.id) {
      room.hostId = room.clients[0] ? room.clients[0].id : null;
      if (room.clients[0]) {
        this.send(room.clients[0], { t: 'role', host: true });
        if (!replaced) this.system(room, `${room.clients[0].name} is now the host`);
      }
    }
    if (!replaced) this.system(room, `${c.name} left the room`);
    if (!room.clients.length) room.game = null;
    this.checkEnd(room);
    this.broadcastLobby(room);
  }

  broadcastLobby(room) {
    const players = room.clients.map(x => ({ name: x.name, host: x.id === room.hostId }));
    this.toRoom(room, { t: 'lobby', code: `Room ${room.n}`, players, playing: !!room.game });
  }
}
