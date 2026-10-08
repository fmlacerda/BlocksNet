# BlocksNet

Dropping blocks multiplayer online action — a study project.

It is a 6-player online block-stacking game with special attack blocks, built to run in the browser of iPhones and Linux phones (PinePhone / Librem 5 with Phosh or Plasma Mobile, Firefox or GNOME Web). The repo has one shared game engine and **three phone UI options** to compare.

## Run it

No build step and no dependencies. Serve the repo root and open it on the phone:

```sh
python3 -m http.server 8000
# phone on the same Wi-Fi → http://<your-computer-ip>:8000/
```

Opening `index.html` straight from disk (`file://`) also works. On iOS use *Share → Add to Home Screen*, and on Linux phones use *Install / Add to home*, so it runs full-screen like an app.

## The three UI options

| | A · Classic Portrait | B · Swipe Focus | C · Landscape Arcade |
|---|---|---|---|
| File | `option-a-classic.html` | `option-b-swipe.html` | `option-c-landscape.html` |
| Orientation | portrait | portrait | landscape |
| Move / rotate / drop | on-screen button pad | drag, tap and flick gestures | D-pad + A/B buttons |
| Fire special | buttons 1–6, D to discard, or tap a field | drag the special chip onto a player, or tap them | tap any field, ME button for self |
| Opponents | 2-column list beside your field | strip across the top | 3×2 board |
| Best for | classic-style players | casual / one-handed play | long sessions |

`index.html` shows all three side by side with live autoplay previews (`?demo` makes the local player a bot).

Keyboard also works for desktop testing: arrows to move, ↑/X/Z to rotate, Space to drop, 1–6 to fire a special at that player, D to discard.

## Game features

- 12×22 field, 7 tetrominoes, original 5-colour block palette with bevelled blocks.
- Up to 6 players with slot numbers 1–6, online with friends and/or bots.
- Classic line sending: clearing 2 lines sends 1 to every opponent, 3 sends 2, 4 sends 4.
- Specials appear on your field when you clear lines. Clearing the line that holds one banks it (inventory of up to 18). Default frequencies:
  `a` Add Line · `c` Clear Line · `n` Nuke Field · `r` Random Clear · `s` Switch Fields · `b` Clear Specials · `g` Block Gravity · `q` Blockquake · `o` Block Bomb.
- Game speed settings in the lobby: **Speed** preset (Relaxed, Classic, Fast, Turbo, Insane), **Start level** (1–50) and **Level up** every 1–10 lines. Bots speed up to keep pace.
- Level and gravity speed-up, junk-filled field when eliminated, attack/defense log, partyline chat (option A), and a winlist stored on the device.
- Bots use a heuristic placement AI and use specials sensibly (gravity/nuke on themselves when high, switch when losing, and so on).

## Fullscreen

- **Android and Linux phone browsers** (Firefox, Chromium, GNOME Web): leave *Play fullscreen* ticked in the lobby. The game goes fullscreen when you tap Start, and option C also locks to landscape.
- **iPhone**: Safari has no fullscreen mode for web pages. Use *Share → Add to Home Screen* and launch BlocksNet from the icon. It then opens without browser bars (the lobby shows this tip on iPhone).

## Code layout

```
js/engine.js   rules: Player, Room (routes lines/specials), BotBrain
js/render.js   canvas drawing: fields, next piece, special bar
js/net.js      online rooms: PeerJS / same-browser transports, host relay, room codes, invites
js/app.js      shared shell: lobby, online room screens, game loop, keyboard, buttons, winlist, haptics
js/vendor/     PeerJS 1.5.5 (MIT)
css/common.css shared tokens, overlays, log colours
option-*.html  the three layouts (only layout + input wiring)
```

## Online multiplayer

Up to 6 players on their own phones, with bots filling any empty slots.

1. One player taps **Host a room**. A 5-character room code appears.
2. Friends tap **Join a room** and enter the code, or open the invite link from **Share invite link** (`…?join=CODE`).
3. The host picks how many bots to add and taps **Start game**. The host's speed settings apply to everyone.

Each player can use any of the three UI options in the same room.

**How it works.** Phones talk directly to each other over WebRTC, using PeerJS (bundled in `js/vendor/`, MIT licence). The free PeerJS cloud server only introduces the phones; no game data goes through it, and nothing needs hosting besides these static files.
- **Each phone runs its own field.** The phone sends its field about 10 times a second, plus every line attack, special and chat message.
- **The host relays.** Guests connect only to the host, which relays messages between them, runs the bots and decides when the game ends.
- **Guests are checked.** The host only accepts messages a guest sends for its own player, and player names are stripped of anything but letters, digits and simple punctuation.

**Things to know:**
- The room lives on the host's phone. If the host closes the page or locks the phone, the game ends for everyone.
- Online games can't pause. A phone that goes to the background stops sending, and iOS may drop the connection.
- Some strict networks (certain mobile carriers, corporate Wi-Fi) block direct connections. PeerJS then falls back to its free relay servers, which can be slow or busy. If joining fails, try another network.
- **Testing on one computer:** add `?net=local` to the URL and use two tabs of the same browser. No internet is needed.
- **Own connection server:** run a [PeerServer](https://github.com/peers/peerjs-server) and add `?peerhost=your.host&peerport=443&peersecure=1&peerpath=/` to the URL. Invite links keep these settings.

## Packaging for app stores later

- **iOS**: wrap the same files with Capacitor (WKWebView).
- **Linux phones**: package as a Flatpak using WebKitGTK, or just ship it as an installed PWA.
