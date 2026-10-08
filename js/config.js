/*
 * Optional settings for online play.
 *
 * TURN relays carry game data between phones that can't connect directly (common on
 * mobile data). The game already uses PeerJS's free relays; to add your own (e.g. a free
 * Metered or Cloudflare account), paste the ICE server entries they give you here:
 *
 * window.BN_CONFIG = {
 *   turn: [
 *     { urls: 'turn:global.relay.metered.ca:80', username: '…', credential: '…' },
 *     { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '…', credential: '…' },
 *   ],
 * };
 */
window.BN_CONFIG = window.BN_CONFIG || { turn: [] };
