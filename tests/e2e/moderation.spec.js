// Keeping online play friendly: chat filter, nickname filter, reports (mute and rename after
// several), blocking, the one-time online rules, Play now, and the privacy and terms pages.
const { test, expect } = require('@playwright/test');
const { BASE, GAME_URL, client, emptyRoom, openGame } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('chat is filtered; offensive nicknames are replaced (room 6)', async () => {
  const a = await client(6, 'Kit'), b = await client(6, 'Sh1tHead');
  expect(b.last('welcome').name).toMatch(/^Player\d*$/);
  a.send({ t: 'chat', text: 'you are a $h1t player, gg' });
  expect((await b.waitFor('chat', m => !m.system)).text).toBe('you are a **** player, gg');
  a.close(); b.close();
  await emptyRoom(6);
});

test('several players reporting someone: muted and renamed; repeat reports do not count twice (room 4)', async () => {
  const rude = await client(4, 'Rudy', { pid: 'rudeplayer001' });
  const [b, c, d] = await Promise.all(['Bea', 'Cal', 'Dov'].map((n, i) => client(4, n, { pid: `reporter0000${i}` })));
  b.send({ t: 'report', name: 'Rudy', reason: 'name' });
  b.send({ t: 'report', name: 'Rudy', reason: 'name' });               // same reporter again: ignored
  c.send({ t: 'report', name: 'Rudy', reason: 'name' });
  await c.waitFor('chat', m => m.code === 'reported');
  rude.send({ t: 'chat', text: 'still here' });
  expect((await d.waitFor('chat', m => !m.system)).text).toBe('still here');   // two reporters: nothing yet
  d.send({ t: 'report', name: 'Rudy', reason: 'name' });
  expect((await rude.waitFor('rename')).name).toMatch(/^Player\d*$/);        // three: nickname replaced…
  rude.send({ t: 'chat', text: 'can you hear me' });
  expect(await rude.waitFor('chat', m => m.code === 'muted')).toBeTruthy();  // …and chat paused
  await new Promise(r => setTimeout(r, 300));
  expect(b.all('chat').some(m => m.text === 'can you hear me')).toBe(false);
  for (const x of [rude, b, c, d]) x.close();
  await emptyRoom(4);
});

test('blocking hides a player’s chat on this device; report buttons only in public rooms (room 2)', async ({ browser }) => {
  const p = await openGame(browser, 'Una');
  await p.click('#rb-tab-online'); await p.click('#rb-mp-open');
  await p.click('.rb-join[data-room="2"]');
  const mo = await client(2, 'Moe'), zed = await client(2, 'Zed');
  await p.locator('#rb-plist li[data-name="Moe"]').click();
  await expect(p.locator('#rb-psheet')).toBeVisible();
  await expect(p.locator('#rb-psheet [data-report="chat"]')).toBeVisible();
  await p.click('#rb-ps-block');
  await expect(p.locator('#rb-chat')).toContainText('Moe is blocked');
  await expect(p.locator('#rb-plist li[data-name="Moe"]')).toHaveClass(/blocked/);
  mo.send({ t: 'chat', text: 'hello from Moe' });
  zed.send({ t: 'chat', text: 'hello from Zed' });                    // sent after Moe's: arrives after it
  await expect(p.locator('#rb-chat')).toContainText('<Zed> hello from Zed');
  await expect(p.locator('#rb-chat')).not.toContainText('hello from Moe');
  expect(p.errors).toEqual([]);
  mo.close(); zed.close();
  await p.context().close();
  await emptyRoom(2);
});

test('Play now: online rules first, then a room; alone, the game starts with bots (room 1)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const p = await context.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.clock.install();
  await p.goto(GAME_URL);
  await p.fill('#rb-name', 'Quin');
  await p.evaluate(() => { const f = document.getElementById('rb-fs'); if (f) f.checked = false; });
  await p.click('#rb-tab-online'); await p.click('#rb-quick');
  await expect(p.locator('#rb-terms')).toBeVisible();                 // first time: the rules
  await p.click('#rb-terms-no');
  await expect(p.locator('#rb-terms')).toBeHidden();
  await expect(p.locator('#rb-lobby')).toBeVisible();                 // "Not now": still in the lobby
  await p.click('#rb-tab-online'); await p.click('#rb-quick');
  await p.click('#rb-terms-ok');
  await expect(p.locator('#rb-code-show')).toHaveText('Room 1');
  await expect(p.locator('#rb-on-status')).toContainText('Starting with bots');
  await p.clock.runFor(16000);                                        // run the countdown in no time…
  await p.clock.resume();                                             // …then let time run again
  await p.waitForFunction(() => RB.current.room.running && RB.current.room.players.filter(x => x.isBot).length === 3);
  await p.evaluate(() => { for (const x of RB.current.room.players) if (!x.remote && x.alive) x.die(); });   // end it
  await p.waitForFunction(() => !RB.current.room.running);
  expect(await p.evaluate(() => localStorage.getItem('rb.terms'))).toBeTruthy();   // asked only once
  expect(p.errors).toEqual([]);
  await context.close();
  await emptyRoom(1);
});

test('privacy and terms pages: every language, the contact address, the player’s language', async ({ browser }) => {
  for (const page of ['privacy', 'terms']) {
    const html = await (await fetch(`${BASE}/${page}.html`)).text();
    for (const l of ['en', 'es', 'pt', 'fr', 'de']) expect(html, `${page} ${l}`).toContain(`<article lang="${l}"`);
    expect(html).toContain('data-contact="support@rowbusters.com"');
  }
  const p = await (await browser.newContext({ locale: 'fr-FR' })).newPage();
  await p.goto(`${BASE}/terms.html`);
  await expect(p.locator('article:visible h1')).toHaveText('Conditions d’utilisation');
  await expect(p.locator('article:visible .contact')).toHaveAttribute('href', 'mailto:support@rowbusters.com');
  await p.context().close();
});
