/*
 * Rowbusters game server (Cloudflare Worker + one Durable Object).
 *
 * - Seven public rooms (1-7), up to 4 players each. Rooms 1, 2 and 4 play normal games, room 5 is
 *   SNS (sticks and squares only) and room 6 is Fast (30% faster); room 3 is Teams (2 vs 2:
 *   each player picks team A or B, lines go only to the other team, the last team standing
 *   wins); room 7 is Pure (no specials, only the lines sent for clearing 2+ at once).
 *   The room sets the mode.
 *   Players connect with a WebSocket to /ws/room/<n>. The first player in a room is its host: the host starts games and runs
 *   the bots; if the host leaves, the next player becomes host.
 * - The server relays game messages between the players in a room (each phone still
 *   simulates its own field, exactly as in phone-to-phone play) and checks that a player
 *   only sends messages for the slots it owns.
 * - The server is the referee for the end of a game: it tracks who is still alive and
 *   announces the winner itself, then records the result in the ranking. Games only count
 *   for the ranking when at least two real players took part.
 * - After each game the server sends everyone in the room the round stats (time survived,
 *   pieces per minute, lines, rowbusts (4 lines at once), lines and specials sent/received, awards). Lines and
 *   specials sent come from the messages it relays; pieces, lines cleared and rowbusts are
 *   counted by each phone and reported with its field updates. Ranked games also add to
 *   each player's all-time totals.
 * - GET /lobby returns the rooms, the top players (all time and last 7 days) and, with
 *   ?pid=, your own rank.
 * - Accounts (optional): POST /auth/signin with a provider's ID token links the player's id to a
 *   scrambled account key (server/auth.js), so one person keeps one ranking line on every device.
 *   POST /account/delete removes the account and its results. GET /auth/config lists providers.
 */
import { DurableObject } from 'cloudflare:workers';
import { authConfig, verifySignIn } from './auth.js';
import { filterChat, badName } from './moderation.js';

const SERVER_VERSION = '2026.10.28b';   // shown on /health, to check which code is deployed
const ROOMS = 7;
const MAX_PLAYERS = 4;
const MAX_WATCHERS = 8;
const GRACE_MS = 10000;   // a player who drops mid-game keeps their seat this long
const PROTO = 1;
// Oldest game version allowed into public rooms; older ones are asked to update (the web version
// reloads itself; store apps show an update message). Versions compare as text (YYYY.MM.DDx).
const MIN_CLIENT_VERSION = '2026.10.12a';
// Abuse limits, per connection unless noted.
const LIMITS = { msgBytes: 16384, msgsPerSec: 100, chatPerWindow: 5, chatWindowMs: 10000, socketsPerIp: 12, errorsPerMin: 60, signInsPerMin: 30, reportsPerHour: 5 };
// Reports from this many different players within a day mute a player's chat for a day
// (and replace a nickname reported as offensive).
const REPORTS_TO_ACT = 3;
const REPORT_REASONS = ['chat', 'name', 'cheat', 'other'];
const BOT_NAMES = ['Blockhead', 'LineLord', 'Nukem', 'Gravitas', 'QuakeBot', 'Specialist', 'T-Spin'];
const SPEEDS = ['relaxed', 'classic', 'fast', 'turbo', 'insane'];
const GAME_TYPES = ['f', 'lines', 'special', 'dead'];
const HOSTILE = 'arsbqo';   // specials that hurt the target (same as the game's 'hostile' flag)
const MIN_SPEED_MS = 30000;   // speed awards and best speed need at least this much play
// Game mode of each room (rooms 1, 2, 4 normal; 3 = Teams 2 vs 2; 5 = SNS, sticks and squares only;
// 6 = Fast, 30% faster; 7 = Pure, no specials).
const ROOM_MODES = ['normal', 'normal', 'teams', 'normal', 'sns', 'fast', 'pure'];
const TEAMS = ['A', 'B'];
const TEAM_SIZE = 2;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const cleanName = n => (String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12)) || 'Player';
const cleanPid = p => String(p || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
// Which kind of device a player uses: shown as an icon in the round stats and the ranking.
const DEVICES = { phone: 1, computer: 2 };            // bit flags in players.devices
const cleanDev = d => (d === 'phone' || d === 'computer' ? d : '');
const cleanText = t => String(t || '').slice(0, 200);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true, service: 'rowbusters', version: SERVER_VERSION, minClient: MIN_CLIENT_VERSION, rooms: ROOMS });
    if (url.pathname === '/errors' && request.method === 'POST') return clientError(request);
    if (url.pathname === '/auth/config') return json(authConfig(env));
    if (['/auth/signin', '/account/delete', '/account/name'].includes(url.pathname) && request.method === 'POST') return account(request, env, url.pathname);
    if (url.pathname === '/lobby' || url.pathname.startsWith('/ws/room/')) {
      const hub = env.HUB.get(env.HUB.idFromName('main'));
      return hub.fetch(request);
    }
    return json({ error: 'not found' }, 404);
  },
};

// Sign-in and account deletion. The player id (kept on the device) is what the game plays under;
// signing in swaps it for the account's id, so every device of one person shares one ranking line.
let signInWindow = new Map();
async function account(request, env, path) {
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 10000)); } catch (e) { return json({ error: 'bad request' }, 400); }
  const pid = cleanPid(b.pid);
  const hub = env.HUB.get(env.HUB.idFromName('main'));
  if (path === '/account/delete') {
    if (!pid) return json({ error: 'bad request' }, 400);
    return json(await hub.deleteAccount(pid));
  }
  if (path === '/account/name') {
    const r = pid && await hub.renameAccount(pid, cleanName(b.name));
    return r ? json(r) : json({ error: 'not signed in' }, 404);
  }
  // Checking a token can mean fetching the provider's keys: limit attempts per network address.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const now = Date.now();
  const w = signInWindow.get(ip);
  if (!w || now - w.start > 60000) signInWindow.set(ip, { start: now, n: 1 });
  else if (++w.n > LIMITS.signInsPerMin) return json({ error: 'slow down' }, 429);
  if (signInWindow.size > 5000) signInWindow = new Map();
  const provider = String(b.provider || '');
  const v = await verifySignIn(env, { provider, idToken: b.idToken, nonce: String(b.nonce || '') });
  if (v.error) return json({ error: v.error }, 401);
  return json(await hub.link(v.key, provider, pid, cleanName(b.name)));
}

// Error reports from players' devices: written to the Worker log (Cloudflare → Observability).
// No IP address, player id or nickname is kept; only what went wrong, where, and the version.
let errorWindow = { start: 0, n: 0 };
async function clientError(request) {
  const now = Date.now();
  if (now - errorWindow.start > 60000) errorWindow = { start: now, n: 0 };
  if (++errorWindow.n > LIMITS.errorsPerMin) return new Response(null, { status: 429, headers: CORS });
  let e = {};
  try { e = JSON.parse((await request.text()).slice(0, 4096)); } catch (err) { /* not JSON */ }
  const clip = (v, n) => String(v || '').slice(0, n);
  console.error('client error', JSON.stringify({ msg: clip(e.msg, 300), src: clip(e.src, 200), line: e.line | 0, col: e.col | 0,
    stack: clip(e.stack, 1200), ver: clip(e.ver, 20), where: clip(e.where, 40), ua: clip(request.headers.get('User-Agent'), 160) }));
  return new Response(null, { status: 204, headers: CORS });
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      pid TEXT PRIMARY KEY, name TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS results (pid TEXT NOT NULL, ts INTEGER NOT NULL, win INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS results_ts ON results (ts)`);
    // Accounts: a scrambled key per signed-in person (no email, no name) and the player id it plays as.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS accounts (key TEXT PRIMARY KEY, pid TEXT NOT NULL, provider TEXT NOT NULL, created INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS accounts_pid ON accounts (pid)`);
    // Player reports (who reported whom, why, when) and chat mutes. Player ids only, no chat text.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (reported TEXT NOT NULL, reporter TEXT NOT NULL, reason TEXT NOT NULL, ts INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS reports_reported ON reports (reported, ts)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS mutes (pid TEXT PRIMARY KEY, until INTEGER NOT NULL)`);
    // The account's nickname: the same on every device, and nobody else's.
    try { this.sql.exec(`ALTER TABLE accounts ADD COLUMN name TEXT NOT NULL DEFAULT ''`); } catch (e) { /* exists */ }
    // All-time stat totals (added later; ALTER fails harmlessly once the column exists).
    try { this.sql.exec(`ALTER TABLE players RENAME COLUMN tetrises TO busts`); } catch (e) { /* new or already renamed */ }
    for (const col of ['pieces', 'lines', 'busts', 'sent', 'specials', 'play_ms', 'best_ppm', 'devices']) {
      try { this.sql.exec(`ALTER TABLE players ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch (e) { /* exists */ }
    }
    // clients = seated players (max 4, incl. late joiners waiting for the next game);
    // watchers = spectators beyond the 4 seats.
    this.rooms = Array.from({ length: ROOMS }, (_, i) => ({ n: i + 1, mode: ROOM_MODES[i] || 'normal', clients: [], watchers: [], hostId: null, game: null, chatLog: [] }));
    this.nextId = 1;
    this.ipCount = new Map();
    this.uniqueRankingNames();
  }

  // ------------------------------------------------------------ nicknames
  // Each nickname belongs to one player: in the ranking, and among everyone online. Taken by
  // someone else (case ignored) → the player gets a numbered variant ("Ana" → "Ana2").
  nameTaken(name, pid) {
    const lc = name.toLowerCase();
    if (this.sql.exec(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE AND pid != ? LIMIT 1`, name, pid).toArray().length) return true;
    if (this.sql.exec(`SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE AND pid != ? LIMIT 1`, name, pid).toArray().length) return true;
    return this.rooms.some(r => r.clients.concat(r.watchers).some(c => c.joined && c.pid !== pid && c.name.toLowerCase() === lc));
  }
  uniqueName(name, pid) {
    if (!this.nameTaken(name, pid)) return name;
    for (let n = 2; n < 1000; n++) {
      const v = name.slice(0, 12 - String(n).length) + n;
      if (!this.nameTaken(v, pid)) return v;
    }
    return name;
  }
  // Once: ranking lines that share a nickname (from before names were unique). The line with the
  // most games keeps it; the others get a numbered variant.
  uniqueRankingNames() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
    if (this.sql.exec(`SELECT 1 FROM meta WHERE k = 'unique_names'`).toArray().length) return;
    const seen = new Set();
    for (const r of this.sql.exec(`SELECT pid, name FROM players ORDER BY games DESC, updated DESC`).toArray()) {
      if (!seen.has(r.name.toLowerCase())) { seen.add(r.name.toLowerCase()); continue; }
      let n = 2, v;
      do { v = r.name.slice(0, 12 - String(n).length) + n++; } while (seen.has(v.toLowerCase()) ||
        this.sql.exec(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE`, v).toArray().length);
      seen.add(v.toLowerCase());
      this.sql.exec(`UPDATE players SET name = ? WHERE pid = ?`, v, r.pid);
    }
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('unique_names', '1')`);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/lobby') return json(this.summary(cleanPid(url.searchParams.get('pid'))));
    const m = url.pathname.match(/^\/ws\/room\/(\d+)$/);
    const room = m && this.rooms[+m[1] - 1];
    if (!room) return json({ error: 'no such room' }, 404);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a WebSocket' }, 426);
    // A handful of open connections per network address is plenty (a family on one Wi-Fi).
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (ip && (this.ipCount.get(ip) || 0) >= LIMITS.socketsPerIp) return json({ error: 'too many connections' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    if (ip) this.ipCount.set(ip, (this.ipCount.get(ip) || 0) + 1);
    this.attach(room, server, ip);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------ accounts (called by the Worker)
  link(key, provider, pid, name) {
    const owned = p => this.sql.exec(`SELECT 1 FROM accounts WHERE pid = ?`, p).toArray().length > 0;
    const acct = this.sql.exec(`SELECT pid, name FROM accounts WHERE key = ?`, key).toArray()[0];
    if (acct) {
      // This device's guest results join the account: one ranking line per person.
      if (pid && pid !== acct.pid && !owned(pid)) this.mergePlayer(pid, acct.pid);
      if (!acct.name) return { pid: acct.pid, created: false, name: this.setAccountName(acct.pid, name) };
      this.sql.exec(`UPDATE players SET name = ? WHERE pid = ?`, acct.name, acct.pid);
      return { pid: acct.pid, created: false, name: acct.name };
    }
    // A new account keeps this device's results, unless the device already plays for another account.
    const use = pid.length >= 12 && !owned(pid) ? pid : [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');
    this.sql.exec(`INSERT INTO accounts (key, pid, provider, created) VALUES (?, ?, ?, ?)`, key, use, provider, Date.now());
    return { pid: use, created: true, name: this.setAccountName(use, name) };
  }

  // The account's nickname (made unique), also on its ranking line. Returns the name it got.
  setAccountName(pid, name) {
    const n = this.uniqueName(badName(name) ? 'Player' : name, pid);
    this.sql.exec(`UPDATE accounts SET name = ? WHERE pid = ?`, n, pid);
    this.sql.exec(`UPDATE players SET name = ? WHERE pid = ?`, n, pid);
    for (const r of this.rooms) for (const c of r.clients.concat(r.watchers)) if (c.pid === pid) c.name = n;
    return n;
  }
  renameAccount(pid, name) {
    if (!this.sql.exec(`SELECT 1 FROM accounts WHERE pid = ?`, pid).toArray().length) return null;
    return { name: this.setAccountName(pid, name) };
  }

  mergePlayer(from, to) {
    const r = this.sql.exec(`SELECT * FROM players WHERE pid = ?`, from).toArray()[0];
    if (r) {
      this.sql.exec(`INSERT INTO players (pid, name, wins, games, updated, pieces, lines, busts, sent, specials, play_ms, best_ppm, devices)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pid) DO UPDATE SET wins = wins + excluded.wins, games = games + excluded.games, updated = MAX(updated, excluded.updated),
          pieces = pieces + excluded.pieces, lines = lines + excluded.lines, busts = busts + excluded.busts,
          sent = sent + excluded.sent, specials = specials + excluded.specials, play_ms = play_ms + excluded.play_ms,
          best_ppm = MAX(best_ppm, excluded.best_ppm), devices = devices | excluded.devices`,
        to, r.name, r.wins, r.games, r.updated, r.pieces, r.lines, r.busts, r.sent, r.specials, r.play_ms, r.best_ppm, r.devices);
      this.sql.exec(`DELETE FROM players WHERE pid = ?`, from);
    }
    this.sql.exec(`UPDATE results SET pid = ? WHERE pid = ?`, to, from);
  }

  // Removes the account (if any) and every result recorded for this player id.
  deleteAccount(pid) {
    this.sql.exec(`DELETE FROM accounts WHERE pid = ?`, pid);
    this.sql.exec(`DELETE FROM players WHERE pid = ?`, pid);
    this.sql.exec(`DELETE FROM results WHERE pid = ?`, pid);
    this.sql.exec(`DELETE FROM reports WHERE reporter = ?`, pid);
    return { deleted: true };
  }

  // ------------------------------------------------------------ reports
  mutedUntil(pid) {
    const r = this.sql.exec(`SELECT until FROM mutes WHERE pid = ?`, pid).toArray()[0];
    return r ? r.until : 0;
  }
  // A player reports another one in the same room. The report goes to the Worker log with the
  // room's recent chat (for the owner to review); several reporters in a day act automatically.
  report(room, c, m) {
    const target = room.clients.concat(room.watchers).find(x => x !== c && x.name === cleanName(m.name));
    if (!target || target.pid === c.pid) return;
    const now = Date.now(), DAY = 24 * 3600 * 1000;
    this.sql.exec(`DELETE FROM reports WHERE ts < ?`, now - 30 * DAY);   // reports are kept 30 days
    const recent = this.sql.exec(`SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND ts > ?`, c.pid, now - 3600 * 1000).one().n;
    const again = this.sql.exec(`SELECT 1 FROM reports WHERE reporter = ? AND reported = ? AND ts > ?`, c.pid, target.pid, now - DAY).toArray().length;
    this.send(c, { t: 'chat', system: true, text: `Thanks, ${target.name} was reported.`, code: 'reported', p: { name: target.name } });
    if (recent >= LIMITS.reportsPerHour || again) return;
    const reason = REPORT_REASONS.includes(m.reason) ? m.reason : 'other';
    this.sql.exec(`INSERT INTO reports (reported, reporter, reason, ts) VALUES (?, ?, ?, ?)`, target.pid, c.pid, reason, now);
    console.warn('player report', JSON.stringify({ room: room.n, reported: target.name, reason, by: c.name, chat: room.chatLog.slice(-20) }));
    const by = reason => this.sql.exec(`SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE reported = ? AND ts > ?${reason ? ' AND reason = ?' : ''}`,
      ...[target.pid, now - DAY].concat(reason ? [reason] : [])).one().n;
    if (by() >= REPORTS_TO_ACT && this.mutedUntil(target.pid) < now) {
      this.sql.exec(`INSERT OR REPLACE INTO mutes (pid, until) VALUES (?, ?)`, target.pid, now + DAY);
      console.warn('player muted', JSON.stringify({ name: target.name, until: new Date(now + DAY).toISOString() }));
    }
    // An offensive nickname, reported by several players: replaced with a plain one.
    if (reason === 'name' && by('name') >= REPORTS_TO_ACT) {
      const was = target.name;
      const acct = this.sql.exec(`SELECT 1 FROM accounts WHERE pid = ?`, target.pid).toArray().length;
      const n = acct ? this.setAccountName(target.pid, 'Player') : this.uniqueName('Player', target.pid);
      for (const r of this.rooms) for (const x of r.clients.concat(r.watchers)) if (x.pid === target.pid) { x.name = n; this.send(x, { t: 'rename', name: n }); }
      this.sql.exec(`UPDATE players SET name = ? WHERE pid = ?`, n, target.pid);
      console.warn('nickname replaced', JSON.stringify({ was, now: n }));
      this.broadcastLobby(room);
    }
  }

  // ------------------------------------------------------------ lobby data
  summary(pid) {
    const rooms = this.rooms.map(r => ({
      n: r.n,
      mode: r.mode,
      state: r.game ? 'playing' : r.clients.length ? 'waiting' : 'empty',
      players: r.clients.map(c => c.name),
      watchers: r.watchers.length,
    }));
    // Player ids never leave the server; 'you' marks the caller's own row.
    const mark = rows => rows.map(({ pid: p, ...r }) => ({ ...r, you: !!pid && p === pid }));
    const top = mark(this.sql.exec(`SELECT pid, name, wins, games, devices FROM players WHERE games > 0
      ORDER BY wins DESC, games ASC, updated ASC LIMIT 10`).toArray());
    const week = mark(this.sql.exec(`SELECT r.pid AS pid, p.name AS name, SUM(r.win) AS wins, COUNT(*) AS games, p.devices AS devices
      FROM results r JOIN players p ON p.pid = r.pid WHERE r.ts > ?
      GROUP BY r.pid ORDER BY wins DESC, games ASC LIMIT 10`, Date.now() - WEEK_MS).toArray());
    let me = null;
    if (pid) {
      const row = this.sql.exec(`SELECT name, wins, games, pieces, lines, busts, sent, specials, play_ms, best_ppm FROM players WHERE pid = ?`, pid).toArray()[0];
      if (row) {
        const better = this.sql.exec(`SELECT COUNT(*) AS c FROM players WHERE games > 0 AND (wins > ? OR (wins = ? AND games < ?))`,
          row.wins, row.wins, row.games).one().c;
        me = { name: row.name, wins: row.wins, games: row.games, rank: better + 1,
          stats: { pieces: row.pieces, lines: row.lines, busts: row.busts, sent: row.sent, specials: row.specials,
            ppm: row.play_ms ? Math.round(row.pieces / (row.play_ms / 60000)) : 0, bestPpm: row.best_ppm } };
      }
    }
    const acct = pid ? this.sql.exec(`SELECT provider, name FROM accounts WHERE pid = ?`, pid).toArray()[0] : null;
    return { rooms, top, week, me, account: acct ? acct.provider : null, accountName: acct ? acct.name : null, maxPlayers: MAX_PLAYERS };
  }

  // ------------------------------------------------------------ connections
  attach(room, ws, ip = '') {
    const c = { id: 'c' + (this.nextId++), ws, room, name: '', pid: '', joined: false, rate: { start: 0, n: 0 }, chats: [] };
    let counted = !!ip;
    const uncount = () => {
      if (!counted) return;
      counted = false;
      const n = (this.ipCount.get(ip) || 1) - 1;
      if (n > 0) this.ipCount.set(ip, n); else this.ipCount.delete(ip);
    };
    ws.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > LIMITS.msgBytes) return;
      // Message rate: a host running 3 bots sends ~45 a second. Way over that, drop; far over, disconnect.
      const now = Date.now();
      if (now - c.rate.start >= 1000) c.rate = { start: now, n: 0 };
      if (++c.rate.n > LIMITS.msgsPerSec) {
        if (c.rate.n > LIMITS.msgsPerSec * 3) { try { ws.close(1008, 'too many messages'); } catch (e) { /* closed */ } }
        return;
      }
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      try { this.onMessage(c, m); } catch (e) { /* never let one bad message break the room */ }
    });
    ws.addEventListener('close', ev => {
      // Complete the closing handshake, otherwise the phone keeps waiting for it.
      try { ws.close(ev.code === 1005 ? 1000 : ev.code, 'bye'); } catch (e) { /* already closed */ }
      uncount();
      this.leave(c, false, ev.code);
    });
    ws.addEventListener('error', () => { uncount(); this.leave(c, false, 1006); });
  }

  send(c, m) { try { c.ws.send(JSON.stringify(m)); } catch (e) { /* socket closing */ } }
  toRoom(room, m, except) { for (const c of room.clients.concat(room.watchers)) if (c !== except) this.send(c, m); }
  // Room messages carry a code and params so each player's app can show them in their own
  // language; the English text is for older apps.
  system(room, text, code, p) { this.toRoom(room, { t: 'chat', system: true, text, code, p }); }

  onMessage(c, m) {
    const room = c.room;
    if (m.t === 'ping') { this.send(c, { t: 'ping' }); return; }
    if (!c.joined) {
      if (m.t !== 'hello') return;
      if (m.v !== PROTO || !(typeof m.ver === 'string' && m.ver >= MIN_CLIENT_VERSION)) {
        this.send(c, { t: 'reject', update: true, reason: 'A newer version of Rowbusters is needed to play online. Please update the game.', code: 'update' });
        c.ws.close(1000);
        return;
      }
      c.name = cleanName(m.name);
      c.dev = cleanDev(m.dev);
      c.pid = cleanPid(m.pid) || c.id;
      c.did = cleanPid(m.did);
      // Signed in: the account's nickname. Otherwise the chosen one, unless someone else has it.
      const acctName = this.sql.exec(`SELECT name FROM accounts WHERE pid = ?`, c.pid).toArray()[0];
      c.name = acctName && acctName.name ? acctName.name : this.uniqueName(badName(c.name) ? 'Player' : c.name, c.pid);
      // Same player coming back (e.g. after a dropped connection): replace the old link.
      // Same player back on a new link (old link not noticed as dead yet, or dropped within
      // the grace period): hand their seat and players in the running game to the new link.
      const old = room.clients.concat(room.watchers).find(x => x.pid === c.pid);
      // …but one account on two devices in the same room is two people, not a reconnect.
      if (old && old.did && c.did && old.did !== c.did) {
        this.send(c, { t: 'reject', reason: 'You are already in this room on another device.', code: 'elsewhere' });
        c.ws.close(1000);
        return;
      }
      let resumeFrom = null;
      if (old && old.team) c.team = old.team;
      if (old) { resumeFrom = old.id; this.leave(old, true); try { old.ws.close(1000, 'replaced'); } catch (e) { /* ignore */ } }
      const away = room.game && room.game.away.get(c.pid);
      if (away) { resumeFrom = away.oldId; if (away.team) c.team = away.team; clearTimeout(away.timer); room.game.away.delete(c.pid); }
      let resumed = false;
      if (room.game && resumeFrom) {
        for (const [slot, owner] of room.game.owners) if (owner === resumeFrom) { room.game.owners.set(slot, c.id); resumed = true; }
      }
      // Full room (or asked to watch): join as a spectator.
      const watch = !resumed && (!!m.watch || room.clients.length >= MAX_PLAYERS);
      if (watch && room.watchers.length >= MAX_WATCHERS) { this.send(c, { t: 'reject', reason: `Room ${room.n} is full, and so are its ${MAX_WATCHERS} spectator places. Try another room.`, code: 'roomFull', p: { room: room.n, max: MAX_WATCHERS } }); c.ws.close(1000); return; }
      c.joined = true;
      c.spectator = watch;
      if (watch) room.watchers.push(c); else room.clients.push(c);
      if (!watch && !room.hostId) room.hostId = c.id;
      if (!watch) this.pickTeam(room, c);
      this.send(c, { t: 'welcome', id: c.id, room: room.n, host: room.hostId === c.id, playing: !!room.game, spectator: watch, resumed, name: c.name });
      const how = resumed ? 'resumed' : old || away ? 'back' : watch ? 'watching' : 'joined';
      this.system(room, resumed ? `${c.name} reconnected – the game goes on` : `${c.name} ${old || away ? 'is back in' : watch ? 'is watching' : 'joined'} the room`, how, { name: c.name });
      if (room.game && !resumed) this.sendSnapshot(room, c);
      this.broadcastLobby(room);
      return;
    }
    switch (m.t) {
      case 'chat': {
        const text = cleanText(m.text).trim();
        if (!text) return;
        const now = Date.now();
        c.chats = c.chats.filter(t => now - t < LIMITS.chatWindowMs);
        if (c.chats.length >= LIMITS.chatPerWindow) {
          this.send(c, { t: 'chat', system: true, text: `Slow down: up to ${LIMITS.chatPerWindow} messages every ${LIMITS.chatWindowMs / 1000} seconds.`, code: 'slow', p: { n: LIMITS.chatPerWindow, s: LIMITS.chatWindowMs / 1000 } });
          return;
        }
        c.chats.push(now);
        if (this.mutedUntil(c.pid) > now) { this.send(c, { t: 'chat', system: true, text: 'Several players reported you, so your chat is paused for now.', code: 'muted' }); return; }
        const clean = filterChat(text);
        room.chatLog.push(`${c.name}: ${clean}`);
        if (room.chatLog.length > 30) room.chatLog.shift();
        this.toRoom(room, { t: 'chat', name: c.name, text: clean }, c);
        return;
      }
      case 'report': return this.report(room, c, m);
      case 'start': return this.start(c, m);
      case 'team': {
        // Switch team between games, if that team has room.
        if (room.mode !== 'teams' || c.spectator || room.game || !TEAMS.includes(m.team) || c.team === m.team) return;
        if (room.clients.filter(x => x.team === m.team).length >= TEAM_SIZE) return;
        c.team = m.team;
        this.system(room, `${c.name} joined team ${c.team}`, 'team', { name: c.name, team: c.team });
        this.broadcastLobby(room);
        return;
      }
      default:
        if (!GAME_TYPES.includes(m.t) || !room.game) return;
        this.gameMessage(c, m);
    }
  }

  // Teams room: a new player goes to the team with fewer players (keeps their team if they had one).
  pickTeam(room, c) {
    if (room.mode !== 'teams') { c.team = ''; return; }
    const size = t => room.clients.filter(x => x !== c && x.team === t).length;
    if (TEAMS.includes(c.team) && size(c.team) < TEAM_SIZE) return;
    c.team = size('A') <= size('B') ? 'A' : 'B';
  }

  start(c, m) {
    const room = c.room;
    if (room.hostId !== c.id || room.game) return;
    const teams = room.mode === 'teams';
    const s = m.settings || {};
    const settings = {
      speed: SPEEDS.includes(s.speed) ? s.speed : 'classic',
      startLevel: Math.max(1, Math.min(99, s.startLevel | 0 || 1)),
      linesPerLevel: Math.max(1, Math.min(20, s.linesPerLevel | 0 || 2)),
      mode: room.mode,                                  // set by the room, not the host
    };
    const players = room.clients.map(x => ({ name: x.name, owner: x.id, pid: x.pid, dev: x.dev, team: teams ? x.team : undefined }));
    // Bots keep the same names game after game in a room (so the room's game summary can count
    // them); a new set is drawn once the room has emptied.
    if (!room.botNames) room.botNames = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const names = room.botNames;
    const bots = Math.max(0, Math.min(MAX_PLAYERS - players.length, m.bots | 0));
    const skill = Math.max(0, Math.min(1, +m.skill || 0.5));
    for (let i = 0; i < bots; i++) {
      const bot = { name: names[i], owner: c.id, bot: true, skill };
      // Bots join the smaller team.
      if (teams) bot.team = players.filter(p => p.team === 'A').length <= players.filter(p => p.team === 'B').length ? 'A' : 'B';
      players.push(bot);
    }
    if (teams) {
      if (TEAMS.some(t => !players.some(p => p.team === t))) {
        this.send(c, { t: 'chat', system: true, text: 'Both teams need at least one player. Add a bot or ask someone to switch team.', code: 'teamsNeeded' });
        return;
      }
      players.sort((a, b) => a.team.localeCompare(b.team));   // team A takes slots 1-2, team B the rest
    }
    players.forEach((p, i) => { p.slot = i + 1; });
    room.game = { players, settings, alive: new Set(players.map(p => p.slot)), owners: new Map(players.map(p => [p.slot, p.owner])), lastF: new Map(), away: new Map(), started: Date.now(),
      stats: new Map(players.map(p => [p.slot, { pieces: 0, lines: 0, busts: 0, sent: 0, used: 0, recv: 0, by: {}, died: 0 }])) };
    this.toRoom(room, { t: 'start', players: players.map(({ pid, ...p }) => p), settings });
    this.broadcastLobby(room);
  }

  // Someone arriving mid-game gets the game as it is now, so they can watch it.
  sendSnapshot(room, c) {
    const g = room.game;
    this.send(c, {
      t: 'watch',
      players: g.players.map(({ pid, ...p }) => p),
      settings: g.settings,
      fields: [...g.lastF.values()],
      dead: g.players.map(p => p.slot).filter(sl => !g.alive.has(sl)),
    });
  }

  gameMessage(c, m) {
    const room = c.room, g = room.game;
    const slot = m.t === 'f' || m.t === 'dead' ? m.slot : m.from;
    if (g.owners.get(slot) !== c.id) return;            // only for your own players
    if (m.t === 'dead' && !g.alive.has(slot)) return;   // sent again after a reconnect
    if (m.t === 'special' && g.settings.mode === 'pure') return;   // no specials in Pure games
    if (m.t === 'f') g.lastF.set(slot, m);
    this.track(g, slot, m);
    this.toRoom(room, m, c);
    if (m.t === 'dead') { g.alive.delete(slot); this.checkEnd(room); }
  }

  // Round stats, from the messages the server relays anyway.
  track(g, slot, m) {
    const st = g.stats.get(slot);
    if (!st || st.died) return;
    const count = (v, max) => Math.max(0, Math.min(Math.floor(max), v | 0));   // whole numbers only
    if (m.t === 'f' || m.t === 'dead') {
      // Counted by the phone; capped at what is physically possible.
      const secs = (Date.now() - g.started) / 1000;
      st.pieces = Math.max(st.pieces, count(m.pcs, secs * 10 + 5));
      st.lines = Math.max(st.lines, count(m.lines, st.pieces * 4 + 4));
      st.busts = Math.max(st.busts, count(m.bust, st.lines / 4));
    }
    if (m.t === 'dead') st.died = Date.now();
    if (m.t === 'lines') st.sent += count(m.n, 4);
    if (m.t === 'special') {
      st.used++;
      const to = g.stats.get(m.to | 0);
      if (to && (m.to | 0) !== slot) { to.recv++; if (typeof m.s === 'string' && m.s.length === 1 && HOSTILE.includes(m.s)) to.by[slot] = (to.by[slot] || 0) + 1; }
    }
  }

  // The stats card everyone in the room sees after a game: winner first, then the
  // others in reverse order of elimination.
  roundStats(g, winner, winTeam) {
    const now = Date.now();
    const rows = g.players.map(p => {
      const st = g.stats.get(p.slot);
      const ms = Math.max(1000, (st.died || now) - g.started);
      return {
        slot: p.slot, name: p.name, bot: !!p.bot, dev: p.bot ? '' : p.dev || '', team: p.team || '', win: winTeam ? p.team === winTeam : p.slot === winner, ms,
        pieces: st.pieces, ppm: Math.round(st.pieces / (ms / 60000)), lines: st.lines, busts: st.busts,
        sent: st.sent, used: st.used, recv: st.recv, by: st.by, out: st.died || now + (p.slot === winner ? 1 : 0),
      };
    }).sort((a, b) => (b.win - a.win) || (b.out - a.out));
    rows.forEach((r, i) => { r.place = i + 1; delete r.out; });
    // Award goes to the single best player (no award on a tie or when nobody scored).
    const best = (key, among = rows) => {
      const top = Math.max(0, ...among.map(r => r[key]));
      const at = among.filter(r => r[key] === top);
      return top > 0 && at.length === 1 ? at[0].slot : 0;
    };
    // Top attacker: lines sent plus specials used on others.
    rows.forEach(r => { r.attack = r.sent + rows.reduce((n, o) => n + (o.by[r.slot] || 0), 0); });
    const awards = { attacker: best('attack'), fastest: best('ppm', rows.filter(r => r.ms >= MIN_SPEED_MS)), busts: best('busts') };
    rows.forEach(r => delete r.attack);
    return { t: 'stats', ms: now - g.started, players: rows, awards };
  }

  // Server is the referee: the game ends when at most one player is left.
  checkEnd(room) {
    const g = room.game;
    if (!g) return;
    // Over when everyone left alive is on one side (one player, or one team).
    const side = sl => { const p = g.players.find(x => x.slot === sl); return (p && p.team) || '#' + sl; };
    const sides = new Set([...g.alive].map(side));
    if (sides.size > 1 || (g.alive.size === 1 && g.players.length === 1)) return;
    const winner = g.alive.size ? [...g.alive][0] : 0;
    for (const a of g.away.values()) clearTimeout(a.timer);
    room.game = null;
    const winTeam = (winner && g.players.find(p => p.slot === winner).team) || '';
    this.toRoom(room, { t: 'end', winner, team: winTeam || undefined });
    const stats = this.roundStats(g, winner, winTeam);
    this.toRoom(room, stats);
    this.record(g, winner, stats, winTeam);
    this.seatWatchers(room);
    this.broadcastLobby(room);
  }

  // Between games, spectators take any free seats (in the order they arrived).
  seatWatchers(room) {
    while (room.game === null && room.clients.length < MAX_PLAYERS && room.watchers.length) {
      const w = room.watchers.shift();
      w.spectator = false;
      room.clients.push(w);
      this.pickTeam(room, w);
      if (!room.hostId) room.hostId = w.id;
      this.send(w, { t: 'seat', host: room.hostId === w.id });
      this.system(room, `${w.name} took a free seat`, 'seat', { name: w.name });
    }
  }

  record(g, winner, stats, winTeam) {
    const humans = g.players.filter(p => !p.bot && p.pid);
    if (humans.length < 2) return;                      // vs-bots games don't count
    const now = Date.now();
    for (const p of humans) {
      const win = (winTeam ? p.team === winTeam : p.slot === winner) ? 1 : 0;
      const r = stats.players.find(x => x.slot === p.slot);
      const ppm = r.ms >= MIN_SPEED_MS ? r.ppm : 0;     // too short a game for a meaningful speed
      this.sql.exec(`INSERT INTO players (pid, name, wins, games, updated, pieces, lines, busts, sent, specials, play_ms, best_ppm, devices)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pid) DO UPDATE SET name = excluded.name, wins = wins + excluded.wins, games = games + 1, updated = excluded.updated,
          pieces = pieces + excluded.pieces, lines = lines + excluded.lines, busts = busts + excluded.busts,
          sent = sent + excluded.sent, specials = specials + excluded.specials, play_ms = play_ms + excluded.play_ms,
          best_ppm = MAX(best_ppm, excluded.best_ppm), devices = devices | excluded.devices`,
        p.pid, p.name, win, now, r.pieces, r.lines, r.busts, r.sent, r.used, r.ms, ppm, DEVICES[p.dev] || 0);
      this.sql.exec(`INSERT INTO results (pid, ts, win) VALUES (?, ?, ?)`, p.pid, now, win);
    }
    this.sql.exec(`DELETE FROM results WHERE ts < ?`, now - 8 * 24 * 3600 * 1000);
  }

  leave(c, replaced = false, code = 1000) {
    const room = c.room;
    const wi = room.watchers.indexOf(c);
    if (wi >= 0) {
      room.watchers.splice(wi, 1);
      if (!replaced) this.system(room, `${c.name} stopped watching`, 'unwatch', { name: c.name });
      this.broadcastLobby(room);
      return;
    }
    const i = room.clients.indexOf(c);
    if (i < 0) return;
    room.clients.splice(i, 1);
    const g = room.game;
    const inGame = g && [...g.owners].some(([slot, owner]) => owner === c.id && g.alive.has(slot));
    let held = false;
    if (inGame && !replaced) {
      if (code !== 1000) {
        // Dropped (network blip, app in background…): keep their players for a few seconds.
        held = true;
        g.away.set(c.pid, { oldId: c.id, name: c.name, team: c.team, timer: setTimeout(() => this.expire(room, c.pid), GRACE_MS) });
        this.system(room, `${c.name} lost connection – waiting ${GRACE_MS / 1000} s for them to come back`, 'lost', { name: c.name, s: GRACE_MS / 1000 });
      } else this.knockOut(room, c.id);       // left on purpose: out now
    }
    if (room.hostId === c.id) {
      room.hostId = room.clients[0] ? room.clients[0].id : null;
      if (room.clients[0]) {
        this.send(room.clients[0], { t: 'role', host: true });
        if (!replaced) this.system(room, `${room.clients[0].name} is now the host`, 'host', { name: room.clients[0].name });
      }
    }
    if (!replaced && !held) this.system(room, `${c.name} left the room`, 'left', { name: c.name });
    if (!room.clients.length && room.game && !room.game.away.size) room.game = null;
    if (!room.clients.length && !room.watchers.length && !room.game) room.botNames = null;
    this.checkEnd(room);
    this.seatWatchers(room);
    this.broadcastLobby(room);
  }

  // Their players (and the bots, if they were host) are out of the current game.
  knockOut(room, ownerId) {
    const g = room.game;
    if (!g) return;
    for (const [slot, owner] of g.owners) {
      if (owner === ownerId && g.alive.has(slot)) {
        g.alive.delete(slot);
        const st = g.stats.get(slot);
        if (st && !st.died) st.died = Date.now();
        this.toRoom(room, { t: 'dead', slot });
      }
    }
  }

  // Grace period over and they didn't come back.
  expire(room, pid) {
    const g = room.game;
    const a = g && g.away.get(pid);
    if (!a) return;
    g.away.delete(pid);
    this.system(room, `${a.name} did not come back and is out of this game`, 'gone', { name: a.name });
    this.knockOut(room, a.oldId);
    if (!room.clients.length && !g.away.size) room.game = null;
    this.checkEnd(room);
    this.seatWatchers(room);
    this.broadcastLobby(room);
  }

  broadcastLobby(room) {
    const players = room.clients.map(x => ({ id: x.id, name: x.name, host: x.id === room.hostId, dev: x.dev || undefined, team: x.team || undefined }));
    this.toRoom(room, { t: 'lobby', code: `Room ${room.n}`, mode: room.mode, players, watchers: room.watchers.map(x => x.name), playing: !!room.game });
  }
}
