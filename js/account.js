/*
 * Optional accounts: Sign in with Apple, Google or Microsoft (Hotmail, Outlook). The provider
 * sends the player back here with a signed ID token in the address (#id_token=…); the server
 * checks it and answers with the player id this account plays under, which then replaces this
 * device's id. Providers are asked for no email, and the server keeps none.
 */
(function (RB) {
  'use strict';
  const AUTH = {
    apple: (id, back, nonce, state) => 'https://appleid.apple.com/auth/authorize?' + new URLSearchParams({
      client_id: id, redirect_uri: back, response_type: 'code id_token', response_mode: 'fragment', nonce, state }),
    google: (id, back, nonce, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: id, redirect_uri: back, response_type: 'id_token', scope: 'openid', nonce, state, prompt: 'select_account' }),
    microsoft: (id, back, nonce, state) => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + new URLSearchParams({
      client_id: id, redirect_uri: back, response_type: 'id_token', response_mode: 'fragment', scope: 'openid', nonce, state, prompt: 'select_account' }),
  };
  const PROVIDERS = Object.keys(AUTH);
  // Inside the iPhone app (Capacitor) Apple signs in natively. Google and Microsoft open their
  // pages in Apple's sign-in sheet; they return to rowbusters.com (the address registered with
  // them), which hands the answer on to the app's rowbusters:// address (see below).
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const APP_HOME = 'https://rowbusters.com/';
  const APP_SCHEME = 'rowbusters';
  const APP_STATE = 'app.';
  // On rowbusters.com: a provider's answer to a sign-in started in the app goes back to the app.
  // Only the app's sign-in sheet, which started it (and checks state and nonce), receives it.
  if (!NATIVE) {
    const h = new URLSearchParams(location.hash.slice(1));
    if ((h.has('id_token') || h.has('error')) && (h.get('state') || '').startsWith(APP_STATE)) {
      location.replace(`${APP_SCHEME}://signin#${location.hash.slice(1)}`);
    }
  }

  const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const get = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch (e) { return null; } };
  const set = (k, v, store = localStorage) => { try { if (v == null) store.removeItem(k); else store.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } };
  const setPid = pid => { try { localStorage.setItem('rb.pid', pid); } catch (e) { /* storage off */ } };
  // The nickname lives in the lobby settings (and its field, when the lobby is on screen).
  const nickname = () => (get('rb.settings') || {}).name || '';
  const setNickname = name => {
    set('rb.settings', Object.assign({}, get('rb.settings'), { name }));
    const f = document.getElementById('rb-name');
    if (f) f.value = name;
  };
  const post = async (path, body) => {
    const r = await fetch(RB.net.serverURL() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  };

  // The server checks the provider's token and answers with the account's player id and nickname.
  async function complete(provider, idToken, nonce) {
    try {
      const r = await post('/auth/signin', { provider, idToken, nonce, pid: RB.net.playerId(), name: nickname() });
      setPid(r.pid);
      if (r.name) setNickname(r.name);
      set('rb.account', { provider });
      return { provider, created: r.created };
    } catch (e) { return { error: 'failed' }; }
  }

  let config = null;
  const account = {
    PROVIDERS,
    // { provider } when signed in on this device, else null.
    current: () => get('rb.account'),
    // Which providers the server has switched on.
    async providers() {
      if (!config) config = await fetch(RB.net.serverURL() + '/auth/config', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}));
      return PROVIDERS.filter(p => config[p]);
    },
    // Leaves for the provider's sign-in page; the game reopens afterwards and finish() completes it.
    // In the app, a sign-in sheet opens instead, and this resolves like finish().
    async start(provider) {
      await account.providers();
      if (NATIVE && provider === 'apple') {
        const nonce = rand();
        try {
          const SIWA = window.Capacitor.Plugins.SignInWithApple || window.Capacitor.registerPlugin('SignInWithApple');
          const r = await SIWA.authorize({ nonce, state: rand() });   // no name, no email
          return await complete(provider, r.response.identityToken, nonce);
        } catch (e) { return { error: /cancel|1001/i.test(String(e && (e.message || e.code))) ? 'cancelled' : 'failed' }; }
      }
      if (NATIVE) {
        const nonce = rand(), state = APP_STATE + rand();
        let back;
        try {
          const WebSignIn = window.Capacitor.Plugins.WebSignIn || window.Capacitor.registerPlugin('WebSignIn');
          back = (await WebSignIn.open({ url: AUTH[provider](config[provider], APP_HOME, nonce, state), callbackScheme: APP_SCHEME })).url;
        } catch (e) { return { error: /cancel/i.test(String(e && (e.message || e.code))) ? 'cancelled' : 'failed' }; }
        const h = new URLSearchParams(back.slice(back.indexOf('#') + 1));
        if (h.get('state') !== state) return { error: 'expired' };
        if (h.has('error')) return { error: /access_denied|cancel/.test(h.get('error')) ? 'cancelled' : 'failed' };
        return complete(provider, h.get('id_token'), nonce);
      }
      const nonce = rand(), state = rand();
      set('rb.signin', { provider, nonce, state, back: location.search }, sessionStorage);
      location.assign(AUTH[provider](config[provider], location.origin + location.pathname, nonce, state));
    },
    // On page load: finishes a sign-in the provider just sent back. Resolves to
    // { provider } on success, { error } on failure, or null when there was nothing to do.
    async finish() {
      const h = new URLSearchParams(location.hash.slice(1));
      if (!h.has('id_token') && !h.has('error')) return null;
      if (!NATIVE && (h.get('state') || '').startsWith(APP_STATE)) return null;   // on its way to the app
      const pending = get('rb.signin', sessionStorage);
      set('rb.signin', null, sessionStorage);
      // Take the token out of the address bar (and put back the page's own options).
      history.replaceState(null, '', location.pathname + ((pending && pending.back) || location.search));
      if (!pending || h.get('state') !== pending.state) return { error: 'expired' };
      if (h.has('error')) return { error: h.get('error') === 'access_denied' || h.get('error') === 'user_cancelled_authorize' ? 'cancelled' : 'failed' };
      return complete(pending.provider, h.get('id_token'), pending.nonce);
    },
    // Signed in: a new nickname is the account's, on every device. Resolves to the name it got
    // (a numbered variant when someone else has it).
    async rename(name) {
      const r = await post('/account/name', { pid: RB.net.playerId(), name });
      setNickname(r.name);
      return r.name;
    },
    // Another device changed the account's nickname: take it here too.
    adopt(name) { if (name && name !== nickname()) setNickname(name); },
    // This device goes back to being a guest, with a fresh player id.
    signOut() {
      set('rb.account', null);
      setPid(rand().slice(0, 20));
    },
    // Deletes the account and all its results on the server, then signs out.
    async remove() {
      await post('/account/delete', { pid: RB.net.playerId() });
      account.signOut();
    },
  };
  RB.account = account;
})(window.RB);
