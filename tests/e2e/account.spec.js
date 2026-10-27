// Accounts: sign-in (server checks of the ID token), one ranking line per person across devices,
// sign out and account deletion. Real providers can't be reached from tests, so tokens come from a
// throwaway "test" provider whose key playwright.config.js makes for the local server only.
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BASE, GAME_URL, client, lobby, emptyRoom, openGame } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const KEY = crypto.createPrivateKey({ key: JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'rowbusters-test-auth.json'), 'utf8')).private, format: 'jwk' });
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims = {}, { key = KEY, kid = 'test1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'rowbusters-test', aud: 'rowbusters-test', sub: 'alice', iat: now, exp: now + 600, nonce: 'n1', ...claims };
  const data = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(body);
  return data + '.' + crypto.sign('sha256', Buffer.from(data), key).toString('base64url');
}
const signIn = (body, provider = 'test') => fetch(BASE + '/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider, nonce: 'n1', ...body }) }).then(async r => ({ status: r.status, ...(await r.json()) }));

// A ranked game in room 4 (two real players): the first one wins.
// The provider sends the player back with a full page load.
async function backFromProvider(p, hash) { await p.goto('about:blank'); await p.goto(`${GAME_URL}#${hash}`); }

async function rankedWin(winnerPid, loserPid) {
  const a = await client(4, 'Win' + winnerPid.slice(-3), { pid: winnerPid }), b = await client(4, 'Los' + loserPid.slice(-3), { pid: loserPid });
  a.send({ t: 'start', bots: 0 });
  await b.waitFor('start');
  b.send({ t: 'dead', slot: 2 });
  await a.waitFor('stats');
  a.close(); b.close();
  await emptyRoom(4);
}

test('the server only accepts genuine, fresh tokens meant for this game', async () => {
  const cfg = await (await fetch(BASE + '/auth/config')).json();
  expect(cfg).toMatchObject({ google: 'test-google-client', apple: 'test-apple-client', microsoft: 'test-microsoft-client' });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const now = Math.floor(Date.now() / 1000);
  const bad = {
    'forged signature': token({}, { key: other }),
    'unknown key': token({}, { kid: 'nope' }),
    'other game': token({ aud: 'someone-else' }),
    'other issuer': token({ iss: 'https://evil.example' }),
    'expired': token({ exp: now - 10 }),
    'replayed (wrong nonce)': token({ nonce: 'old' }),
    'garbage': 'a.b.c',
  };
  for (const [why, t] of Object.entries(bad)) expect((await signIn({ idToken: t, pid: 'guest00000001' })).status, why).toBe(401);
  // A genuine test token presented as another provider's is refused.
  expect((await signIn({ idToken: token(), pid: 'guest00000001' }, 'apple')).status).toBe(401);
  expect((await signIn({ idToken: token(), pid: 'guest00000001' }, 'nobody')).status).toBe(401);
  const ok = await signIn({ idToken: token({ sub: 'carol' }), pid: 'guestcarol001' });
  expect(ok).toMatchObject({ status: 200, pid: 'guestcarol001', created: true });
});

test('one person, two devices: one ranking line; delete removes it all', async () => {
  const devA = 'devicealice01', devB = 'devicealice02';
  await rankedWin(devA, 'otherplayer01');
  const first = await signIn({ idToken: token(), pid: devA });       // first sign-in keeps this device's results
  expect(first).toMatchObject({ status: 200, pid: devA, created: true });

  await rankedWin(devB, 'otherplayer01');                           // a second device, still a guest
  expect((await lobby(devB)).me).toMatchObject({ wins: 1 });
  const second = await signIn({ idToken: token(), pid: devB });     // same person signs in there
  expect(second).toMatchObject({ status: 200, pid: devA, created: false });
  const L = await lobby(devA);
  expect(L.me).toMatchObject({ wins: 2, games: 2 });                // both devices' wins, one line
  expect(L.account).toBe('test');
  expect((await lobby(devB)).me).toBeNull();
  expect(L.top.filter(r => r.name.startsWith('Win')).length).toBe(1);
  expect(JSON.stringify(L)).not.toMatch(/alice/);                   // nothing about the person leaves the server

  const del = await fetch(BASE + '/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: devA }) });
  expect(del.status).toBe(200);
  const after = await lobby(devA);
  expect(after.me).toBeNull();
  expect(after.account).toBeNull();
  // Signing in again starts a new, empty account.
  expect(await signIn({ idToken: token(), pid: 'freshdevice01' })).toMatchObject({ pid: 'freshdevice01', created: true });
});

test('in the game: the button leaves for the provider asking for no email; back signed in; sign out; delete', async ({ browser }) => {
  const p = await openGame(browser, 'Dee');
  let asked = null;
  await p.context().route('https://accounts.google.com/**', route => { asked = new URL(route.request().url()); return route.fulfill({ body: 'provider page' }); });
  await p.click('#rb-mp-open');
  const btn = p.locator('.rb-sso-google');
  await expect(btn).toHaveText('Continue with Google');
  await expect(p.locator('.rb-sso')).toHaveText(['Continue with Apple', 'Continue with Google', 'Continue with Microsoft (Hotmail, Outlook)']);
  await btn.click();
  await expect.poll(() => asked && asked.hostname).toBe('accounts.google.com');
  expect(Object.fromEntries(asked.searchParams)).toMatchObject({ client_id: 'test-google-client', response_type: 'id_token', scope: 'openid' });
  expect(asked.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/);

  // Coming back from the provider (here: the test provider, whose tokens the local server accepts).
  await p.goto(GAME_URL);
  const guestPid = await p.evaluate(() => RB.net.playerId());
  await p.evaluate(() => sessionStorage.setItem('rb.signin', JSON.stringify({ provider: 'test', nonce: 'n9', state: 's9', back: location.search })));
  await backFromProvider(p, `id_token=${token({ sub: 'dee', nonce: 'n9' })}&state=s9`);
  await expect(p.locator('#rb-mp-msg')).toContainText('Signed in');
  expect(p.url()).not.toContain('id_token');                        // token gone from the address bar
  expect(await p.evaluate(() => RB.net.playerId())).toBe(guestPid);  // first sign-in keeps this device's id
  await expect(p.locator('#rb-acct')).toContainText('Sign out');

  await p.click('#rb-acct [data-act="signout"]');
  await expect(p.locator('#rb-mp-msg')).toContainText('Signed out');
  expect(await p.evaluate(() => RB.net.playerId())).not.toBe(guestPid);
  await expect(p.locator('.rb-sso-google')).toBeVisible();

  // Sign in again (back to the account's id), then delete the account.
  await p.evaluate(() => sessionStorage.setItem('rb.signin', JSON.stringify({ provider: 'test', nonce: 'n10', state: 's10', back: location.search })));
  await backFromProvider(p, `id_token=${token({ sub: 'dee', nonce: 'n10' })}&state=s10`);
  await expect(p.locator('#rb-mp-msg')).toContainText('Signed in');
  expect(await p.evaluate(() => RB.net.playerId())).toBe(guestPid);
  p.once('dialog', d => d.accept());
  await p.click('#rb-acct [data-act="delete"]');
  await expect(p.locator('#rb-mp-msg')).toContainText('deleted');
  expect((await lobby(guestPid)).account).toBeNull();

  // A stale or tampered return (state doesn't match) is refused.
  await backFromProvider(p, `id_token=${token({ sub: 'dee', nonce: 'n11' })}&state=zzz`);
  await expect(p.locator('#rb-mp-msg')).toContainText('try again');
  expect(p.errors).toEqual([]);
  await p.context().close();
});
