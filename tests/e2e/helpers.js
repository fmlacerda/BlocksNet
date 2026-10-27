// Shared helpers for the end-to-end tests. The server (wrangler dev) is started by
// playwright.config.js; it serves both the game files and the public-room server.
const { expect } = require('@playwright/test');

const BASE = process.env.RB_BASE || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws') + '/ws/room/';
const GAME_URL = `${BASE}/?server=${encodeURIComponent(BASE)}`;
const PROTO = 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ raw WebSocket clients
// A bare-bones player talking the game protocol, for server tests that need no browser.
async function client(room, name, opts = {}) {
  const ws = new WebSocket(WS + room);
  const got = [];
  const waiters = [];
  const c = {
    ws, got, name,
    send: m => ws.send(JSON.stringify(m)),
    last: t => [...got].reverse().find(m => m.t === t),
    all: t => got.filter(m => m.t === t),
    // Resolves with the first message (already received or arriving later) matching type + test.
    waitFor(t, test = () => true, timeout = 5000) {
      const hit = got.find(m => m.t === t && test(m));
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { t, test, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`${name}: no '${t}' within ${timeout} ms`)); } }, timeout);
      });
    },
    // Waits for a NEW message of this type (ignores ones already received).
    next(t, test = () => true, timeout = 5000) {
      const seen = got.length;
      return c.waitFor(t, m => got.indexOf(m) >= seen && test(m), timeout);
    },
    close(code = 1000) { try { ws.close(code); } catch (e) { /* closed */ } },
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    got.push(m);
    for (const w of waiters.slice()) if (w.t === m.t && w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  c.send({ t: 'hello', v: PROTO, name, pid: opts.pid || 'pid' + name.toLowerCase(), dev: opts.dev, watch: opts.watch });
  await c.waitFor(opts.expectReject ? 'reject' : 'welcome');
  return c;
}

const lobby = async (pid = '') => (await fetch(`${BASE}/lobby?pid=${pid}`)).json();
const roomCard = async n => (await lobby()).rooms[n - 1];

// Waits until a room is empty again (so tests don't leak players into each other).
async function emptyRoom(n) {
  for (let i = 0; i < 50; i++) { const r = await roomCard(n); if (!r.players.length && !r.watchers) return; await sleep(100); }
  throw new Error(`room ${n} did not empty`);
}

// ------------------------------------------------------------------ browser pages
// Opens the game with a nickname, sound/fullscreen out of the way, and collects page errors.
async function openGame(browser, name, contextOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, ...contextOpts });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(GAME_URL);
  await page.fill('#rb-name', name);
  if (await page.locator('#rb-fs').count()) await page.uncheck('#rb-fs');
  return page;
}

async function joinPublicRoom(page, n, { watch = false } = {}) {
  await page.click('#rb-mp-open');
  const btn = page.locator(`.rb-join[data-room="${n}"]${watch ? '[data-watch]' : ''}`);
  await btn.click();
  await expect(page.locator('#rb-on-room')).toBeVisible();
  await expect(page.locator('#rb-code-show')).toHaveText(`Room ${n}`);
}

// Host starts a game; waits until every page is playing (or watching).
async function hostStart(host, bots, others = []) {
  await host.selectOption('#rb-fill', String(bots));
  await host.click('#rb-on-start');
  for (const p of [host, ...others]) await p.waitForFunction(() => RB.current.room.running, null, { timeout: 10000 });
}

// Ends the running game quickly: the given pages' own players are knocked out (in order).
async function knockOut(...pages) {
  for (const p of pages) await p.evaluate(() => { for (const pl of RB.current.room.players) if (!pl.remote && pl.alive) pl.die(); });
}

// Lets each page's own player be played by the bot brain (for realistic stats).
async function autoplay(...pages) {
  for (const p of pages) await p.evaluate(() => RB.current.room.bots.push(new RB.BotBrain(RB.current.me, 0.8)));
}

async function gameOver(...pages) {
  for (const p of pages) await p.waitForFunction(() => !RB.current.room.running, null, { timeout: 120000 });
}

module.exports = { BASE, GAME_URL, PROTO, sleep, client, lobby, roomCard, emptyRoom, openGame, joinPublicRoom, hostStart, knockOut, autoplay, gameOver };
