// The iPhone app's copy of the game (tools/build-www.js → www/), opened in a browser with a
// stand-in for the app's native side (Capacitor). Checks what differs inside the app: Apple's own
// sign-in sheet (and only Apple), the iPhone's haptics, no "Add to Home Screen" tip, links opening in place.
const { test, expect, devices } = require('@playwright/test');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BASE, emptyRoom } = require('./helpers');

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
      ],
      nativePromise(plugin, method, options) {
        window.nativeCalls.push({ plugin, method, options });
        return plugin === 'SignInWithApple' ? Promise.reject(new Error('The operation couldn’t be completed. (1001)')) : Promise.resolve({});
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

test('the app copy: Apple sign-in sheet only, haptics, no Home Screen tip @webkit', async ({ browser }) => {
  expect(fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')).toContain('<script src="js/vendor/capacitor.js">');
  expect(fs.existsSync(path.join(WWW, 'server')) || fs.existsSync(path.join(WWW, 'tests')) || fs.existsSync(path.join(WWW, 'ios'))).toBe(false);
  const p = await openApp(browser);
  expect(await p.evaluate(() => Capacitor.isNativePlatform())).toBe(true);
  await expect(p.locator('.rb-fs-hint')).toHaveCount(0);            // the app is already full screen

  await p.fill('#rb-name', 'Ida');
  await p.click('#rb-mp-open');
  await expect(p.locator('.rb-sso')).toHaveCount(1);                 // Apple only, in the app
  await p.click('.rb-sso-apple');
  await expect(p.locator('#rb-mp-msg')).toContainText('Sign-in was cancelled');   // the sheet was closed
  const asked = await p.evaluate(() => window.nativeCalls.find(c => c.plugin === 'SignInWithApple'));
  expect(asked.method).toBe('authorize');
  expect(asked.options.nonce).toMatch(/^[0-9a-f]{32}$/);
  expect(asked.options.scopes).toBeUndefined();                      // no name, no email
  await p.click('#rb-mp-back');

  await p.click('#rb-start');                                        // a game: tapping an opponent buzzes
  await p.waitForFunction(() => RB.current.room.running);
  await p.evaluate(() => { RB.current.me.inv = ['c']; });
  await p.tap('.opp >> nth=0');
  await expect.poll(() => p.evaluate(() => window.nativeCalls.some(c => c.plugin === 'Haptics' && c.method === 'impact'))).toBe(true);
  expect(p.errors).toEqual([]);
  await p.context().close();
});
