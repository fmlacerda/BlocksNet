// js/config.js decides which server a copy of the game talks to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../js/config.js'), 'utf8');
const serverFor = href => {
  const location = new URL(href);
  const window = {};
  vm.runInNewContext(src, { window, location });
  return window.RB_CONFIG.server;
};
const LIVE = 'https://blocksnet.fmlacerda.workers.dev';

test('copies served by a Worker talk to that same Worker', () => {
  assert.equal(serverFor('https://rowbusters.com/'), 'https://rowbusters.com');
  assert.equal(serverFor('https://www.rowbusters.com/?join=ABCDE'), 'https://www.rowbusters.com');
  assert.equal(serverFor('https://blocksnet.fmlacerda.workers.dev/'), LIVE);
  // A pull-request preview or the staging copy must never play on the live server.
  assert.equal(serverFor('https://stage1-hardening-blocksnet.fmlacerda.workers.dev/'), 'https://stage1-hardening-blocksnet.fmlacerda.workers.dev');
  assert.equal(serverFor('https://rowbusters-staging.fmlacerda.workers.dev/'), 'https://rowbusters-staging.fmlacerda.workers.dev');
});

test('other copies use the live server', () => {
  assert.equal(serverFor('https://fmlacerda.github.io/BlocksNet/'), LIVE);
  assert.equal(serverFor('http://localhost:8000/'), LIVE);
  assert.equal(serverFor('https://evil.workers.dev/'), LIVE);           // only this account's Workers
});
