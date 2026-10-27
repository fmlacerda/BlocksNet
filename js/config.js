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
// Copies served by a Worker (rowbusters.com, the live and staging Workers, pull-request previews
// on *.fmlacerda.workers.dev) talk to the Worker that served them, so a preview or the staging
// copy never plays on the live server. Other copies (GitHub Pages, a plain local web server) use
// the live Worker's address. Empty = no Multiplayer button.
// The Worker keeps its original name 'blocksnet': renaming it would start a new server with an
// empty ranking.
window.RB_CONFIG = window.RB_CONFIG || {
  server: /(^|\.)rowbusters\.com$|\.fmlacerda\.workers\.dev$/.test(location.hostname)
    ? location.origin : 'https://blocksnet.fmlacerda.workers.dev',
  turn: [],
};
