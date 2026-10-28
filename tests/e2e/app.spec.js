// The iPhone app's copy of the game (tools/build-www.js → www/), opened in a browser with a
// stand-in for the app's native side (Capacitor). Checks what differs inside the app: Apple's own
// sign-in sheet, Google and Microsoft through Apple's web sign-in sheet, the iPhone's haptics,
// no "Add to Home Screen" tip.
const { test, expect, devices } = require('@playwright/test');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BASE, GAME_URL, emptyRoom } = require('./helpers');

const WWW = path.join(os.tmpdir(), 'rowbusters-test-www');
const APP = 'http://127.0.0.1:4199';   // a real local server: browsers block faked pages from reaching local ones   // a local address, like the server (browsers block public → local)
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' };

let server;
test.beforeAll(async () => {
  execFileSync('node', [path.join(__dirname, '../../tools/build-www.js'), WWW]);
  server = http.createServer((req, res) => {
    const file = path.join(WWW, decodeURIComponent(new URL(req.url, APP).pathname).replace(/^\/$/, '/index.html'));
    if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(4199, '127.0.0.1', r));
});
test.afterAll(() => new Promise(r => server.close(r)));

async function openApp(browser) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  // The native side: what Capacitor's iOS shell provides, recording every call.
  await context.addInitScript(() => {
    window.nativeCalls = [];
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'Haptics', methods: [{ name: 'impact', rtype: 'promise' }, { name: 'notification', rtype: 'promise' }] },
        { name: 'SignInWithApple', methods: [{ name: 'authorize', rtype: 'promise' }] },
        { name: 'WebSignIn', methods: [{ name: 'open', rtype: 'promise' }] },
      ],
      nativePromise(plugin, method, options) {
        window.nativeCalls.push({ plugin, method, options });
        if (plugin === 'SignInWithApple') return Promise.reject(new Error('The operation couldn’t be completed. (1001)'));
        // The sign-in sheet: the provider's page answers through rowbusters.com, which sends it on.
        if (plugin === 'WebSignIn') {
          const q = new URL(options.url).searchParams;
          return Promise.resolve({ url: `rowbusters://signin#id_token=token-from-${q.get('client_id')}&state=${q.get('state')}` });
        }
        return Promise.resolve({});
      },
    };
    try { localStorage.setItem('rb.terms', JSON.stringify('2026-10')); } catch (e) { /* no storage */ }
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${APP}/index.html?server=${encodeURIComponent(BASE)}`);
  return page;
}

test('the app copy: Apple sign-in sheet, haptics, no Home Screen tip @webkit', async ({ browser }) => {
  expect(fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')).toContain('<script src="js/vendor/capacitor.js">');
  expect(fs.existsSync(path.join(WWW, 'server')) || fs.existsSync(path.join(WWW, 'tests')) || fs.existsSync(path.join(WWW, 'ios'))).toBe(false);
  const p = await openApp(browser);
  expect(await p.evaluate(() => Capacitor.isNativePlatform())).toBe(true);
  await expect(p.locator('.rb-fs-hint')).toHaveCount(0);            // the app is already full screen,
  await expect(p.locator('#rb-fs')).toHaveCount(0);                  // so no web full screen either

  await p.fill('#rb-name', 'Ida');
  await p.click('#rb-mp-open');
  await expect(p.locator('.rb-sso')).toHaveCount(3);                 // Apple, Google, Microsoft
  await expect(p.locator('.rb-sso').first()).toHaveClass(/rb-sso-apple/);
  await p.click('.rb-sso-apple');
  await expect(p.locator('#rb-mp-msg')).toContainText('Sign-in was cancelled');   // the sheet was closed
  const asked = await p.evaluate(() => window.nativeCalls.find(c => c.plugin === 'SignInWithApple'));
  expect(asked.method).toBe('authorize');
  expect(asked.options.nonce).toMatch(/^[0-9a-f]{32}$/);
  expect(asked.options.scopes).toBeUndefined();                      // no name, no email
  await p.click('#rb-mp-back');

  await p.click('#rb-start');                                        // a game: tapping an opponent buzzes
  await p.waitForFunction(() => RB.current.room.running);
  expect(await p.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await p.evaluate(() => { RB.current.me.inv = ['c']; });
  await p.tap('.opp >> nth=0');
  await expect.poll(() => p.evaluate(() => window.nativeCalls.some(c => c.plugin === 'Haptics' && c.method === 'impact'))).toBe(true);
  expect(p.errors).toEqual([]);
  await p.context().close();
});

test('the app copy: Google and Microsoft sign in through the web sign-in sheet @webkit', async ({ browser }) => {
  const p = await openApp(browser);
  const sent = [];
  // The server's answer is faked: the test server can't check tokens from Google or Microsoft.
  await p.route(`${BASE}/auth/signin`, async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ pid: 'apppid0000000000', name: 'Ida' }) });
  });
  await p.fill('#rb-name', 'Ida');
  for (const provider of ['google', 'microsoft']) {
    await p.evaluate(() => { try { localStorage.removeItem('rb.account'); } catch (e) { /* no storage */ } });
    await p.click('#rb-mp-open');
    await p.click(`.rb-sso-${provider}`);
    await expect(p.locator('#rb-mp-msg')).toContainText('Signed in');
    const call = await p.evaluate(() => window.nativeCalls.filter(c => c.plugin === 'WebSignIn').pop());
    expect(call.options.callbackScheme).toBe('rowbusters');
    const q = new URL(call.options.url).searchParams;
    expect(q.get('redirect_uri')).toBe('https://rowbusters.com/');   // the address registered with the provider
    expect(q.get('state')).toMatch(/^app\./);
    expect(q.get('scope')).toBe('openid');                            // no email, no name
    const body = sent.pop();
    expect(body.provider).toBe(provider);
    expect(body.idToken).toBe(`token-from-test-${provider}-client`);
    expect(body.nonce).toBe(q.get('nonce'));
    await p.click('#rb-mp-back');
  }
  expect(p.errors).toEqual([]);
  await p.context().close();
});

test('rowbusters.com hands a sign-in started in the app back to the app', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses Chrome-only tools');
  const context = await browser.newContext();
  const p = await context.newPage();
  // The browser has no app for rowbusters:// addresses; Chrome's own tools show the page asking for one.
  const went = [];
  const cdp = await context.newCDPSession(p);
  await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', e => went.push(e.url));
  await p.goto(`${GAME_URL}#id_token=abc&state=app.123`, { waitUntil: 'commit' });
  await expect.poll(() => went.some(u => u.startsWith('rowbusters://signin#id_token=abc&state=app.123'))).toBe(true);
  // A sign-in of the website itself is not handed on.
  const q = await context.newPage();
  const qcdp = await context.newCDPSession(q);
  await qcdp.send('Page.enable');
  qcdp.on('Page.frameRequestedNavigation', e => went.push(e.url));
  await q.goto(`${GAME_URL}#id_token=abc&state=web123`);
  await expect.poll(() => q.url()).not.toContain('id_token');        // taken in by the page itself
  expect(went.filter(u => u.startsWith('rowbusters:'))).toHaveLength(1);
  await context.close();
});
