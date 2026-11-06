// The owner's daily Telegram report: games played (online, private rooms, vs bots, Practice),
// players, average time played and countries. Telegram is a local stand-in that records messages.
const { test, expect } = require('@playwright/test');
const http = require('http');
const { BASE, client, emptyRoom } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const sent = [];
let telegram;
test.beforeAll(async () => {
  telegram = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { sent.push({ url: req.url, body: JSON.parse(body || '{}') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise(r => telegram.listen(4298, '127.0.0.1', r));
});
test.afterAll(() => new Promise(r => telegram.close(r)));

const messages = from => sent.slice(from).filter(m => m.url === '/bottest-token/sendMessage');

// Today's report so far, sent through the test address, read back as numbers.
async function report() {
  const before = sent.length;
  const r = await (await fetch(`${BASE}/report/test?chat=4242`)).json();
  expect(r.sent).toBe(true);
  expect(messages(before)).toHaveLength(1);
  const m = messages(before)[0];
  expect(m.body.chat_id).toBe('4242');
  const text = m.body.text;
  const num = re => +(text.match(re) || [0, 0])[1];
  const total = text.match(/total (?:(\d+) h )?(\d+) min/);
  const countries = [...text.split('Countries:')[1].matchAll(/: (\d+)$/gm)].reduce((n, x) => n + +x[1], 0);
  return {
    text, countries,
    games: num(/Games played:<\/b> (\d+)/), online: num(/online (\d+)/), privateRooms: num(/private rooms (\d+)/),
    bots: num(/vs bots (\d+)/), practice: num(/Practice lessons: (\d+)/), players: num(/Players:<\/b> (\d+)/),
    minutes: total ? (+total[1] || 0) * 60 + +total[2] : 0,
  };
}
const played = (pid, kind, ms, host) => fetch(`${BASE}/stats/played`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid, kind, ms, host }) });

test('the daily report counts every kind of game, players, time played and countries (room 4)', async () => {
  const a = await report();
  expect(a.text).toContain('so far today');

  // An online game in a public room: two people and a bot.
  const x = await client(4, 'Rex', { pid: 'rptrex000001' });
  const y = await client(4, 'Ida', { pid: 'rptida000001' });
  x.send({ t: 'start', bots: 1 });
  await y.waitFor('start');
  expect(JSON.stringify(y.last('start'))).not.toMatch(/country|rptrex/);   // never shared with other players
  x.send({ t: 'dead', slot: 3, pcs: 1, lines: 0, bust: 0 });
  y.send({ t: 'dead', slot: 2, pcs: 1, lines: 0, bust: 0 });
  await x.waitFor('stats');
  x.close(); y.close();
  await emptyRoom(4);

  // Games the server doesn't see: two offline games, a private room (host and guest), a lesson.
  for (const r of [
    await played('rptsolo00001', 'bots', 60000), await played('rptsolo00001', 'bots', 60000),
    await played('rpthost00001', 'private', 120000, true), await played('rptguest0001', 'private', 120000, false),
    await played('rptsolo00001', 'practice', 30000),
  ]) expect(r.status).toBe(204);
  expect((await played('rptsolo00001', 'chess', 1000)).status).toBe(400);   // unknown kinds are refused
  expect((await played('', 'bots', 1000)).status).toBe(400);

  const b = await report();
  expect(b.games - a.games).toBe(4);                 // online 1 + bots 2 + private 1 (counted once)
  expect(b.online - a.online).toBe(1);
  expect(b.bots - a.bots).toBe(2);
  expect(b.privateRooms - a.privateRooms).toBe(1);
  expect(b.practice - a.practice).toBe(1);
  expect(b.players - a.players).toBe(5);             // Rex, Ida, solo, host, guest
  expect(b.countries - a.countries).toBe(5);          // each player once, in their country
  expect(b.minutes - a.minutes).toBeGreaterThanOrEqual(6);   // 6.5 min reported + the short online game
  expect(b.minutes - a.minutes).toBeLessThanOrEqual(8);
  expect(b.text).toMatch(/Average time played per player:<\/b> \d+ (h \d+ )?min/);
});

test('the morning report goes out on schedule, and the test address only answers the owner’s chat', async () => {
  const before = sent.length;
  await fetch(`${BASE}/__scheduled?cron=7+13+*+*+*`);
  await expect.poll(() => messages(before).length).toBe(1);
  expect(messages(before)[0].body.text).not.toContain('so far today');   // yesterday's full day
  expect((await fetch(`${BASE}/report/test?chat=1`)).status).toBe(404);
});

test('the bot answers /today and /yesterday in the owner’s chat only', async () => {
  // The test address also tells Telegram where to deliver the bot's messages, and its commands.
  const before = sent.length;
  await (await fetch(`${BASE}/report/test?chat=4242`)).json();
  const hook = sent.slice(before).find(m => m.url === '/bottest-token/setWebhook');
  expect(hook.body.url).toMatch(/^https:\/\/rowbusters\.com\/telegram\/[0-9a-f]{32}$/);
  expect(hook.body.secret_token).toBe(hook.body.url.split('/').pop());
  const cmds = sent.slice(before).find(m => m.url === '/bottest-token/setMyCommands');
  expect(cmds.body.commands.map(c => c.command)).toEqual(['today', 'yesterday']);

  const path = new URL(hook.body.url).pathname;
  const say = (text, { chat = 4242, key = hook.body.secret_token, to = path } = {}) => fetch(BASE + to, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': key },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chat }, text } }),
  });

  let from = sent.length;
  expect((await say('/today')).status).toBe(200);
  await expect.poll(() => messages(from).length).toBe(1);
  expect(messages(from)[0].body.text).toContain('so far today');

  from = sent.length;
  await say('/yesterday@RowbustersBot');
  await expect.poll(() => messages(from).length).toBe(1);
  expect(messages(from)[0].body.text).not.toContain('so far today');

  from = sent.length;
  await say('hello');                                                      // anything else: a short help
  await expect.poll(() => messages(from).length).toBe(1);
  expect(messages(from)[0].body.text).toContain('/today');

  from = sent.length;
  expect((await say('/today', { chat: 999 })).status).toBe(200);          // someone else's chat: ignored
  expect((await say('/today', { key: 'wrong' })).status).toBe(404);        // not from Telegram
  expect((await say('/today', { to: '/telegram/0123' })).status).toBe(404);
  await new Promise(r => setTimeout(r, 500));
  expect(messages(from)).toHaveLength(0);
});
