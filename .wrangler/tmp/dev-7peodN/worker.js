var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// server/worker.js
import { DurableObject } from "cloudflare:workers";
var ROOMS = 6;
var MAX_PLAYERS = 4;
var PROTO = 1;
var BOT_NAMES = ["Blockhead", "LineLord", "Nukem", "Gravitas", "QuakeBot", "Specialist", "T-Spin"];
var SPEEDS = ["relaxed", "classic", "fast", "turbo", "insane"];
var GAME_TYPES = ["f", "lines", "special", "dead"];
var WEEK_MS = 7 * 24 * 3600 * 1e3;
var cleanName = /* @__PURE__ */ __name((n) => String(n || "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 12) || "Player", "cleanName");
var cleanPid = /* @__PURE__ */ __name((p) => String(p || "").replace(/[^a-z0-9]/gi, "").slice(0, 24), "cleanPid");
var cleanText = /* @__PURE__ */ __name((t) => String(t || "").slice(0, 200), "cleanText");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS }
}), "json");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "blocksnet", rooms: ROOMS });
    if (url.pathname === "/lobby" || url.pathname.startsWith("/ws/room/")) {
      const hub = env.HUB.get(env.HUB.idFromName("main"));
      return hub.fetch(request);
    }
    return json({ error: "not found" }, 404);
  }
};
var Hub = class extends DurableObject {
  static {
    __name(this, "Hub");
  }
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
    if (url.pathname === "/lobby") return json(this.summary(cleanPid(url.searchParams.get("pid"))));
    const m = url.pathname.match(/^\/ws\/room\/(\d+)$/);
    const room = m && this.rooms[+m[1] - 1];
    if (!room) return json({ error: "no such room" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected a WebSocket" }, 426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(room, server);
    return new Response(null, { status: 101, webSocket: client });
  }
  // ------------------------------------------------------------ lobby data
  summary(pid) {
    const rooms = this.rooms.map((r) => ({
      n: r.n,
      state: r.game ? "playing" : r.clients.length ? "waiting" : "empty",
      players: r.clients.map((c) => c.name)
    }));
    const mark = /* @__PURE__ */ __name((rows) => rows.map(({ pid: p, ...r }) => ({ ...r, you: !!pid && p === pid })), "mark");
    const top = mark(this.sql.exec(`SELECT pid, name, wins, games FROM players WHERE games > 0
      ORDER BY wins DESC, games ASC, updated ASC LIMIT 10`).toArray());
    const week = mark(this.sql.exec(`SELECT r.pid AS pid, p.name AS name, SUM(r.win) AS wins, COUNT(*) AS games
      FROM results r JOIN players p ON p.pid = r.pid WHERE r.ts > ?
      GROUP BY r.pid ORDER BY wins DESC, games ASC LIMIT 10`, Date.now() - WEEK_MS).toArray());
    let me = null;
    if (pid) {
      const row = this.sql.exec(`SELECT name, wins, games FROM players WHERE pid = ?`, pid).toArray()[0];
      if (row) {
        const better = this.sql.exec(
          `SELECT COUNT(*) AS c FROM players WHERE games > 0 AND (wins > ? OR (wins = ? AND games < ?))`,
          row.wins,
          row.wins,
          row.games
        ).one().c;
        me = { name: row.name, wins: row.wins, games: row.games, rank: better + 1 };
      }
    }
    return { rooms, top, week, me, maxPlayers: MAX_PLAYERS };
  }
  // ------------------------------------------------------------ connections
  attach(room, ws) {
    const c = { id: "c" + this.nextId++, ws, room, name: "", pid: "", joined: false };
    ws.addEventListener("message", (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch (e) {
        return;
      }
      if (!m || typeof m !== "object") return;
      try {
        this.onMessage(c, m);
      } catch (e) {
      }
    });
    const gone = /* @__PURE__ */ __name(() => this.leave(c), "gone");
    ws.addEventListener("close", (ev) => {
      try {
        ws.close(ev.code === 1005 ? 1e3 : ev.code, "bye");
      } catch (e) {
      }
      gone();
    });
    ws.addEventListener("error", gone);
  }
  send(c, m) {
    try {
      c.ws.send(JSON.stringify(m));
    } catch (e) {
    }
  }
  toRoom(room, m, except) {
    for (const c of room.clients) if (c !== except) this.send(c, m);
  }
  system(room, text) {
    this.toRoom(room, { t: "chat", system: true, text });
  }
  onMessage(c, m) {
    const room = c.room;
    if (m.t === "ping") {
      this.send(c, { t: "ping" });
      return;
    }
    if (!c.joined) {
      if (m.t !== "hello") return;
      if (m.v !== PROTO) {
        this.send(c, { t: "reject", reason: "This version of BlocksNet is out of date. Reload the page." });
        c.ws.close(1e3);
        return;
      }
      c.name = cleanName(m.name);
      c.pid = cleanPid(m.pid) || c.id;
      const old = room.clients.find((x) => x.pid === c.pid);
      if (old) {
        this.leave(old, true);
        try {
          old.ws.close(1e3, "replaced");
        } catch (e) {
        }
      }
      if (room.clients.length >= MAX_PLAYERS) {
        this.send(c, { t: "reject", reason: `Room ${room.n} is full (${MAX_PLAYERS} players). Try another room.` });
        c.ws.close(1e3);
        return;
      }
      c.joined = true;
      room.clients.push(c);
      if (!room.hostId) room.hostId = c.id;
      this.send(c, { t: "welcome", id: c.id, room: room.n, host: room.hostId === c.id, playing: !!room.game });
      this.system(room, `${c.name} ${old ? "is back in" : "joined"} the room`);
      this.broadcastLobby(room);
      return;
    }
    switch (m.t) {
      case "chat": {
        const text = cleanText(m.text).trim();
        if (text) this.toRoom(room, { t: "chat", name: c.name, text }, c);
        return;
      }
      case "start":
        return this.start(c, m);
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
      speed: SPEEDS.includes(s.speed) ? s.speed : "classic",
      startLevel: Math.max(1, Math.min(99, s.startLevel | 0 || 1)),
      linesPerLevel: Math.max(1, Math.min(20, s.linesPerLevel | 0 || 2))
    };
    const players = room.clients.map((x, i) => ({ slot: i + 1, name: x.name, owner: x.id, pid: x.pid }));
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const bots = Math.max(0, Math.min(MAX_PLAYERS - players.length, m.bots | 0));
    const skill = Math.max(0, Math.min(1, +m.skill || 0.5));
    for (let i = 0; i < bots; i++) players.push({ slot: players.length + 1, name: names[i], owner: c.id, bot: true, skill });
    room.game = { players, alive: new Set(players.map((p) => p.slot)), owners: new Map(players.map((p) => [p.slot, p.owner])), started: Date.now() };
    this.toRoom(room, { t: "start", players: players.map(({ pid, ...p }) => p), settings });
    this.broadcastLobby(room);
  }
  gameMessage(c, m) {
    const room = c.room, g = room.game;
    const slot = m.t === "f" || m.t === "dead" ? m.slot : m.from;
    if (g.owners.get(slot) !== c.id) return;
    this.toRoom(room, m, c);
    if (m.t === "dead") {
      g.alive.delete(slot);
      this.checkEnd(room);
    }
  }
  // Server is the referee: the game ends when at most one player is left.
  checkEnd(room) {
    const g = room.game;
    if (!g) return;
    if (g.alive.size > 1 || g.alive.size === 1 && g.players.length === 1) return;
    const winner = g.alive.size === 1 ? [...g.alive][0] : 0;
    room.game = null;
    this.toRoom(room, { t: "end", winner });
    this.record(g, winner);
    this.broadcastLobby(room);
  }
  record(g, winner) {
    const humans = g.players.filter((p) => !p.bot && p.pid);
    if (humans.length < 2) return;
    const now = Date.now();
    for (const p of humans) {
      const win = p.slot === winner ? 1 : 0;
      this.sql.exec(
        `INSERT INTO players (pid, name, wins, games, updated) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(pid) DO UPDATE SET name = excluded.name, wins = wins + excluded.wins, games = games + 1, updated = excluded.updated`,
        p.pid,
        p.name,
        win,
        now
      );
      this.sql.exec(`INSERT INTO results (pid, ts, win) VALUES (?, ?, ?)`, p.pid, now, win);
    }
    this.sql.exec(`DELETE FROM results WHERE ts < ?`, now - 8 * 24 * 3600 * 1e3);
  }
  leave(c, replaced = false) {
    const room = c.room;
    const i = room.clients.indexOf(c);
    if (i < 0) return;
    room.clients.splice(i, 1);
    if (room.game) {
      for (const [slot, owner] of room.game.owners) {
        if (owner === c.id && room.game.alive.has(slot)) {
          room.game.alive.delete(slot);
          this.toRoom(room, { t: "dead", slot });
        }
      }
    }
    if (room.hostId === c.id) {
      room.hostId = room.clients[0] ? room.clients[0].id : null;
      if (room.clients[0]) {
        this.send(room.clients[0], { t: "role", host: true });
        if (!replaced) this.system(room, `${room.clients[0].name} is now the host`);
      }
    }
    if (!replaced) this.system(room, `${c.name} left the room`);
    if (!room.clients.length) room.game = null;
    this.checkEnd(room);
    this.broadcastLobby(room);
  }
  broadcastLobby(room) {
    const players = room.clients.map((x) => ({ name: x.name, host: x.id === room.hostId }));
    this.toRoom(room, { t: "lobby", code: `Room ${room.n}`, players, playing: !!room.game });
  }
};

// ../../../tmp/claude-0/-home-user/06796e9a-1460-5793-9713-04e2f1abbc93/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../tmp/claude-0/-home-user/06796e9a-1460-5793-9713-04e2f1abbc93/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-l2zNc5/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../tmp/claude-0/-home-user/06796e9a-1460-5793-9713-04e2f1abbc93/scratchpad/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-l2zNc5/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Hub,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
