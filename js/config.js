/*
 * Optional settings for online play.
 *
 * TURN relays carry game data between phones that can't connect directly (common on
 * mobile data). The game already uses PeerJS's free relays; to add your own (e.g. a free
 * Metered or Cloudflare account), paste the ICE server entries they give you here:
 *
 * window.RB_CONFIG = {
 *   turn: [
 *     { urls: 'turn:global.relay.metered.ca:80', username: '…', credential: '…' },
 *     { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '…', credential: '…' },
 *   ],
 * };
 */
// Address of the Rowbusters server for public rooms and the ranking (server/worker.js).
// On rowbusters.com the game and the server share the address; any other copy (GitHub Pages,
// a local test server) uses the Worker's own address. Empty = no Multiplayer button.
// The Worker keeps its original name 'blocksnet': renaming it would start a new server with an
// empty ranking.
window.RB_CONFIG = window.RB_CONFIG || {
  server: /(^|\.)rowbusters\.com$|^blocksnet\.fmlacerda\.workers\.dev$/.test(location.hostname)
    ? location.origin : 'https://blocksnet.fmlacerda.workers.dev',
  turn: [],
};
