// Languages in real pages: every screen fits a small phone (320 px wide) in every language,
// the picker switches language, and server messages arrive in the player's own language.
const { test, expect } = require('@playwright/test');
const { GAME_URL, client, emptyRoom, muteSound } = require('./helpers');

test.describe.configure({ mode: 'serial' });
const LANGS = ['en', 'es', 'pt', 'fr', 'de'];

async function openIn(browser, lang, viewport = { width: 320, height: 568 }) {
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  await muteSound(context);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${GAME_URL}&lang=${lang}`);
  await page.fill('#rb-name', 'Wil');
  await page.evaluate(() => { const f = document.getElementById('rb-fs'); if (f) f.checked = false; });
  return page;
}

// Visible texts that stick out of their box or off the screen.
const misfits = page => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page is ${document.documentElement.scrollWidth}px wide`);
  const sel = 'button, label, select, .rb-sub, .rb-h2, .rb-tagline, .rb-rmode, .rb-rcard .head, .rb-mp-me, .bar .stats, .rb-st-head, .rb-code-box small';
  for (const el of document.querySelectorAll(sel)) {
    if ((!el.offsetParent && getComputedStyle(el).position !== 'fixed') || el.closest('.party:not(.open)')) continue;   // hidden, or the closed chat drawer
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${el.textContent.trim().slice(0, 40)}"`;
    if (r.right > innerWidth + 1 || r.left < -1) bad.push(`${name} off screen`);
    else if (el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'SELECT') bad.push(`${name} overflows (${el.scrollWidth} > ${el.clientWidth})`);
  }
  return bad;
});

for (const lang of LANGS) {
  test(`${lang}: every screen fits a 320 px phone @webkit`, async ({ browser }) => {
    const p = await openIn(browser, lang);
    const t = (k, params) => p.evaluate(([k, params]) => RB.t(k, params), [k, params]);
    expect(await p.evaluate(() => [RB.lang, document.documentElement.lang])).toEqual([lang, lang]);
    await expect(p.locator('#rb-start')).toHaveText(await t('lobby.play'));
    expect(await misfits(p), 'lobby').toEqual([]);
    await p.click('#rb-more summary');                                // the extra game settings
    expect(await misfits(p), 'more settings').toEqual([]);
    await p.click('#rb-settings-open');                               // the settings sheet
    expect(await misfits(p), 'settings').toEqual([]);
    await p.click('#rb-settings-close');
    await p.click('#rb-practice-open');                               // practice: the lessons and a lesson
    expect(await misfits(p), 'lessons').toEqual([]);
    await p.click('[data-lesson="2"]');
    await expect(p.locator('#rb-coach')).toBeVisible();
    expect(await misfits(p), 'practice').toEqual([]);
    await p.click('#rb-coach-exit');
    await p.click('#rb-practice-back');
    await p.click('#rb-tab-online');
    expect(await misfits(p), 'online tab').toEqual([]);

    await p.click('#rb-tab-online'); await p.click('#rb-mp-open');                                     // public rooms + ranking
    await expect(p.locator('.rb-rcard')).toHaveCount(7);
    await expect(p.locator('.rb-rcard .name').first()).toHaveText(await t('room.name', { n: 1 }));
    expect(await misfits(p), 'public rooms').toEqual([]);
    await p.click('#rb-mp-back');

    await p.click('#rb-tab-online'); await p.click('#rb-host');                                        // first time online: the rules
    await expect(p.locator('#rb-terms')).toBeVisible();
    expect(await misfits(p), 'online rules').toEqual([]);
    await p.click('#rb-terms-ok');                                    // then the private room screen
    await expect(p.locator('#rb-on-room')).toBeVisible();
    expect(await misfits(p), 'room screen').toEqual([]);
    await p.click('#rb-leave');

    await p.click('#rb-tab-solo'); await p.selectOption('#rb-bots', '3');                            // the game, then game over
    await p.click('#rb-tab-solo'); await p.click('#rb-start');
    await p.waitForFunction(() => RB.current.room.running);
    await p.evaluate(() => RB.current.room.players[1].die());
    await expect(p.locator('#log')).toContainText(await t('log.out', { name: await p.evaluate(() => RB.current.room.players[1].name) }));
    expect(await misfits(p), 'game screen').toEqual([]);
    // Record who shows or hides the game-over screen, so a failure here names its cause.
    await p.evaluate(() => {
      const end = document.getElementById('rb-end'), list = end.classList, log = window.endLog = [];
      for (const m of ['add', 'remove', 'toggle']) {
        const orig = DOMTokenList.prototype[m];
        list[m] = function (...a) { log.push(`${Math.round(performance.now())} ${m}(${a.join(',')}) ${(new Error().stack || '').split('\n').slice(1, 4).join(' | ')}`); return orig.apply(this, a); };
      }
    });
    await p.evaluate(() => { for (const pl of RB.current.room.players) if (pl !== RB.current.me) pl.die(); });
    expect(await p.evaluate(() => RB.current.room.running), 'game ended').toBe(false);
    try { await expect(p.locator('#rb-end')).toBeVisible(); } catch (e) {
      const state = await p.evaluate(() => ({ endLog: window.endLog, running: RB.current.room.running, winner: RB.current.room.winner && RB.current.room.winner.name,
        session: !!RB.current.session(), nav: performance.getEntriesByType('navigation').map(n => n.type), now: Math.round(performance.now()),
        visible: [...document.querySelectorAll('.rb-overlay')].filter(o => !o.classList.contains('hidden')).map(o => o.id) }));
      throw new Error(`game-over screen not shown. Page errors: ${JSON.stringify(p.errors)}. State: ${JSON.stringify(state)}`);
    }
    expect(p.errors, 'no errors while ending the game').toEqual([]);
    await expect(p.locator('#rb-again')).toHaveText(await t('end.again'));
    expect(await misfits(p), 'game over').toEqual([]);
    expect(p.errors).toEqual([]);
    await p.context().close();
  });
}

test('the picker switches language and remembers it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const p = await context.newPage();
  await p.goto(GAME_URL);
  await expect(p.locator('#rb-start')).toHaveText('Gegen Bots spielen');  // the phone's language
  await p.click('#rb-settings-open');
  await p.selectOption('#rb-lang', 'pt');
  await expect(p.locator('#rb-start')).toHaveText('Jogar contra bots');
  await p.reload();
  await expect(p.locator('#rb-start')).toHaveText('Jogar contra bots');
  await expect(p.locator('#lines').locator('xpath=..')).toContainText('LINHAS');
  await context.close();
});

test('server messages arrive in the player’s language; old apps get English (room 6)', async ({ browser }) => {
  const z = await client(6, 'Zed');                                  // an app that knows no codes
  const p = await openIn(browser, 'es', { width: 393, height: 852 });
  await p.click('#rb-tab-online'); await p.click('#rb-mp-open');
  await p.click('.rb-join[data-room="6"]');
  await p.click('#rb-terms-ok');                                      // first time online: the rules
  await expect(p.locator('#rb-code-show')).toHaveText('Sala 6');
  await expect(p.locator('#rb-code-label')).toHaveText('Rápida · 30 % más rápida');
  await expect(p.locator('#rb-chat')).toContainText('Bienvenido a la Sala 6');
  const old = await z.waitFor('chat', m => m.system && /Wil/.test(m.text));
  expect(old.text).toBe('Wil joined the room');
  z.close();
  await expect(p.locator('#rb-chat')).toContainText('Zed salió de la sala');
  expect(p.errors).toEqual([]);
  await p.context().close();
  await emptyRoom(6);
});
