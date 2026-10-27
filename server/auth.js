/*
 * Sign-in with Apple, Google and Microsoft (Hotmail/Outlook): checks the provider's signed
 * "ID token" and returns a key for the account. Only the scrambled key is ever stored: never an
 * email, a name or the provider's own id. The game asks providers for no email at all.
 *
 * Client ids are public settings (vars in wrangler.jsonc); a provider without one is off.
 * AUTH_TEST_JWKS (set only by the local test server) adds a "test" provider with its own keys.
 */

const PROVIDERS = {
  apple: {
    jwks: 'https://appleid.apple.com/auth/keys',
    issuer: iss => iss === 'https://appleid.apple.com',
    // Web sign-in uses the Services ID; the iPhone app later signs in with its bundle id.
    audiences: env => list(env.APPLE_CLIENT_IDS),
  },
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: iss => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
    audiences: env => list(env.GOOGLE_CLIENT_ID),
  },
  microsoft: {
    jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    // One issuer per Microsoft directory; personal accounts (Hotmail, Outlook) share one.
    issuer: (iss, claims) => /^[0-9a-f-]{36}$/.test(claims.tid || '') && iss === `https://login.microsoftonline.com/${claims.tid}/v2.0`,
    audiences: env => list(env.MICROSOFT_CLIENT_ID),
  },
  test: {
    issuer: iss => iss === 'rowbusters-test',
    audiences: env => (env.AUTH_TEST_JWKS ? ['rowbusters-test'] : []),
  },
};

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// What the sign-in buttons need: which providers are on, and their (public) client ids.
export function authConfig(env) {
  return {
    apple: list(env.APPLE_CLIENT_IDS)[0] || null,
    google: list(env.GOOGLE_CLIENT_ID)[0] || null,
    microsoft: list(env.MICROSOFT_CLIENT_ID)[0] || null,
    test: env.AUTH_TEST_JWKS ? 'rowbusters-test' : null,
  };
}

// Providers' signing keys change rarely; keep them for an hour.
const keyCache = new Map();
async function signingKeys(provider, env) {
  if (provider === 'test') return JSON.parse(atob(env.AUTH_TEST_JWKS)).keys;
  const hit = keyCache.get(provider);
  if (hit && hit.until > Date.now()) return hit.keys;
  const r = await fetch(PROVIDERS[provider].jwks);
  if (!r.ok) throw new Error('keys unavailable');
  const keys = (await r.json()).keys || [];
  keyCache.set(provider, { keys, until: Date.now() + 3600000 });
  return keys;
}

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const part = s => JSON.parse(new TextDecoder().decode(b64url(s)));

// Returns { key } for a valid token, or { error }.
export async function verifySignIn(env, { provider, idToken, nonce }) {
  const P = PROVIDERS[provider];
  const audiences = P ? P.audiences(env) : [];
  if (!audiences.length) return { error: 'provider off' };
  const bits = String(idToken || '').split('.');
  if (bits.length !== 3 || idToken.length > 8192) return { error: 'bad token' };
  let head, claims;
  try { head = part(bits[0]); claims = part(bits[1]); } catch (e) { return { error: 'bad token' }; }
  if (head.alg !== 'RS256') return { error: 'bad token' };
  // Cheap checks first, so junk never costs a fetch of the provider's keys.
  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!P.issuer(claims.iss, claims) || !aud.some(a => audiences.includes(a))) return { error: 'bad token' };
  if (!(claims.exp > now) || claims.iat > now + 300) return { error: 'expired' };
  // The nonce ties the token to this sign-in attempt, so an old token can't be replayed.
  if (!nonce || claims.nonce !== nonce || !claims.sub) return { error: 'bad token' };
  let jwk;
  try { jwk = (await signingKeys(provider, env)).find(k => k.kid === head.kid); } catch (e) { return { error: 'try again' }; }
  if (!jwk) return { error: 'bad token' };
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(bits[0] + '.' + bits[1]);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(bits[2]), signed)) return { error: 'bad token' };
  } catch (e) { return { error: 'bad token' }; }
  // The scrambled key is all that is kept: the same person always gets the same key.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rowbusters:${provider}:${claims.sub}`));
  return { key: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') };
}
