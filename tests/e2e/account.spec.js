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
  const first = await signIn({ idToken: token(), pid: devA, name: 'Alicia' });   // first sign-in keeps this device's results
  expect(first).toMatchObject({ status: 200, pid: devA, created: true, name: 'Alicia' });

  await rankedWin(devB, 'otherplayer01');                           // a second device, still a guest
  expect((await lobby(devB)).me).toMatchObject({ wins: 1 });
  const second = await signIn({ idToken: token(), pid: devB, name: 'Ally' });     // same person signs in there
  expect(second).toMatchObject({ status: 200, pid: devA, created: false, name: 'Alicia' });   // the account's nickname
  const L = await lobby(devA);
  expect(L.me).toMatchObject({ wins: 2, games: 2 });                // both devices' wins, one line
  expect(L.account).toBe('test');
  expect((await lobby(devB)).me).toBeNull();
  expect(L.top.filter(r => r.name === 'Alicia').length).toBe(1);
  expect(L.top.filter(r => r.name.startsWith('Win')).length).toBe(0);
  expect(JSON.stringify(L)).not.toMatch(/alice\b|devicealice/);                   // nothing about the person leaves the server

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
  await p.click('#rb-tab-online'); await p.click('#rb-mp-open');
  const btn = p.locator('.rb-sso-google');
  await expect(p.locator('.rb-sso')).toHaveText(['Apple', 'Google', 'Microsoft']);   // compact: logo + name…
  await expect(btn).toHaveAttribute('aria-label', 'Continue with Google');           // …the full wording is the label
  await expect(p.locator('.rb-sso-microsoft')).toHaveAttribute('aria-label', 'Continue with Microsoft (Hotmail, Outlook)');
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

test('nicknames are unique: guests get a variant, accounts own theirs on every device (room 5)', async () => {
  const acc = await signIn({ idToken: token({ sub: 'nina' }), pid: 'devicenina001', name: 'Nina' });
  expect(acc.name).toBe('Nina');
  // A guest choosing an account's nickname plays under a variant, and is told which.
  const guest = await client(5, 'nina', { pid: 'guestnina0001' });
  expect(guest.last('welcome').name).toBe('nina2');
  // The account's own devices get its nickname, whatever the device had typed.
  const mine = await client(5, 'Whatever', { pid: 'devicenina001' });
  expect(mine.last('welcome').name).toBe('Nina');
  // Two guests online with one nickname: the second gets a variant.
  const g2 = await client(5, 'Zoe', { pid: 'guestzoe00001' }), g3 = await client(5, 'ZOE', { pid: 'guestzoe00002' });
  expect([g2.last('welcome').name, g3.last('welcome').name]).toEqual(['Zoe', 'ZOE2']);
  for (const x of [guest, mine, g2, g3]) x.close();
  await emptyRoom(5);
  // Renaming a signed-in account: unique too, and the ranking line follows.
  const ren = n => fetch(BASE + '/account/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 'devicenina001', name: n }) }).then(r => r.json());
  await signIn({ idToken: token({ sub: 'yara' }), pid: 'deviceyara001', name: 'Yara' });
  expect(await ren('yara')).toEqual({ name: 'yara2' });             // taken by another account
  expect(await ren('Nena')).toEqual({ name: 'Nena' });
  expect((await lobby('devicenina001')).accountName).toBe('Nena');
  const notSignedIn = await fetch(BASE + '/account/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 'guestzoe00001', name: 'X' }) });
  expect(notSignedIn.status).toBe(404);
});

test('in the game: a guest whose nickname is taken is told, and plays under the variant (room 7)', async ({ browser }) => {
  const p = await openGame(browser, 'Nena');                        // the account above owns "Nena"
  await p.click('#rb-tab-online'); await p.click('#rb-mp-open');
  await p.click('.rb-join[data-room="7"]');
  await expect(p.locator('#rb-chat')).toContainText('“Nena” is already taken, so you play as Nena2');
  await expect(p.locator('#rb-plist')).toContainText('Nena2');
  await p.click('#rb-leave');
  await expect(p.locator('#rb-name')).toHaveValue('Nena2');          // remembered for next time
  expect(p.errors).toEqual([]);
  await p.context().close();
  await emptyRoom(7);
});

test('one account on two devices in the same room: the second is told, not swapped in (room 6)', async () => {
  await signIn({ idToken: token({ sub: 'omar' }), pid: 'deviceomar001', name: 'Omar' });
  const phone = await client(6, 'Omar', { pid: 'deviceomar001', did: 'phone1' });
  const laptop = await client(6, 'Omar', { pid: 'deviceomar001', did: 'laptop1', expectReject: true });
  expect(laptop.last('reject')).toMatchObject({ code: 'elsewhere' });
  expect(phone.ws.readyState).toBe(WebSocket.OPEN);                 // the first device stays in
  const back = await client(6, 'Omar', { pid: 'deviceomar001', did: 'phone1' });   // same device reconnecting: fine
  expect(back.last('welcome')).toBeTruthy();
  phone.close(); back.close();
  await emptyRoom(6);
});
