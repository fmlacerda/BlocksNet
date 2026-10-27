// Languages (js/i18n.js + js/i18n/*.js): every language has every text, with the same
// placeholders and markup, and every key the code asks for exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
global.window = global;
require('../../js/i18n.js');
const RB = global.RB;
for (const l of Object.keys(RB.LANGS)) require(`../../js/i18n/${l}.js`);
const EN = RB.STRINGS.en;

const forms = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? [] : Object.values(v));
const holes = v => [...new Set(forms(v).flatMap(s => s.match(/\{\w+\}/g) || []))].sort();
const tags = v => [...new Set(forms(v).flatMap(s => s.match(/<\/?\w+/g) || []))].sort();

test('every language has exactly the English keys, of the same kind', () => {
  for (const [lang, S] of Object.entries(RB.STRINGS)) {
    assert.deepEqual(Object.keys(S).sort(), Object.keys(EN).sort(), `${lang}: keys differ from English`);
    for (const k of Object.keys(EN)) {
      const kind = v => (Array.isArray(v) ? 'list' : typeof v);
      assert.equal(kind(S[k]), kind(EN[k]), `${lang} ${k}: kind`);
      if (kind(S[k]) === 'object') assert.ok(S[k].other, `${lang} ${k}: plural needs an "other" form`);
      if (kind(S[k]) === 'string') assert.ok(S[k].trim(), `${lang} ${k}: empty`);
    }
  }
});

test('translations keep the placeholders and markup of the English text', () => {
  for (const [lang, S] of Object.entries(RB.STRINGS)) {
    for (const k of Object.keys(EN)) {
      assert.deepEqual(holes(S[k]), holes(EN[k]), `${lang} ${k}: placeholders`);
      assert.deepEqual(tags(S[k]), tags(EN[k]), `${lang} ${k}: markup`);
    }
  }
});

test('no banned names in any language', () => {
  for (const [lang, S] of Object.entries(RB.STRINGS)) {
    assert.doesNotMatch(JSON.stringify(S), /tetris|tetrinet/i, lang);
  }
});

test('lookup: placeholders, plurals per language, English fallback', () => {
  const was = RB.lang;
  try {
    RB.lang = 'en';
    assert.equal(RB.t('room.name', { n: 3 }), 'Room 3');
    assert.equal(RB.t('lobby.lines', { n: 1 }), '1 line');
    assert.equal(RB.t('lobby.lines', { n: 5 }), '5 lines');
    RB.lang = 'fr';
    assert.equal(RB.t('mp.games', { n: 0 }), '0 partie', 'French counts 0 as singular');
    RB.lang = 'de';
    assert.equal(RB.t('room.name', { n: 2 }), 'Raum 2');
    RB.STRINGS.en.__only = 'English only';
    assert.equal(RB.t('__only'), 'English only', 'missing text falls back to English');
    assert.equal(RB.t('no.such.key'), 'no.such.key');
    assert.ok(Array.isArray(RB.t('bot.chat')));
  } finally {
    RB.lang = was;
    delete RB.STRINGS.en.__only;
  }
});

test('every text the code asks for exists in English', () => {
  const files = ['js/app.js', 'js/engine.js', 'js/net.js', 'js/statsimage.js', 'index.html'];
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\b(?:RB\.)?tr?\(\s*'([a-z][\w.]*)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-aria|-ph)?="([\w.]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 100, `found ${used.size} keys`);
  const missing = [...used].filter(k => !k.endsWith('.') && !(k in EN));   // 'mode.' + name: checked below
  assert.deepEqual(missing, []);
  // Keys built from names: room modes, speeds, skills and specials.
  require('../../js/engine.js');
  for (const [m, md] of Object.entries(RB.MODES)) for (const k of md.desc ? [m, `${m}.desc`, `${m}.short`] : [m]) assert.ok(`mode.${k}` in EN, k);
  for (const k of Object.keys(RB.SPEEDS)) assert.ok(`speed.${k}` in EN, k);
  for (const k of ['easy', 'normal', 'hard']) assert.ok(`skill.${k}` in EN, k);
  for (const k of Object.keys(RB.SPECIAL_INFO)) assert.ok(`special.${k}` in EN, k);
});

test('every message code the server (or a private room’s host) sends has a text', () => {
  const src = ['server/worker.js', 'js/net.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const codes = new Set();
  for (const m of src.matchAll(/code: '(\w+)'/g)) codes.add(m[1]);
  for (const m of src.matchAll(/this\.system\([^;]*, '(\w+)'/g)) codes.add(m[1]);
  for (const m of src.matchAll(/'(resumed|back|watching|joined)'/g)) codes.add(m[1]);
  assert.ok(codes.size >= 16, `found ${[...codes]}`);
  for (const c of codes) assert.ok(`srv.${c}` in EN, `srv.${c}`);
});
