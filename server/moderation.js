/*
 * Moderation: a word filter for chat and nicknames (English, Spanish, Portuguese, French,
 * German), so app-store rules for player chat are met: filter, report, block (on the device),
 * and acting on reports (players reported by several others are muted for a day).
 *
 * Words are matched after folding case, accents and look-alike characters ("$h1t" → "shit"),
 * as whole words in chat (so "Scunthorpe" or "assistant" stay intact) and anywhere in nicknames
 * (which have no spaces to hide behind). Chat words are masked; a nickname containing one is
 * replaced.
 */

// Strong insults, slurs and sexual words. Kept short and unambiguous: words with innocent
// meanings in another of the five languages are left out.
const WORDS = [
  // English
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'shithead', 'bullshit', 'bitch', 'cunt', 'dick', 'dickhead', 'cock', 'pussy',
  'asshole', 'bastard', 'slut', 'whore', 'wanker', 'twat', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'rapist',
  'nazi', 'kys',
  // Spanish
  'puta', 'puto', 'putas', 'putos', 'mierda', 'pendejo', 'pendeja', 'cabron', 'cabrona', 'gilipollas', 'coño', 'verga',
  'chinga', 'chingada', 'maricon', 'marica', 'zorra', 'culero', 'hijueputa', 'malparido',
  // Portuguese
  'porra', 'caralho', 'merda', 'foda', 'fodase', 'buceta', 'viado', 'arrombado', 'cuzao', 'filhodaputa', 'vagabunda',
  'otario',
  // French
  'merde', 'putain', 'connard', 'connasse', 'salope', 'encule', 'enculé', 'pute', 'batard', 'nique', 'pd', 'tapette',
  // German
  'scheisse', 'scheiße', 'arschloch', 'fotze', 'hurensohn', 'wichser', 'schlampe', 'missgeburt', 'schwuchtel', 'spast',
  'fick', 'ficken', 'nutte',
];

// Fold case, accents and look-alikes, so "Pütå", "PUTA" and "pv7a" compare equal.
const LOOK = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', 'ß': 'ss' };
export function fold(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[01!34@5$78ß]/g, ch => LOOK[ch]);
}
const BAD = new Set(WORDS.map(fold));
// For nicknames, also hidden inside longer names, with repeated letters squeezed ("xXfuuuckXx").
// Only long or unmistakable words: short ones hide in innocent names ("Monique", "Therapist", "Scunthorpe").
const squeeze = s => s.replace(/(.)\1+/g, '$1');
const NOT_INSIDE = new Set(['nique', 'rapist', 'putas', 'putos', 'merde', 'merda']);
const BAD_INSIDE = [...BAD].filter(w => (w.length >= 5 && !NOT_INSIDE.has(w)) || w === 'fuck').map(squeeze);

// Chat: each offending word becomes asterisks; everything else is untouched.
export function filterChat(text) {
  // A word: letters, digits and look-alikes; "!" only inside one ("sh!t"), not ending a sentence.
  return String(text).replace(/[\p{L}\p{N}@$]+(?:!+[\p{L}\p{N}@$]+)*/gu, w => {
    const f = fold(w);
    return BAD.has(f) || BAD.has(squeeze(f)) ? '*'.repeat(w.length) : w;
  });
}

// Nicknames: true when one hides an offending word.
export function badName(name) {
  const f = squeeze(fold(name).replace(/[^a-z]/g, ''));
  return BAD.has(f) || BAD_INSIDE.some(w => f.includes(w));
}
