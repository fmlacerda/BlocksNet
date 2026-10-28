// Game rules (js/engine.js), run in Node without a browser: node --test tests/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global;
require('../../js/engine.js');
const RB = global.RB;

const filledRows = p => p.field.filter(r => r.some(v => v)).length;
function room(names, opts = {}) {
  const r = new RB.Room();
  Object.assign(r.settings, opts.settings || {});
  names.forEach((n, i) => r.addPlayer(n, { local: true, team: (opts.teams || [])[i] || '' }));
  r.start();
  r.players.forEach(p => { p.field = p.field.map(row => row.map(() => 0)); p.piece = null; });
  return r;
}

test('field encoding survives a round trip', () => {
  const r = room(['A']);
  const p = r.players[0];
  p.field[21][0] = 3; p.field[20][5] = 'n'; p.field[0][11] = 1;
  assert.deepEqual(RB.decodeField(RB.encodeField(p.field)), p.field);
  assert.equal(RB.decodeField('garbage').flat().filter(Boolean).length, 0, 'bad input gives an empty field');
});

test('clearing 2, 3 or 4 lines sends 1, 2 or 4 lines to every opponent; 1 sends nothing', () => {
  for (const [cleared, sent] of [[1, 0], [2, 1], [3, 2], [4, 4]]) {
    const r = room(['A', 'B', 'C']);
    r.onLinesCleared(r.players[0], cleared);
    assert.equal(filledRows(r.players[0]), 0, 'the sender gets nothing');
    for (const o of r.players.slice(1)) assert.equal(filledRows(o), sent, `cleared ${cleared}`);
  }
});

test('in team games lines only hit the other team', () => {
  const r = room(['A1', 'A2', 'B1', 'B2'], { teams: ['A', 'A', 'B', 'B'] });
  r.onLinesCleared(r.players[0], 4);
  assert.equal(filledRows(r.players[1]), 0, 'partner untouched');
  assert.equal(filledRows(r.players[2]), 4);
  assert.equal(filledRows(r.players[3]), 4);
});

test('SNS rooms deal only sticks and squares', () => {
  const r = room(['A'], { settings: { mode: 'sns' } });
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(r.randomType());
  assert.deepEqual([...seen].sort(), ['I', 'O']);
  const n = room(['A']);
  const all = new Set();
  for (let i = 0; i < 2000; i++) all.add(n.randomType());
  assert.equal(all.size, 7, 'normal rooms deal all 7 pieces');
});

test('Fast rooms drop pieces 30% faster', () => {
  const normal = room(['A']).players[0].dropInterval;
  const fast = room(['A'], { settings: { mode: 'fast' } }).players[0].dropInterval;
  assert.equal(Math.round(fast), Math.round(normal / 1.3));
});

test('Pure rooms never put specials on the field; normal rooms do', () => {
  const count = mode => {
    const r = room(['A'], { settings: { mode } });
    const p = r.players[0];
    p.field[21] = p.field[21].map(() => 1);             // a full line to clear
    p.field[20] = p.field[20].map((_, x) => (x < 6 ? 2 : 0));
    p.clearLines();
    return p.field.flat().filter(v => RB.isSpecial(v)).length;
  };
  assert.equal(count('pure'), 0);
  assert.equal(count('normal'), 1);
});

test('using a special needs one in stock and acts on the target', () => {
  const r = room(['A', 'B']);
  const [a, b] = r.players;
  b.field[21] = b.field[21].map(() => 2);
  assert.equal(r.useSpecial(a, b.slot), false, 'nothing to use');
  a.inv = ['n'];
  assert.equal(r.useSpecial(a, b.slot), true);
  assert.equal(filledRows(b), 0, 'nuke clears the field');
  assert.equal(a.inv.length, 0);
});

test('bot-only games always finish with a winner and never throw', () => {
  for (let g = 0; g < 8; g++) {
    const r = new RB.Room();
    for (let i = 0; i < 4; i++) r.addPlayer('Bot' + i, { bot: true, skill: Math.random() });
    r.start();
    let t = 0;
    while (r.running && t < 30 * 60 * 1000) { r.update(50); t += 50; }
    assert.equal(r.running, false, `game ${g} ended`);
    assert.ok(r.winner, `game ${g} has a winner`);
  }
});

test('version numbers are in sync (engine, version.json, server, index.html cache tags)', () => {
  const root = path.join(__dirname, '../..');
  const v = RB.VERSION;
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version, v);
  assert.match(fs.readFileSync(path.join(root, 'server/worker.js'), 'utf8'), new RegExp(`SERVER_VERSION = '${v.replace(/\./g, '\\.')}'`));
  const tag = v.replace(/\./g, '');
  const tags = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/\?v=(\w+)/g)].map(m => m[1]);
  assert.ok(tags.length >= 8, 'index.html has cache tags');
  for (const t of tags) assert.equal(t, tag, 'every ?v= tag matches the version');
});

test('one failing listener does not stop the others (the game-over screen still shows)', async () => {
  const r = new RB.Room();
  const ran = [];
  r.on('end', () => { throw new Error('a broken listener'); });
  r.on('end', () => ran.push('game over screen'));
  // The error is rethrown on its own (to reach the crash reports): catch that here.
  const later = [], timer = global.setTimeout;
  global.setTimeout = fn => later.push(fn);
  try { r.emit('end', null); } finally { global.setTimeout = timer; }
  assert.deepEqual(ran, ['game over screen']);
  assert.throws(later[0], /a broken listener/, 'the error is still reported');
});
