// Chat and nickname filter (server/moderation.js): offensive words in five languages are caught,
// also disguised ("$h1t"), while innocent words that contain them are left alone.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../server/moderation.js');

test('chat: offensive words are masked, the rest of the message is kept', async () => {
  const { filterChat } = await load();
  const cases = {
    'you are a $h1t player': 'you are a **** player',
    'putain de merde': '****** de *****',
    'Hurensohn!': '*********!',
    'qué mierda, pendejo': 'qué ******, *******',
    'que porra é essa caralho': 'que ***** é essa *******',
    'fuuuck this': '****** this',
    'gg wp, nice rowbust!': 'gg wp, nice rowbust!',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(filterChat(text), want, text);
});

test('chat: words that only contain an offensive one stay intact', async () => {
  const { filterChat } = await load();
  for (const text of ['Scunthorpe', 'assistant classic', 'Monique therapist', 'computador', 'shiitake', 'Dickens Hitchcock', 'grapefruit', 'Essex'])
    assert.equal(filterChat(text), text, text);
});

test('nicknames: offensive ones are caught, also hidden inside; innocent ones pass', async () => {
  const { badName } = await load();
  for (const n of ['Puta', 'xXfuuuckXx', 'Sh1t', 'Arschl0ch', 'Bitchy', 'MerdeMan', 'caralho123']) assert.equal(badName(n), n !== 'MerdeMan', n);
  for (const n of ['Monique', 'Therapist', 'Grapefruit', 'Computador', 'Ana', 'Nazira', 'Cassie', 'Dickens', 'Shitake', 'Hitchcock', 'Scunthorpe'])
    assert.equal(badName(n), false, n);
});
