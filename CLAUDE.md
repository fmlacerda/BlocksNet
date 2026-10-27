# Rowbusters (formerly BlocksNet)

Multiplayer block-dropping game for phones and the web, for up to 4 players, with specials, public
rooms, a ranking and round stats. Live at https://rowbusters.com (Cloudflare) and
https://fmlacerda.github.io/BlocksNet/ (GitHub Pages copy, which forwards players to rowbusters.com).
The owner is not a developer: explain outcomes in plain words, and ask before anything outward-facing.

## Layout
- `index.html` the game page (portrait layout, controls, render loop). No build step: plain HTML/JS/canvas.
- `js/engine.js` rules (Room, Player, BotBrain, modes) · `js/render.js` canvas drawing ·
  `js/net.js` online play (public rooms over WebSocket, private rooms over PeerJS) ·
  `js/app.js` screens (lobby, rooms, Partyline, stats, summary) · `js/statsimage.js` summary as PNG ·
  `js/sound.js` synthesised sounds · `js/config.js` server address ·
  `js/i18n.js` + `js/i18n/{en,es,pt,fr,de}.js` the texts in five languages (`RB.t('key', {params})`).
- `server/worker.js` Cloudflare Worker + one Durable Object (`Hub`, SQLite): 7 public rooms
  (3 = Teams 2v2, 5 = SNS, 6 = Fast, 7 = Pure), ranking, round stats. `wrangler.jsonc` deploys it
  and serves the game files (minus `.assetsignore`).
- `tests/unit` game rules (node --test) · `tests/e2e` server + browser tests (Playwright).

## Commands
- `npm install` once. `npm run dev` → open http://127.0.0.1:8787/?server=http://127.0.0.1:8787
- `npm test` = `npm run test:unit` + `npm run test:e2e` (starts its own local server; ~2 min).
- `npm run deploy:staging` deploys the test copy (needs Cloudflare credentials).

## Rules of the road
- Work on a branch and open a pull request; CI (`.github/workflows/ci.yml`) must be green.
  `main` deploys itself: GitHub Pages + Cloudflare (the live game and server). Never push to `main`
  without the owner's go-ahead.
- Every change that players get bumps the version in 4 places: `RB.VERSION` in `js/engine.js`,
  `version.json`, `SERVER_VERSION` in `server/worker.js`, and every `?v=` tag in `index.html`
  (format `2026.10.24c` / `20261024c`). A unit test fails if they disagree.
- Phones run their own copy of the rules and talk to the server: keep the protocol (`PROTO`)
  backwards compatible, since old app versions stay in use for weeks. Raise `MIN_CLIENT_VERSION`
  in `server/worker.js` only when old versions really can't play correctly any more.
- Crash reports from players' devices land in the Worker log (`/errors`); limits are in `LIMITS`.
- Names: global namespace `RB`, CSS classes and ids `rb-…`, storage keys `rb.…`.
  Brand colours are CSS variables at the top of `css/common.css`; block and special colours
  (engine `COLORS`, `SPECIAL_INFO`) are part of the game and stay as they are.
- Never rename the Worker (`blocksnet`): it holds the ranking database. Never store player emails.
  Never commit secrets (use GitHub/Cloudflare secret settings). Never use "Tetris"/"TetriNET" names.
- Write user-visible text plainly; keep comments short and about why. Player-facing text never goes
  in the code: add a key to all five `js/i18n/*.js` files (unit tests check they match). Server
  room messages send a `code` + `p` params (texts under `srv.`) next to the English `text`.

## Testing notes
- Tests share the 7 rooms, so they run one at a time; each test empties its room at the end.
- wrangler watches the project folder: test databases and recordings live in the temp folder
  (see `playwright.config.js`), otherwise the server restarts mid-test.
- Phone tests use `devices['iPhone 13']`. Tests tagged `@webkit` also run in Safari's engine on CI
  (the cloud sandbox only has Chromium; don't run `playwright install` there).
- A failing test is a bug to fix, not a flake to retry.
- In the cloud sandbox, workers.dev and github.io are not reachable, so live deploys can't be checked
  from here; ask the owner to check `https://blocksnet.fmlacerda.workers.dev/health`.
- Stopping a background `wrangler dev`: run the pgrep/kill from a separate script file; a command
  line that contains the pattern matches (and kills) its own shell.
