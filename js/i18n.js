/*
 * Languages. Each js/i18n/xx.js adds RB.STRINGS.xx; RB.t(key, params) looks a text up in the
 * player's language and falls back to English. Texts use {name} placeholders; a text can be
 * { one, other } (and more plural forms) chosen by params.n.
 * Load this before js/engine.js, then the language files.
 */
(function (global) {
  'use strict';
  const RB = global.RB = global.RB || {};
  RB.STRINGS = RB.STRINGS || {};
  // Shown in the language picker in each language's own name.
  RB.LANGS = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch' };

  function pick() {
    const q = (global.location && new URLSearchParams(global.location.search).get('lang')) || '';
    let saved = '';
    try { saved = JSON.parse(global.localStorage.getItem('rb.lang') || '""'); } catch (e) { /* storage unavailable */ }
    const wanted = [q, saved].concat((global.navigator && (global.navigator.languages || [global.navigator.language])) || []);
    for (const l of wanted) { const c = String(l || '').slice(0, 2).toLowerCase(); if (RB.LANGS[c]) return c; }
    return 'en';
  }
  RB.lang = pick();

  const plurals = {};
  const form = (lang, n) => {
    try { return (plurals[lang] = plurals[lang] || new Intl.PluralRules(lang)).select(n); } catch (e) { return n === 1 ? 'one' : 'other'; }
  };
  const lookup = (lang, key) => (RB.STRINGS[lang] || {})[key];

  RB.has = key => lookup(RB.lang, key) != null || lookup('en', key) != null;
  RB.t = (key, p) => {
    let lang = RB.lang, s = lookup(lang, key);
    if (s == null) { lang = 'en'; s = lookup(lang, key); }
    if (s == null) return key;
    if (typeof s === 'object' && !Array.isArray(s)) s = s[form(lang, +(p && p.n) || 0)] || s.other;
    if (Array.isArray(s) || !p) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? p[k] : m));
  };
  RB.setLang = code => {
    if (!RB.LANGS[code]) return;
    try { global.localStorage.setItem('rb.lang', JSON.stringify(code)); } catch (e) { /* storage unavailable */ }
  };
  // Fills elements marked data-i18n (text), data-i18n-aria (aria-label) and data-i18n-ph (placeholder).
  RB.translatePage = (root = global.document) => {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = RB.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', RB.t(el.dataset.i18nAria)));
    root.querySelectorAll('[data-i18n-ph]').forEach(el => el.setAttribute('placeholder', RB.t(el.dataset.i18nPh)));
    root.documentElement && (root.documentElement.lang = RB.lang);
  };
})(typeof window !== 'undefined' ? window : globalThis);
