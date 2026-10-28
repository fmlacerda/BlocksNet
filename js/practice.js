/*
 * Practice: short offline lessons that teach the controls and what each special does.
 * Each lesson sets up the fields itself; "Dummy", the training partner, has no falling piece
 * so the player can watch what happens to it. A coach strip above the fields gives one
 * instruction at a time and explains the result. Finished lessons are remembered on the device.
 */
(function (RB) {
  'use strict';
  const t = (k, p) => RB.t(k, p);
  const { W, H } = RB;
  const $ = id => document.getElementById(id);

  // A field from rows listed bottom-up: '.' empty, 1-5 a colour, a letter a special.
  function field(rows) {
    const f = Array.from({ length: H }, () => new Array(W).fill(0));
    rows.forEach((r, i) => [...r].forEach((c, x) => { f[H - 1 - i][x] = c === '.' ? 0 : (c >= '1' && c <= '5' ? +c : c); }));
    return f;
  }
  const MESSY = ['3412.1234123', '12.412341234', '4123412.4123', '23.1234123.4', '341234.23412', '1.3412341234',
    '23412.412341', '412341234.23', '1234.1234.12', '3412341.3412', '.23412341234', '12341.341234'];
  // Specials that help are used on yourself (button 1); the others on Dummy (button 2).
  const SELF = { c: true, g: true, n: true };
  const SPECIAL_FIELDS = {
    c: { me: ['1234.1234123', '2.3412341234', '5c3412.41234'] },
    // Every column has two blocks with a gap between them: gravity makes two full lines.
    g: { me: ['1.2.3.4.5.11', '.1.2.3.4.5.1', '12345123451.'] },
    n: { me: MESSY },
    a: { dummy: ['3412.1234123', '12.4123.1234'] },
    r: { dummy: ['3412.1234123', '1234123.4123', '2.3412341234', '41234123.412', '123412.41234', '3.1234123412', '2341234.2341', '41234.234123'] },
    q: { dummy: ['3412341.3412', '4123412.4123', '1234123.4123', '2341234.2341', '3412341.3412', '4123412.4123'] },
    o: { dummy: ['3412341234.1', '412o4123.123', '1234123412.4', '23412341.341', '3412o41.3412', '4123.1234123', '12341.341234'] },
    b: { dummy: ['3412.123a123', '1c341234.234', '2341.341g341', '41n341234.41', '1234123.r123'] },
    s: { me: MESSY.concat(['1234.1234.12', '3412341.3412']), dummy: ['3412.1234123'] },
  };

  const LESSONS = [
    { id: 'move', icon: '&#10515;', pieces: true, setup: L => { L.me.field = field(['55443322....']); L.give('I'); },
      steps: [{ text: () => t('practice.move.do'), done: e => e.type === 'clear' }], after: () => t('practice.move.after') },
    { id: 'collect', icon: 'c', pieces: true, setup: L => { L.me.field = field(['5c443322....']); L.give('I'); },
      steps: [{ text: () => t('practice.collect.do'), done: e => e.type === 'clear' && e.collected > 0 }], after: () => t('practice.collect.after') },
    { id: 'use', icon: '2', setup: L => { L.me.field = field(['1234.1234123', '2.3412341234']); L.dummy.field = field(['3412.1234123']); L.me.inv = ['a', 'c', 'b']; },
      steps: [
        { text: () => t('practice.use.them'), done: (e, L) => e.type === 'special' && e.target === L.dummy },
        { text: () => t('practice.use.self'), done: (e, L) => e.type === 'special' && e.target === L.me },
        { text: () => t('practice.use.discard'), done: e => e.type === 'discard' },
      ], after: () => t('practice.use.after') },
    ...['c', 'g', 'n', 'a', 'r', 'q', 'o', 'b', 's'].map(s => ({
      id: s, icon: s, special: s,
      setup: L => {
        const f = SPECIAL_FIELDS[s];
        if (f.me) L.me.field = field(f.me);
        if (f.dummy) L.dummy.field = field(f.dummy);
        L.me.inv = [s];
      },
      steps: [{
        text: () => `<b>${t('special.' + s)}</b>: ${t('practice.what.' + s)}<br>${t(SELF[s] ? 'practice.sp.self' : 'practice.sp.them', { special: t('special.' + s) })}`,
        done: (e, L) => e.type === 'special' && e.special === s && e.target === (SELF[s] ? L.me : L.dummy),
      }],
      after: () => t('practice.after.' + s),
    })),
    { id: 'final', icon: '&#127942;', final: true,
      steps: [{ text: () => t('practice.final.do'), done: e => e.type === 'end' }],
      after: e => t(e.youWon ? 'practice.final.win' : 'practice.final.lose') },
  ];
  const title = l => (l.special ? t('special.' + l.special) : t('practice.l.' + l.id));

  RB.Practice = function (app) {
    const room = app.room;
    const store = RB.store;
    const done = () => new Set(store.get('practice', []));
    let L = null;   // the running lesson: { lesson, index, step, me, dummy, over }

    function coach(html, { next = false } = {}) {
      $('rb-coach-text').innerHTML = html;
      $('rb-coach-next').classList.toggle('hidden', !next);
      $('rb-coach-next').textContent = t(L && L.index === LESSONS.length - 1 ? 'practice.finish' : 'practice.next');
    }
    function showCoach(on) {
      $('rb-coach').classList.toggle('hidden', !on);
      document.body.classList.toggle('practicing', on);
      dispatchEvent(new Event('resize'));   // the fields get the room that is left
    }

    function progress() {
      const n = LESSONS.filter(l => done().has(l.id)).length;
      $('rb-practice-progress').textContent = n ? t('practice.progress', { n, total: LESSONS.length }) : t('practice.new');
    }
    function renderList() {
      const d = done();
      $('rb-lessons').innerHTML = LESSONS.map((l, i) => {
        const color = l.special ? RB.SPECIAL_INFO[l.special].color : 'var(--accent)';
        return `<li><button type="button" data-lesson="${i}"><i style="color:${color};border-color:${color}">${l.icon}</i>` +
          `<span>${title(l)}${l.special ? `<small>${t('practice.what.' + l.special)}</small>` : ''}</span>${d.has(l.id) ? '<em>&#10003;</em>' : ''}</button></li>`;
      }).join('');
    }
    function openList() {
      renderList();
      ['rb-lobby', 'rb-end'].forEach(id => $(id).classList.add('hidden'));
      $('rb-practice').classList.remove('hidden');
    }

    function begin(index, note) {
      const lesson = LESSONS[index];
      L = { lesson, index, step: 0, over: false };
      app.practice = lesson;
      app.startPractice((r, name) => {
        L.me = r.addPlayer(name, { local: true });
        if (lesson.final) r.addPlayer(t('practice.coachBot'), { bot: true, skill: 0.15 });
        else L.dummy = r.addPlayer(t('practice.dummy'));
        return L.me;
      }, { speed: 'relaxed', linesPerLevel: 99 });
      // The room has started (which resets fields): now lay out this lesson.
      if (L.dummy) L.dummy.piece = null;
      if (!lesson.pieces && !lesson.final) L.me.piece = null;
      L.give = type => { L.me.piece = null; L.me.next = type; L.me.spawn(); };
      if (lesson.setup) lesson.setup(L);
      showCoach(true);
      coach((note ? note + '<br>' : '') + lesson.steps[0].text());
    }

    function stop() {
      L = null;
      app.practice = null;
      room.running = false;
      showCoach(false);
      openList();
      progress();
    }

    function event(e) {
      if (!L || L.over) return;
      const step = L.lesson.steps[L.step];
      if (step.done(e, L)) {
        L.step++;
        if (L.step < L.lesson.steps.length) { coach(L.lesson.steps[L.step].text()); return; }
        L.over = true;
        // Nothing falls while the result is explained (after the piece that just landed respawns).
        const me = L.me;
        setTimeout(() => { if (L && L.me === me && L.over && !L.lesson.final) me.piece = null; }, 0);
        store.set('practice', [...done().add(L.lesson.id)]);
        coach(L.lesson.after(e), { next: true });
        return;
      }
      // A special on the wrong field, or thrown away: set the lesson up again.
      if (L.lesson.special && (e.type === 'special' || e.type === 'discard')) {
        L.lesson.setup(L);
        coach(`${t('practice.wrong')}<br>${step.text()}`);
      } else if (L.lesson.id === 'use' && (e.type === 'special' || e.type === 'discard')) {
        L.lesson.setup(L);
        L.step = 0;
        coach(`${t('practice.wrong')}<br>${L.lesson.steps[0].text()}`);
      }
    }

    room.on('clear', e => { if (L && e.player === L.me) event({ type: 'clear', collected: e.collected }); });
    room.on('special', e => { if (L && e.from === L.me) event({ type: 'special', special: e.special, target: e.target }); });
    room.on('end', winner => {
      if (!L || L.over) return;
      if (L.lesson.final) event({ type: 'end', youWon: winner === L.me });
      else setTimeout(() => { if (L && !L.over) begin(L.index, t('practice.retry')); }, 900);   // topped out: start over
    });
    const discard = app.act.discard;
    app.act.discard = () => {
      const n = app.me ? app.me.inv.length : 0;
      discard();
      if (L && app.me && app.me.inv.length < n) event({ type: 'discard' });
    };

    $('rb-practice-open').addEventListener('click', openList);
    $('rb-practice-back').addEventListener('click', () => { $('rb-practice').classList.add('hidden'); $('rb-lobby').classList.remove('hidden'); });
    $('rb-lessons').addEventListener('click', e => {
      const b = e.target.closest('[data-lesson]');
      if (b) begin(+b.dataset.lesson);
    });
    $('rb-coach-exit').addEventListener('click', stop);
    $('rb-coach-next').addEventListener('click', () => {
      if (L && L.index + 1 < LESSONS.length) begin(L.index + 1); else stop();
    });
    progress();
    return { LESSONS, begin, stop, current: () => L };
  };
})(window.RB);
