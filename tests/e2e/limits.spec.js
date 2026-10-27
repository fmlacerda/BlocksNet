// Stage 1 hardening: version check, abuse limits, crash reports, update flow.
const { test, expect } = require('@playwright/test');
const { BASE, WS, VERSION, client, emptyRoom, openGame, sleep } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('versions too old for the server are asked to update', async () => {
  const health = await (await fetch(BASE + '/health')).json();
  expect(health.minClient <= VERSION).toBe(true);
  const old = await client(1, 'Olde', { ver: '2026.01.01a', expectReject: true });
  expect(old.last('reject')).toMatchObject({ update: true });
  const none = await client(1, 'Nover', { ver: undefined, expectReject: true });
  expect(none.last('reject').update).toBe(true);
  const ok = await client(1, 'Newer');                             // current version gets in
  expect(ok.last('welcome')).toBeTruthy();
  ok.close();
  await emptyRoom(1);
});

test('chat flood is slowed down; oversized messages are ignored', async () => {
  const a = await client(1, 'Ava'), b = await client(1, 'Bix');
  for (let i = 1; i <= 7; i++) b.send({ t: 'chat', text: `msg ${i}` });
  await b.waitFor('chat', m => m.system && /Slow down/.test(m.text));
  await sleep(300);
  expect(a.all('chat').filter(m => m.name === 'Bix').map(m => m.text)).toEqual(['msg 1', 'msg 2', 'msg 3', 'msg 4', 'msg 5']);
  b.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(20000) }));  // over the size limit
  await sleep(300);
  expect(a.all('chat').some(m => m.text.startsWith('xxx'))).toBe(false);
  a.close(); b.close();
  await emptyRoom(1);
});

test('a connection flooding the server is cut off', async () => {
  const a = await client(1, 'Flo');
  const closed = new Promise(res => a.ws.addEventListener('close', e => res(e.code)));
  for (let i = 0; i < 400; i++) a.send({ t: 'ping' });
  expect(await closed).toBe(1008);
  await emptyRoom(1);
});

test('one network address can hold a handful of connections, not unlimited', async () => {
  const socks = [];
  let refused = 0;
  for (let i = 0; i < 14; i++) {
    const ws = new WebSocket(WS + 2);
    const ok = await new Promise(res => { ws.onopen = () => res(true); ws.onerror = () => res(false); });
    if (ok) socks.push(ws); else refused++;
  }
  expect(socks.length).toBe(12);
  expect(refused).toBe(2);
  for (const ws of socks) ws.close();
  await sleep(500);
  const again = new WebSocket(WS + 2);                              // freed up after closing
  expect(await new Promise(res => { again.onopen = () => res(true); again.onerror = () => res(false); })).toBe(true);
  again.close();
});

test('crash reports reach the server, without personal data', async ({ browser }) => {
  const r = await fetch(BASE + '/errors', { method: 'POST', body: JSON.stringify({ msg: 'test', ver: VERSION }) });
  expect(r.status).toBe(204);
  const p = await openGame(browser, 'Bug');
  const sent = p.waitForRequest(req => req.url().endsWith('/errors') && req.method() === 'POST');
  await p.evaluate(() => setTimeout(() => { throw new Error('boom from the test'); }, 0));
  const req = await sent;
  const body = JSON.parse(req.postData());
  expect(body).toMatchObject({ msg: expect.stringContaining('boom from the test'), ver: VERSION });
  expect(JSON.stringify(body)).not.toContain('Bug');                 // no nickname
  expect(JSON.stringify(body)).not.toContain(await p.evaluate(() => RB.net.playerId()));
  await p.context().close();
});

test('an outdated web game updates itself when the server turns it away', async ({ browser }) => {
  const p = await openGame(browser, 'Upd');
  await p.evaluate(() => { RB.VERSION = '2026.01.01a'; });          // pretend to be an old copy
  await p.click('#rb-mp-open');
  await p.click('.rb-join[data-room="4"]');
  await p.waitForURL(url => url.searchParams.get('v') === require('../../version.json').version.toString() || /[?&]v=/.test(url.search), { timeout: 10000 }).catch(() => {});
  expect(new URL(p.url()).searchParams.get('v')).toBe(VERSION);    // reloaded onto the current version
  await p.context().close();
  await emptyRoom(4);
});
