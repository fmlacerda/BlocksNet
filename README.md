# BlocksNet

Dropping blocks multiplayer online action — a study project.

It is inspired by **TetriNET** (St0rmCat, 1997), the 6-player online block-stacking game with special attack blocks. It is built to run in the browser of iPhones and Linux phones (PinePhone / Librem 5 with Phosh or Plasma Mobile, Firefox or GNOME Web). The repo has one shared game engine and **three phone UI options** to compare.

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
| Best for | TetriNET veterans | casual / one-handed play | long sessions |

`index.html` shows all three side by side with live autoplay previews (`?demo` makes the local player a bot).

Keyboard also works for desktop testing: arrows to move, ↑/X/Z to rotate, Space to drop, 1–6 to fire a special at that player, D to discard.

## What's implemented from the original

- 12×22 field, 7 tetrominoes, original 5-colour block palette with bevelled blocks.
- Up to 6 players with slot numbers 1–6 (you plus 1–5 bots in this prototype).
- Classic line sending: clearing 2 lines sends 1 to every opponent, 3 sends 2, 4 sends 4.
- Specials appear on your field when you clear lines. Clearing the line that holds one banks it (inventory of up to 18). The default TetriNET frequencies are used:
  `a` Add Line · `c` Clear Line · `n` Nuke Field · `r` Random Clear · `s` Switch Fields · `b` Clear Specials · `g` Block Gravity · `q` Blockquake · `o` Block Bomb.
- Level and gravity speed-up, junk-filled field when eliminated, attack/defense log, partyline chat (option A), and a winlist stored on the device.
- Bots use a heuristic placement AI and use specials sensibly (gravity/nuke on themselves when high, switch when losing, and so on).

## Code layout

```
js/engine.js   rules: Player, Room (routes lines/specials), BotBrain
js/render.js   canvas drawing: fields, next piece, special bar
js/app.js      shared shell: lobby, game loop, keyboard, hold-to-repeat buttons, winlist, haptics
css/common.css shared tokens, overlays, log colours
option-*.html  the three layouts (only layout + input wiring)
```

## Path to real multiplayer

`Room` is already the single authority that routes lines and specials between `Player`s, and bots talk to it through the same calls a human uses (`move`, `rotate`, `hardDrop`, `useSpecial`). To go online:

1. Run `engine.js` in a small Node server (WebSocket) that owns one `Room` per channel.
2. Clients send intents (`move`, `rotate`, `drop`, `use <slot>`, `chat`) and receive field diffs (the original protocol sent `f` field updates as compact strings).
3. Keep the client-side `Player` running locally for zero-latency movement, and reconcile with the server on lock.

## Packaging for app stores later

- **iOS**: wrap the same files with Capacitor (WKWebView).
- **Linux phones**: package as a Flatpak using WebKitGTK, or just ship it as an installed PWA.
