# Multiplayer — good games, good company

A small collection of browser games to play with friends. Choose **PLAN — Predict your tricks.** or **TOW — Keep your trailer close.** from the collection.

**TOW** is online multiplayer trailer racing for **2–4 drivers**, available at `./games/tow/`. **Keyboard controls only for now.** The collection links to TOW's independent realtime racing entry point; its physics and networking modules are loaded only when opening that game. See [TOW's controls, advertising and test instructions](games/tow/README.md).

PLAN is a complete, turn-based card game for **2–6 players**, including the host. It works with a mouse or touch, on desktops, tablets and portrait phones down to 320px. Everything in the interface is in English. PLAN cards are drawn with HTML/CSS; TOW uses local cover/social images and Canvas vehicle art. There are no external fonts, frameworks or sound assets.

**Preview:** a dark emerald card table, cream and gold details, white playing cards, a lobby with an invite link, mobile player tiles, bidding controls and a scoreboard grouped by round and deal. A gold/mint victory animation follows the visual style of Sokoban. Running the optional browser tests saves screenshots in `test-results/`.

**Campaign artwork:** `marketing/plan-social.png` is the full-resolution PLAN image for LinkedIn and Facebook posts. `marketing/PROMPTS.md` records the final prompt used with the built-in image tool. The optimized `assets/plan-social.jpg` is linked in the static HTML's [Open Graph](https://ogp.me/) and large-image card metadata, so social link previews do not depend on JavaScript. The catalog keeps its own optimized copy for its PLAN link.

## Run locally

From this directory:

```sh
python3 -m http.server 8080
```

Open **http://localhost:8080/**. Select **PLAY PLAN** from the collection.

Do not open `index.html` as `file://`: ES modules and browser security require an HTTP origin. Localhost is suitable for local WebRTC testing. Use HTTPS when publishing or testing from other devices; plain HTTP on a LAN address may not provide all required secure-context APIs.

No install, bundler, build step, application server, database or Node.js is needed to serve the game. The Python command only serves static files during development. PeerJS **1.5.5** is loaded on demand from:

```text
https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js
```

If that script cannot load, the app displays **MULTIPLAYER SERVICE UNAVAILABLE** with a reload button. The game collection and rules do not depend on the CDN.

Google Analytics loads asynchronously from Google Tag Manager using the shared measurement ID **G-WTPHWDLQ7K**, matching the other games. Analytics is initialized in `index.html` and is not required for gameplay.

## Test with two players

1. Open the site in two different browsers, two devices, or a normal and private window.
2. In the first browser select PLAN, enter a name and choose **CREATE GAME**.
3. Choose **COPY INVITE LINK** and open it in the second browser. The code is prefilled. If clipboard access is denied, select and copy the visible invite-link field instead.
4. Enter a second name, choose **JOIN GAME**, then **READY**.
5. The host chooses **START GAME**. The randomly selected dealer bids last; the player after the dealer bids first. The player with the highest bid leads the first trick; tied highest bids favor the player who bid earlier.
6. Bid in turn, then click/tap the enabled cards. The table keeps completed tricks visible briefly. Review the results; only the host can choose **NEXT HAND**, after a three-second button countdown.
7. Play two deals each with 5, 4, 3, 2, 1 cards, then two blind deals: **12 hands** for two players. Each player opens the bidding once per round. In every blind deal, your card is a back and your opponent’s card is face up. Choose **PLAY MY CARD** on your turn.
8. Check the final scores and choose **PLAY AGAIN** as host. The same room and connections are reused.

Keep the host’s tab open and devices awake throughout the game. When testing other devices, open the deployed HTTPS site rather than sending them a `localhost` link.

## Publish on GitHub Pages

This **`multiplayer/` directory is the root of the `gbyrka/multiplayer` repository**. Publish its contents, including `index.html` at the repository root; do not wrap them in another `multiplayer` directory.

1. Change `version` in `config.json` to a new short string, then commit and push the files to the `main` branch of that repository.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Select **main** and **/(root)**, then save.
5. Open the URL GitHub provides, normally `https://mod-it.games/multiplayer/`.

There are no GitHub Actions or build dependencies. `.nojekyll` is included. Asset URLs are relative (`./style.css`, `./app.mjs`); invite URLs use `window.location.origin` and `window.location.pathname`, so subdirectory deployment and custom domains work. Invites look like `?room=K7PX4M9Q&game=plan`.

The user-site repository `gbyrka.github.io` owns `CNAME` for `mod-it.games`; this project inherits the domain at `/multiplayer/`. Entry pages for the collection, TOW and HAMSTER redirect HTTP and the old GitHub hostname to `https://mod-it.games` before loading scripts, preserving the pathname, room parameters and fragment. Local HTTP previews remain usable. Social preview URLs and canonical links use the new HTTPS origin.

This implementation does not automatically commit, push or change your GitHub Pages settings.

## Refreshing assets after a deployment

**`config.json` is the single source of the app version.** Before **every deployment that changes application files**, change its `version`, for example from `birch` to `cedar`. Use a new 3–16 character alphanumeric value; never reuse a previously deployed version.

The standalone advertising stylesheet and helper initialise before the app loader; also update their `?v=` URLs in `index.html` when changing those files.

The small inline loader reads the configuration with `cache: 'no-store'` and a fresh request URL on every visit/reload. It then loads **CSS, favicon and every JS module** with `?v=VERSION`. An [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) also versions relative imports inside the module graph; versioning only `app.mjs` would leave its dependencies cached. A cached copy of the HTML still runs the same loader and reads the new configuration. Returning through the browser's back/forward cache reloads the app too. A game already open is not interrupted by an automatic refresh.

When adding a production module, add its relative path to `config.json` → `modules`. The browser asset test verifies that this list includes every production module, checks version changes with a real year-long HTTP cache and runs under a `/multiplayer/` subpath. No build, service worker or server configuration is required. A failed configuration/assets request produces an **APP UNAVAILABLE** screen with **RELOAD**.

Guests send the loaded app version during the room handshake. The host rejects another version with a readable reload instruction, preventing games from mixing incompatible deployed rules.

## Sounds and victory

Web Audio generates original, short sounds locally: a soft paper/wood tap for another player's card, the same sound about 3.5 dB louder for your own card, and a gentle ascending bell phrase for a winner. Sounds follow accepted host state updates, including blind plays; clicks, rejected moves, duplicate snapshots and rerenders do not replay them. **Only winners see the celebration and hear the triumph**, including every tied winner. Everyone can read the final standings.

Use **SOUND ON / SOUND OFF** in the header to mute or enable audio. The preference is saved on the device. Audio starts only after a user gesture, and hidden tabs do not play delayed sounds. Audio failure does not interrupt gameplay. The 2.4-second celebration has a soft halo, gold/mint particles and a medal reveal; it stops on leaving, rematch, resize or a hidden tab and respects `prefers-reduced-motion`.

The current bidder or card player has a bright **YOUR TURN / THEIR TURN** label, a dot, and a gently pulsing gold border. The indicator is visible to everyone. Pulsing stops between tricks and is disabled with reduced motion, while the static label and border remain. State updates reuse the table, player tiles and existing card nodes, preserving focus and preventing the table's reveal animation or earlier cards' play animations from restarting on each move.

## Room chat

Chat is available in the lobby and all game phases. It appears beside the table on wide screens and below it at 900 px and narrower. Press **Enter** or **SEND** to send; **Shift + Enter** inserts a newline. Typing with an input method editor does not accidentally send. A draft, focus and message-scroll position survive game updates; a new-message button appears when you are reading older messages.

The host handles `CHAT_SEND` using the connection's assigned identity, validates the text, and relays `CHAT_UPDATE` to room participants. Chat has its own increasing revision, replay protection and acknowledgements; it does not change game revisions, pending moves or trick timers. New guests receive the latest 25 messages. Rematches retain the room conversation; leaving clears the local panel. There is no external chat service, storage or database.

Messages are limited to 500 characters and five accepted messages per player per ten seconds. HTML tags and unsafe control characters are rejected. Text and player names are inserted only as text nodes, never `innerHTML`, Markdown or executable code. URLs and JavaScript-looking strings stay non-clickable, inert text; HTML entities are not decoded into markup. The chat payload carries only message IDs, sender IDs/names, timestamps and user-authored text, with no game hands or cards.

## Rules

- A game has **six rounds: 5, 4, 3, 2, 1, then 1 blind card** per player. Each round has **one deal per player**, so everyone opens the bidding once with each card count, including blind. There are **6 × player count** hands: 12 with 2 players, 24 with 4, or 36 with 6.
- A fresh 52-card deck is shuffled for every hand. Cards are dealt clockwise after the dealer. The next undealt card sets trump and is not played. Ace is high.
- Join order fixes seats. The first dealer is random and the dealer advances clockwise after every hand.
- Bid from zero to the number of cards in the hand, starting after the dealer. **Total bids cannot equal the number of available tricks**; this restricts the last bidder.
- The player with the **highest bid leads the first trick**, including in the blind hand. If several players share the highest bid, the one who bid earlier leads. If everyone bids zero, the first bidder leads.
- Follow the lead suit if you have it; otherwise play any card. Highest trump wins, or highest lead-suit card if there is no trump. The trick winner leads the next trick.
- An exact prediction earns **10 + bid** points. A miss loses **abs(bid − tricks won)** points. Bid 2/win 2 gives +12; bid 3/win 1 gives −2.
- The host advances after each hand’s results. Scores accumulate; the highest total wins. Equal highest totals are a **tie**.
- In the blind finale, you see everybody else’s one card but cannot see your own. Trump and bidding rules are unchanged. Your card becomes public when you play it.

The in-app **HOW TO PLAY** explains all rules and examples in short sections. **SCOREBOARD** shows every deal, grouped into six rounds, with PLAYER and TOTAL kept visible while scrolling locally on narrow screens. History records each deal's round, card count, prediction, tricks won and score.

## Multiplayer architecture and privacy

```text
Guest B ──┐
Guest C ──┼── Host (also a player)
Guest D ──┤
Guest E ──┤
Guest F ──┘
```

**Host is authoritative and trusted.** Only the host shuffles, deals, stores complete hands, validates moves, changes phases, resolves tricks and scores the game.

The public **PeerServer Cloud** provides discovery/signaling only. Game messages travel between browsers over **WebRTC DataChannels**, through PeerJS 1.5.5. Each guest has one connection to the host; guests never need to connect to one another. DataChannels must be ordered and fully reliable. See the [PeerJS API](https://peerjs.com/client/api/peer) and [connection documentation](https://peerjs.com/client/api/data-connection).

Clients send **intentions**, not state. The host binds a player ID to each `DataConnection` and never trusts a player ID from a message. The host UI also sends its actions through the same rule reducer.

Every recipient gets a newly constructed `buildViewForPlayer()` result with an explicit field allowlist:

- Normal hands: their own cards and opponents’ card counts; no opponents’ hands.
- Blind hand: `me.hand: null`, their remaining card count, and each opponent’s visible card. Their own unplayed card ID/rank/suit is absent from the entire view, not just hidden in CSS. Even legal-card IDs are empty.
- Played cards, bids, scores and trump are public. When your blind card is played it is intentionally revealed in the public trick.
- The host screen uses the same filtered view. The host necessarily holds the full authoritative state in browser memory and can inspect it with developer tools. No cryptographic protection against a dishonest host is claimed.

Envelopes contain a protocol version, message type, request ID and payload. Actions also contain the last received revision. Repeated request IDs are ignored using a bounded per-connection cache; stale actions are rejected, and guests discard old or duplicate state revisions. Explicit ready values can safely arrive concurrently in the lobby. Messages have schema/size limits and a per-connection rate limit. Names are inserted only as text nodes.

The phase machine is:

```text
lobby → bidding → playing → trick_result ──→ playing (next trick)
                                  └───────→ hand_result → bidding (next hand)
                                  └───────→ game_result → bidding (rematch)
active phase → disconnected → lobby
```

Dealing is an atomic host operation immediately before bidding. A host-only timer holds completed tricks for 2.2 seconds. Hand and final results wait for the host, with **NEXT HAND / PLAY AGAIN** disabled for the first three seconds and a visible countdown. The host validates that delay independently of the UI; recipients receive a remaining duration rather than depending on synchronized device clocks. Timers are cancelled on disconnection or room closure and are guarded against stale state.

## Shared code and adding another game

An unlisted **HAMSTER multiplayer** prototype lives at `./games/hamster/`, beside PLAN and TOW. It supports 2–4 friends in the original 3D HAMSTER habitat, with a shared three-minute score competition, playful nudges and golden snack events. It is intentionally omitted from the public collection and game catalog; open its direct URL to create or join a room. See [HAMSTER's rules, controls and tests](games/hamster/README.md).

```text
index.html                 Inline version loader, shell, dialog and announcements
config.json                Central version and complete production module list
style.css                  Collection, shared UI and responsive PLAN table
app.mjs                    Navigation, input, dialogs and session lifecycle
favicon.svg                Emerald playing-card vector icon
shared/
  random.mjs               Crypto randomness, room codes and name validation
  protocol.mjs             Central protocol, schemas, replay/revision helpers
  peer-loader.mjs          Pinned CDN loader and graceful failure
  network.mjs              Game-independent STAR transport and health checks
  room.mjs                 Connections → identities → authoritative adapter
  chat.mjs                 Bounded host chat, plain-text validation and rate limit
  chat-ui.mjs              Persistent composer, messages and unread indicator
  dom.mjs                  Safe DOM/card builders and shared instructions
  screens.mjs              Collection, game entry, lobby and connection screens
  sound.mjs                Local Web Audio synthesis and persisted mute control
  effects.mjs              Deduplicated effects from accepted public views
  celebration.mjs          Sokoban-inspired canvas victory, reduced-motion aware
games/
  registry.mjs             Game descriptors and adapter registration
  plan/
    cards.mjs              Card model, deck, Fisher–Yates and dealing
    game-core.mjs          Pure rules, lifecycle and private view builder
    ui.mjs                 Table, bidding, hand/results and scoreboard
    rules.mjs              English instructions
tests/
  game-core.test.mjs       Rules, lifecycle, privacy and full-game simulations
  protocol.test.mjs        Input validation, message schemas and replay helpers
  room.test.mjs            Room sessions through an in-memory test transport
  chat.test.mjs            Content validation, bounded history and wire limits
  effects.test.mjs         Sound/victory events and generated waveform checks
  browser-smoke.mjs        Optional real PeerJS Cloud / WebRTC browser test
  browser-ui.mjs           Responsive fixtures and connection failure screens
  browser-assets-effects.mjs Real HTTP cache, Web Audio and victory checks
.nojekyll
.gitignore
README.md
LICENSE
```

Register another game in `games/registry.mjs` with a unique ID and PeerJS namespace. Supply an adapter with `createLobby`, `addPlayer`, `removePlayer`, `applyAction`, `buildViewForPlayer` and `automaticTransition`, plus game/rules/scoreboard rendering functions. Reuse the transport, room binding, invites, lobby, dialog and menu. Add any new intent schema to the centralized protocol. Game rules must stay independent of DOM and transport. The initial lobby policy (2–6 players and ready guests) is implemented in the adapter and can be reused or adjusted for a future game.

## Advertising and consent

One responsive AdSense `game_footer` unit (`9380002810`) lives outside `#main`, below the complete game/chat layout with at least 150px of separation. It is available in the collection, game entry and active PLAN game/result screens. TOW has its own persistent footer unit on the home, race, pause and results screens; all TOW screens share the same consent-aware Analytics helper. It is hidden while connecting, in the lobby and on error/disconnection screens. Private chat is never the advertising surface; the active page's primary content is the game.

The ad node stays attached across every move, bid and score update. The renderer only toggles visibility; it never recreates or refreshes the ad. Ads are requested once when near the viewport, and blocked/unfilled units hide their section. There are no sticky ads, overlays or ads inside the card table or chat panel.

Publish `ads.css` and `monetization.js` alongside the usual files. Keep their copies in sync with the other game projects when changing shared advertising behaviour, and update their `?v=` URLs as well as the release manifest. In the AdSense Google CMP settings, enable Consent Mode for advertising and analytics; keep Auto ads off for the manual layout. Analytics remains unloaded until the CMP permits analytics storage or declares it inapplicable. Unknown or unconfigured consent stays denied. The shared policy is at `../games/privacy.html`; the root `gbyrka.github.io` repository supplies `ads.txt`.

## Automated checks

Node is needed **only for development tests**, never in production. Use Node 22 or newer:

```sh
node --test tests/*.test.mjs
```

On Node 24+, to print every assertion group with the in-process reporter:

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs
```

The suite includes all fourteen requested rule/privacy checks, plus highest-bid first leads (including ties and every blind deal), round/deal scheduling, invalid moves, host permissions, disconnects, duplicate joins/actions, stale snapshots, room ID collisions, six-player limits, version mismatches, rematches, winner-only effects and waveform checks. Chat checks cover markup/control rejection, sender identity, replay/stale protection, rate limits, bounded history, late joins, room isolation, wire size and independence from game revisions/trick timers. It also simulates **40 full 12–36-hand games** with varied legal bids across all supported player counts and checks every first bidder and every recipient's card privacy at each deal.

`tests/browser-smoke.mjs` is an optional developer-only Playwright script. It requires Playwright and Chromium installed **outside the production files**, a running local static server and access to the public PeerJS Cloud. For example, if Playwright is already available:

```sh
node tests/browser-smoke.mjs
```

Or point to an external installation:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-smoke.mjs
```

`PLAN_URL` can change the tested URL; `SCREENSHOT_DIR` can change the output directory. The script uses separate browser processes, desktop and touch-sized views, and actual WebRTC payload inspection. Test-only instrumentation is never imported by the app. Screenshots and development dependencies are gitignored.

The optional `tests/browser-ui.mjs` uses the same Playwright setup to check all six-player phases with chat at 320–1920px, minimum touch-target sizes, reduced motion, inert chat rendering, drafts/focus and unread-message scrolling, the rules and scoreboard, CDN failure and an absent room.

The optional `tests/browser-assets-effects.mjs` starts its own temporary static server, deliberately caches HTML/JS/CSS for a year, changes the manifest version, and checks every module is refetched. It also checks actual Web Audio playback/muting, canvas rendering, reduced motion and the loader error/reload flow:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-assets-effects.mjs
```

`tests/browser-domain.mjs` checks HTTPS migration across all sibling repositories, so run it with the complete local workspace. It serves local files through Playwright request interception under the production hostnames; it makes no public requests and needs no web server. It covers old-domain/HTTP redirects, room codes, DOCK challenge tokens, HTTPS navigation and metadata, local previews, and the unlisted HAMSTER entry:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-domain.mjs
```

Verification on **2026-09-30** passed **56/56 Node tests** and **30/30 browser checks**: 15 real PeerJS Cloud/WebRTC checks, 8 responsive/chat/failure checks and 7 asset/effect checks. Two independent Chromium processes exchanged chat messages through Enter and Send, preserved Shift+Enter newlines and drafts/focus, rejected a forged HTML message, and completed all 12 hands. They checked every bidding opener, inspected normal/blind payload privacy, rejected an illegal follow-suit move, verified each card sounded exactly once and only winners received the celebration, finished a rematch and exercised both guest and host departures. Six-player fixtures with chat covered seven phases at eight widths (320–1920px), including inert DOM handling of XSS payloads and non-clickable URLs; scoreboard checks covered all player counts at 320px. There were no unexpected browser console errors or unhandled exceptions during the network game. This does not claim coverage of every browser or geographically separate networks.

## Connection behavior and limitations

Verification on **2026-10-08** passed **100/100 Node tests** and **51/51 browser checks**: 17 public PeerJS Cloud / Chromium PLAN checks, 17 locally signaled HAMSTER WebRTC checks, 10 responsive/browser-support checks and 7 asset/effect checks. PLAN completed all twelve hands with stable table/card nodes and the results countdown. HAMSTER verified opposing pipe traffic and retreat plus two/four-player label visibility. These checks do not diagnose every user's browser profile, extension or network configuration.

- PLAN, TOW and HAMSTER test WebRTC when the entry page loads, before loading PeerJS or creating/joining a room. The test exchanges a packet between two local, reliable data channels without camera/microphone access or an external signaling server. Missing APIs or blocked WebRTC operations produce an entry message and disable connection attempts. An inconclusive local test shows advice but still allows connection attempts, since a browser limited to TURN relays may fail the local test. Passing does not guarantee access to the CDN, public signaling service, a remote player or their network. Connection errors distinguish signaling failures from guest-to-host timeouts and explain possible extension/VPN/firewall blocks.
- A guest leaving the lobby is removed. A guest leaving during play stops the game for everyone; the host can return connected players to a clean lobby. The player count never changes inside an active hand.
- **If the host closes the tab, the game ends.** No host migration, resume-after-refresh or midgame rejoining is implemented. A rematch keeps the existing room and connections.
- Initial peer/channel connections time out after 20 seconds; the join handshake has a 15-second limit. Room code collisions retry up to five times. Pings run every eight seconds, with a 60-second dead-connection limit and a wake-up grace period.
- Losing the signaling connection does not itself kill working DataChannels. Signaling is retried with bounded delays; a status message explains if discovery remains unavailable.
- Suspended phone tabs, device sleep and unstable networks can interrupt a session. Keep the game visible and the host’s device awake.
- Internet connectivity depends on browsers, NATs and firewall policies. The pinned [PeerJS 1.5.5 defaults](https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.js) include Google STUN and public PeerJS TURN servers; no custom infrastructure or credentials are needed. TURN may relay encrypted WebRTC traffic when a direct route is unavailable; it is separate from the signaling server. **Connections cannot be guaranteed on every network** or during public relay outages. A restrictive network may require trying another network or, for a future production service, a managed TURN relay. See the [PeerJS connection caveats](https://peerjs.com/client/faq).
- Public PeerServer Cloud is not guaranteed infrastructure for a large production game. It is acceptable for this small social game, but its availability, the CDN and the configured ICE services remain external dependencies. No proprietary backend or paid service is required by this project.
- This is a friends-only room design, without accounts, passwords, durable persistence or a public matchmaking directory. Share the room code with the people you intend to play with.
- `?debug=1` logs only phases and revisions. Neither normal mode nor debug mode logs cards or raw state. The app never captures camera or microphone media.

The existing MIT license applies.
