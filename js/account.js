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

  const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const get = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch (e) { return null; } };
  const set = (k, v, store = localStorage) => { try { if (v == null) store.removeItem(k); else store.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } };
  const setPid = pid => { try { localStorage.setItem('rb.pid', pid); } catch (e) { /* storage off */ } };
  const post = async (path, body) => {
    const r = await fetch(RB.net.serverURL() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  };

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
    async start(provider) {
      await account.providers();
      const nonce = rand(), state = rand();
      set('rb.signin', { provider, nonce, state, back: location.search }, sessionStorage);
      location.assign(AUTH[provider](config[provider], location.origin + location.pathname, nonce, state));
    },
    // On page load: finishes a sign-in the provider just sent back. Resolves to
    // { provider } on success, { error } on failure, or null when there was nothing to do.
    async finish() {
      const h = new URLSearchParams(location.hash.slice(1));
      if (!h.has('id_token') && !h.has('error')) return null;
      const pending = get('rb.signin', sessionStorage);
      set('rb.signin', null, sessionStorage);
      // Take the token out of the address bar (and put back the page's own options).
      history.replaceState(null, '', location.pathname + ((pending && pending.back) || location.search));
      if (!pending || h.get('state') !== pending.state) return { error: 'expired' };
      if (h.has('error')) return { error: h.get('error') === 'access_denied' || h.get('error') === 'user_cancelled_authorize' ? 'cancelled' : 'failed' };
      try {
        const r = await post('/auth/signin', { provider: pending.provider, idToken: h.get('id_token'), nonce: pending.nonce, pid: RB.net.playerId() });
        setPid(r.pid);
        set('rb.account', { provider: pending.provider });
        return { provider: pending.provider, created: r.created };
      } catch (e) { return { error: 'failed' }; }
    },
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
