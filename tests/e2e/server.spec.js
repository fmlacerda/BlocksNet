// Public-room server (server/worker.js), tested over raw WebSockets: no browser needed.
// Each test uses its own room and leaves it empty.
const { test, expect } = require('@playwright/test');
const { BASE, client, lobby, roomCard, emptyRoom, sleep } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('site: game files are served, server code and config are not', async () => {
  const get = async p => (await fetch(BASE + p)).status;
  expect(await get('/')).toBe(200);
  expect(await get('/js/engine.js')).toBe(200);
  expect(await get('/version.json')).toBe(200);
  for (const hidden of ['/server/worker.js', '/wrangler.jsonc', '/README.md', '/.git/HEAD', '/package.json', '/tests/e2e/helpers.js', '/CLAUDE.md', '/tools/make-legal.py'])
    expect(await get(hidden), hidden).toBe(404);
  // Microsoft checks this file to show rowbusters.com as the sign-in publisher.
  const ms = await fetch(BASE + '/.well-known/microsoft-identity-association.json');
  expect(ms.status).toBe(200);
  expect(ms.headers.get('content-type')).toContain('application/json');
  expect((await ms.json()).associatedApplications[0].applicationId).toBe('64f313de-5c79-4191-b64c-3282a9a41f97');
  const h = await (await fetch(BASE + '/health')).json();
  const v = JSON.parse(await (await fetch(BASE + '/version.json')).text()).version;
  expect(h).toMatchObject({ ok: true, service: 'rowbusters', version: v, rooms: 7 });
  const modes = (await lobby()).rooms.map(r => r.mode);
  expect(modes).toEqual(['normal', 'normal', 'teams', 'normal', 'sns', 'fast', 'pure']);
});

test('host rules, relaying, referee, stats and ranking (room 1)', async () => {
  const a = await client(1, 'Alice', { pid: 't1alice', dev: 'phone' });
  const b = await client(1, 'Bob', { pid: 't1bob', dev: 'computer' });
  expect(a.last('welcome').host).toBe(true);
  expect(b.last('welcome').host).toBe(false);

  b.send({ t: 'chat', text: 'hi Alice' });
  expect(await a.waitFor('chat', m => !m.system)).toMatchObject({ name: 'Bob', text: 'hi Alice' });

  b.send({ t: 'start', bots: 1 });                                 // guests can't start
  await sleep(300);
  expect(a.last('start')).toBeUndefined();

  a.send({ t: 'start', bots: 1, skill: 0.5, settings: { speed: 'fast', mode: 'pure' } });
  const st = await b.waitFor('start');
  expect(st.players.map(p => p.name).slice(0, 2)).toEqual(['Alice', 'Bob']);
  expect(st.players[2].bot).toBe(true);
  expect(st.settings).toMatchObject({ speed: 'fast', mode: 'normal' });   // the room decides the mode
  expect((await roomCard(1)).state).toBe('playing');

  b.send({ t: 'f', slot: 1, f: 'x' });                             // Bob pretending to be Alice: dropped
  a.send({ t: 'lines', from: 1, n: 2 });
  expect(await b.waitFor('lines')).toMatchObject({ from: 1, n: 2 });
  a.send({ t: 'special', from: 1, to: 2, s: 'a' });                // specials are relayed in normal rooms
  expect(await b.waitFor('special')).toMatchObject({ from: 1, to: 2, s: 'a' });
  expect(a.got.some(m => m.t === 'f' && m.slot === 1)).toBe(false);

  a.send({ t: 'dead', slot: 3, pcs: 5, lines: 0, bust: 0 });      // bot out (Alice runs the bots)
  b.send({ t: 'dead', slot: 2, pcs: 9, lines: 1, bust: 0 });      // Bob out → Alice wins
  expect(await a.waitFor('end')).toMatchObject({ winner: 1 });
  const stats = await b.waitFor('stats');
  expect(stats.players).toHaveLength(3);
  expect(stats.players[0]).toMatchObject({ name: 'Alice', win: true, place: 1, dev: 'phone' });
  const bob = stats.players.find(p => p.name === 'Bob');
  expect(bob).toMatchObject({ win: false, dev: 'computer' });
  // Phones report their own counts; the server caps them at what's possible in the time played.
  expect(Number.isInteger(bob.pieces) && bob.pieces > 0 && bob.pieces <= 9).toBe(true);

  const L = await lobby('t1alice');
  expect(L.me).toMatchObject({ name: 'Alice', wins: 1, games: 1 });
  const row = L.top.find(r => r.you);
  expect(row).toMatchObject({ name: 'Alice', devices: 1 });
  expect(JSON.stringify(L)).not.toContain('t1alice');               // player ids never leave the server

  a.close(); b.close();
  await emptyRoom(1);
});

test('late joiners watch, full rooms take spectators, seats free up after the game (room 2)', async () => {
  const a = await client(2, 'Ann'), b = await client(2, 'Ben');
  a.send({ t: 'start', bots: 0 });
  await b.waitFor('start');
  a.send({ t: 'f', slot: 1, f: 'A'.repeat(264), pc: null, lines: 3, level: 2, inv: '' });
  await b.waitFor('f');

  const c = await client(2, 'Cat');                                 // free seat, game running: seated, watches now
  expect(c.last('welcome').spectator).toBe(false);
  const snap = await c.waitFor('watch');
  expect(snap.players.map(p => p.name)).toEqual(['Ann', 'Ben']);
  expect(snap.fields.map(f => f.slot)).toEqual([1]);

  const d = await client(2, 'Dan');
  const e = await client(2, 'Eve');                                 // 4 seats taken → spectator
  expect(e.last('welcome').spectator).toBe(true);
  const f = await client(2, 'Fay', { watch: true });               // asked to watch
  expect(f.last('welcome').spectator).toBe(true);
  expect(await roomCard(2)).toMatchObject({ players: ['Ann', 'Ben', 'Cat', 'Dan'], watchers: 2 });

  a.send({ t: 'lines', from: 1, n: 1 });
  await e.waitFor('lines');                                         // spectators see the game live
  e.send({ t: 'f', slot: 1, f: 'Z'.repeat(264) });                  // …but can't play
  e.send({ t: 'chat', text: 'go Ann!' });
  await a.waitFor('chat', m => m.text === 'go Ann!');
  expect(a.got.some(m => m.t === 'f' && m.f && m.f[0] === 'Z')).toBe(false);

  d.close();                                                        // a seat frees up mid-game…
  await sleep(300);
  expect(e.last('seat')).toBeUndefined();                           // …but spectators wait for the end
  b.send({ t: 'dead', slot: 2 });
  await a.waitFor('end');
  await e.waitFor('seat');
  expect(f.last('seat')).toBeUndefined();

  for (const x of [a, b, c, e, f]) x.close();
  await emptyRoom(2);
});

test('host hand-over, short drops keep the seat, long drops knock you out (room 4)', async () => {
  const a = await client(4, 'Ada'), b = await client(4, 'Bea');
  a.close();
  expect(await b.waitFor('role')).toMatchObject({ host: true });
  await b.waitFor('chat', m => /Ada left/.test(m.text));

  const c = await client(4, 'Cid', { pid: 't4cid' });
  b.send({ t: 'start', bots: 0 });
  await c.waitFor('start');

  c.close(4001);                                                    // network blip (not a normal close)
  await b.waitFor('chat', m => /Cid lost connection/.test(m.text));
  const c2 = await client(4, 'Cid', { pid: 't4cid' });              // back within the grace period
  expect(c2.last('welcome').resumed).toBe(true);
  expect(b.last('end')).toBeUndefined();                            // the game goes on

  c2.close(4001);                                                   // gone for good this time
  const end = await b.waitFor('end', () => true, 15000);            // 10 s grace, then out
  expect(end.winner).toBe(1);
  await b.waitFor('chat', m => /did not come back/.test(m.text));

  b.close();
  await emptyRoom(4);
});

test('teams room: balanced teams, switching, both teams needed, team win (room 3)', async () => {
  const a = await client(3, 'Abe');
  a.send({ t: 'start', bots: 0 });                                  // one team only → refused
  await a.waitFor('chat', m => m.system && /Both teams/.test(m.text));
  expect(a.last('start')).toBeUndefined();

  const b = await client(3, 'Bo');
  // Waits until a lobby update shows the given name on the given team.
  const teamIs = (name, t) => a.waitFor('lobby', m => m.players.some(p => p.name === name && p.team === t));
  const latestTeam = name => a.last('lobby').players.find(p => p.name === name).team;
  await teamIs('Abe', 'A'); await teamIs('Bo', 'B');               // newcomers join the smaller team
  const c = await client(3, 'Cy');                                  // A:1 B:1 → A
  await teamIs('Cy', 'A');
  c.send({ t: 'team', team: 'B' });
  await teamIs('Cy', 'B');
  const d = await client(3, 'Di');                                  // A:1 B:2 → A
  await teamIs('Di', 'A');
  d.send({ t: 'team', team: 'B' });                                 // B is full: ignored
  await sleep(300);
  expect(latestTeam('Di')).toBe('A');

  a.send({ t: 'start', bots: 0 });
  const st = await b.waitFor('start');
  expect(st.players.map(p => `${p.name}:${p.team}`)).toEqual(['Abe:A', 'Di:A', 'Bo:B', 'Cy:B']);
  b.send({ t: 'dead', slot: 3 });                                   // team B out
  c.send({ t: 'dead', slot: 4 });
  expect(await a.waitFor('end')).toMatchObject({ team: 'A' });
  const stats = await a.waitFor('stats');
  expect(stats.players.filter(p => p.win).map(p => p.name).sort()).toEqual(['Abe', 'Di']);

  for (const x of [a, b, c, d]) x.close();
  await emptyRoom(3);
});

test('Pure room drops specials; bots keep their names game after game (rooms 7 and 5)', async () => {
  const a = await client(7, 'Pia'), b = await client(7, 'Pol');
  a.send({ t: 'start', bots: 0 });
  expect((await b.waitFor('start')).settings.mode).toBe('pure');
  a.send({ t: 'special', from: 1, to: 2, s: 'n' });
  a.send({ t: 'lines', from: 1, n: 1 });
  await b.waitFor('lines');                                         // later message arrives…
  expect(b.last('special')).toBeUndefined();                        // …the special never does
  a.close(); b.close();
  await emptyRoom(7);

  const h = await client(5, 'Sam');
  const botNames = [];
  for (let g = 0; g < 2; g++) {
    const started = h.next('start');                                // listen before sending: no race
    h.send({ t: 'start', bots: 2 });
    const st = await started;
    expect(st.settings.mode).toBe('sns');
    botNames.push(st.players.filter(p => p.bot).map(p => p.name).join(','));
    const ended = h.next('end');
    for (const p of st.players) h.send({ t: 'dead', slot: p.slot });
    await ended;
  }
  expect(botNames[1]).toBe(botNames[0]);
  h.close();
  await emptyRoom(5);
});
