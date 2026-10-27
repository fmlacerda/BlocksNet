// The game in real browser pages: lobby, offline play, public rooms, stats, phones.
// Tests tagged @webkit also run in Safari's engine on CI.
const { test, expect, devices } = require('@playwright/test');
const { BASE, GAME_URL, openGame, joinPublicRoom, hostStart, knockOut, autoplay, gameOver, emptyRoom } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('lobby loads with the Rowbusters brand and no errors @webkit', async ({ browser }) => {
  const p = await openGame(browser, 'Ana');
  await expect(p.locator('#rb-lobby .rb-logo')).toBeVisible();
  await expect(p.locator('#rb-lobby .rb-word')).toHaveText('ROWBUSTERS');
  await expect(p.locator('.rb-version')).toContainText(await p.evaluate(() => RB.VERSION));
  await expect(p).toHaveTitle('Rowbusters');
  expect(p.errors).toEqual([]);
  await p.context().close();
});

test('offline game against bots runs and ends with the game-over screen @webkit', async ({ browser }) => {
  const p = await openGame(browser, 'Solo');
  await p.selectOption('#rb-bots', '2');
  await p.click('#rb-start');
  await p.waitForFunction(() => RB.current.room.running);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { for (const pl of RB.current.room.players) if (pl !== RB.current.me) pl.die(); });
  await expect(p.locator('#rb-end')).toBeVisible();
  await expect(p.locator('#rb-end-title')).toContainText('win');
  expect(p.errors).toEqual([]);
  await p.context().close();
});

test('saved data from the BlocksNet days carries over', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  await p.goto(`${BASE}/version.json`);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bn.pid', 'oldplayer'); localStorage.setItem('bn.settings', JSON.stringify({ name: 'Fernando', speed: 'fast' })); });
  await p.goto(GAME_URL);
  await expect(p.locator('#rb-name')).toHaveValue('Fernando');
  await expect(p.locator('#rb-speed')).toHaveValue('fast');
  expect(await p.evaluate(() => RB.net.playerId())).toBe('oldplayer');
  await context.close();
});

test('the GitHub Pages copy forwards players to rowbusters.com with their data', async ({ browser }) => {
  const context = await browser.newContext();
  // Pretend to be both addresses: both are served by the local Worker.
  const fwd = route => {
    const u = new URL(route.request().url());
    // Follow redirects here (e.g. /index.html → /): a browser-followed redirect would skip this route.
    return fetch(BASE + (u.pathname.replace(/^\/BlocksNet/, '') || '/') + u.search).then(async r => {
      const headers = Object.fromEntries(r.headers); delete headers['content-encoding'];
      await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
    });
  };
  await context.route('https://fmlacerda.github.io/**', fwd);
  await context.route('https://rowbusters.com/**', fwd);
  const p = await context.newPage();
  await p.goto('https://fmlacerda.github.io/BlocksNet/index.html?stay');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('rb.pid', 'ghplayer'); localStorage.setItem('rb.settings', JSON.stringify({ name: 'Gil' })); });
  await p.goto('https://fmlacerda.github.io/BlocksNet/?join=ABCDE');
  await p.waitForURL(/rowbusters\.com/, { timeout: 15000 });
  await p.waitForFunction(() => window.RB && RB.net);
  expect(await p.evaluate(() => RB.net.playerId())).toBe('ghplayer');
  expect(await p.evaluate(() => RB.net.serverURL())).toBe('https://rowbusters.com');
  expect(p.url()).not.toContain('carry=');                          // removed from the address bar
  await context.close();
});

test('public room: chat, host-only start, stats card, summary and Copy image (room 1)', async ({ browser }) => {
  const opts = { permissions: ['clipboard-read', 'clipboard-write'] };
  const host = await openGame(browser, 'Hal', opts);
  const guest = await openGame(browser, 'Gus', { ...devices['iPhone 13'] });
  await joinPublicRoom(host, 1);
  await joinPublicRoom(guest, 1);
  await expect(host.locator('#rb-on-start')).toBeVisible();
  await expect(guest.locator('#rb-on-start')).toBeHidden();
  await expect(host.locator('#rb-plist li', { hasText: 'Gus' }).locator('.rb-dev')).toHaveAttribute('title', 'Phone or tablet');

  await guest.fill('#rb-chat-in', 'ready!');
  await guest.press('#rb-chat-in', 'Enter');
  await expect(host.locator('#rb-chat')).toContainText('<Gus> ready!');

  for (let g = 1; g <= 2; g++) {
    await hostStart(host, 1, [guest]);
    await autoplay(host, guest);
    await host.waitForTimeout(3000);
    // A different winner each game, decided here: game 1 Hal (Gus and the bot go out), game 2 Gus.
    if (g === 1) { await knockOut(guest); await host.evaluate(() => { for (const p of RB.current.room.players) if (!p.remote && p.isBot) p.die(); }); }
    else await knockOut(host);
    await gameOver(host, guest);
    await expect(host.locator('#rb-chat .rb-stats'), `stats cards after game ${g}`).toHaveCount(g);
  }
  const card = host.locator('#rb-chat .rb-stats').last();
  await expect(card.locator('.rb-st-head')).toContainText('Game 2 stats');
  await expect(card.locator('tbody tr'), 'rows in the game 2 card').toHaveCount(3);

  await card.locator('.rb-st-sum').click();                         // the summary of both games
  await expect(host.locator('#rb-summary')).toBeVisible();
  await expect(host.locator('.rb-sum-top')).toContainText('Room 1');
  await expect(host.locator('.rb-sum-games tbody tr'), 'games in the summary').toHaveCount(2);
  await expect(host.locator('.rb-sum-cell'), 'players in the summary').toHaveCount(3);        // Hal, Gus and the bot

  await host.click('#rb-sum-copy');
  await expect(host.locator('#rb-sum-copy')).toHaveText('Image copied ✓');
  const img = await host.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('image/png');
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, w: bmp.width, h: bmp.height };
  });
  expect(img).toMatchObject({ type: 'image/png', w: 1080 });
  expect(img.h).toBeGreaterThan(1000);

  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
  await host.context().close(); await guest.context().close();
  await emptyRoom(1);
});

test('joining during a game: watch it, then play the next one (room 2)', async ({ browser }) => {
  const a = await openGame(browser, 'Ari'), b = await openGame(browser, 'Bel'), late = await openGame(browser, 'Lou');
  await joinPublicRoom(a, 2); await joinPublicRoom(b, 2);
  await hostStart(a, 0, [b]);
  await late.click('#rb-mp-open');
  await expect(late.locator('.rb-join[data-room="2"]')).toContainText('watch now');
  await late.click('.rb-join[data-room="2"]');
  await expect(late.locator('.watchbar')).toBeVisible();
  await late.waitForFunction(() => RB.current.watching && RB.current.room.running);
  await knockOut(b);
  await gameOver(a, late);
  await expect(late.locator('.watchbar')).toBeHidden();
  await hostStart(a, 0, [b, late]);                                  // now Lou plays
  expect(await late.evaluate(() => !!RB.current.room.players.find(p => p.isLocal && p.name === 'Lou'))).toBe(true);
  await knockOut(b, late);
  await gameOver(a);
  for (const p of [a, b, late]) { expect(p.errors).toEqual([]); await p.context().close(); }
  await emptyRoom(2);
});

test('knocked out during a connection blip: the game still ends (room 2)', async ({ browser }) => {
  const a = await openGame(browser, 'Ari'), b = await openGame(browser, 'Bel');
  await joinPublicRoom(a, 2); await joinPublicRoom(b, 2);
  await hostStart(a, 0, [b]);
  await b.evaluate(() => RB.current.session().ws.close(4001));     // connection drops…
  await knockOut(b);                                                // …just as Bel is out
  await gameOver(a, b);
  await expect(a.locator('#rb-chat')).toContainText('Ari wins!');
  for (const p of [a, b]) { expect(p.errors).toEqual([]); await p.context().close(); }
  await emptyRoom(2);
});

test('teams room: pick a team, partner marked in the game (room 3)', async ({ browser }) => {
  const a = await openGame(browser, 'Ivo'), b = await openGame(browser, 'Jon');
  await joinPublicRoom(a, 3); await joinPublicRoom(b, 3);
  await expect(a.locator('#rb-code-label')).toContainText('Pick team A or B');
  await expect(b.locator('#rb-teams button.on')).toHaveAttribute('data-team', 'B');
  await b.click('#rb-teams button[data-team="A"]');                  // join Ivo on team A
  await expect(a.locator('#rb-plist li', { hasText: 'Jon' }).locator('.rb-tm')).toHaveText('A');
  await hostStart(a, 1, [b]);                                        // the bot takes team B
  await expect(a.locator('.opp.mate')).toContainText('partner · Jon');
  await expect(a.locator('#log')).toContainText('You are team A with Jon');
  await a.evaluate(() => { for (const p of RB.current.room.players) if (!p.remote && p.isBot) p.die(); });
  await gameOver(a, b);
  await expect(a.locator('#rb-chat')).toContainText('Team A wins!');
  for (const p of [a, b]) { expect(p.errors).toEqual([]); await p.context().close(); }
  await emptyRoom(3);
});

test('room modes are shown, and a short connection drop does not end the game (rooms 5, 7)', async ({ browser }) => {
  const a = await openGame(browser, 'Kai');
  await a.click('#rb-mp-open');
  await expect(a.locator('.rb-rcard').nth(4).locator('.rb-rmode')).toContainText('SNS');
  await expect(a.locator('.rb-rcard').nth(5).locator('.rb-rmode')).toContainText('Fast');
  await expect(a.locator('.rb-rcard').nth(6).locator('.rb-rmode')).toContainText('Pure');
  await a.click('.rb-join[data-room="7"]');
  await expect(a.locator('#rb-code-label')).toContainText('No specials');
  await hostStart(a, 1);
  await a.evaluate(() => RB.current.session().ws.close(4001));     // network blip
  await a.waitForTimeout(2500);
  expect(await a.evaluate(() => RB.current.room.running)).toBe(true);
  await expect(a.locator('#log')).toContainText('keep playing');
  await knockOut(a);
  await gameOver(a);
  expect(a.errors).toEqual([]);
  await a.context().close();
  await emptyRoom(7);
});

test('phones: tapping an opponent fires a special, even right after a button press @webkit', async ({ browser }) => {
  const p = await openGame(browser, 'Tap', { ...devices['iPhone 13'] });
  await p.tap('#rb-start');
  await p.waitForFunction(() => RB.current.room.running);
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => { RB.current.me.inv = ['c', 'c']; });
    await p.tap('#bDrop');
    const before = await p.evaluate(() => RB.current.me.inv.length);
    await p.tap('.opp >> nth=0');
    expect(await p.evaluate(() => RB.current.me.inv.length), `try ${i + 1}`).toBe(before - 1);
  }
  await expect(p.locator('.opp').first()).toHaveClass(/fired/);
  expect(p.errors).toEqual([]);
  await p.context().close();
});
