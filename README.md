# Multiplayer — good games, good company

A small collection of browser games to play with friends. **PLAN — Predict your tricks.** is the first game; the collection menu is ready for more games.

PLAN is a complete, silent, turn-based card game for **2–6 players**, including the host. It works with a mouse or touch, on desktops, tablets and portrait phones down to 320px. Everything in the interface is in English. Cards are drawn with HTML/CSS; there are no external images, fonts, frameworks or sound assets.

**Preview:** a dark emerald card table, cream and gold details, white playing cards, a lobby with an invite link, mobile player tiles, bidding controls and a six-hand scoreboard. Running the optional browser test saves screenshots in `test-results/`.

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
6. Bid in turn, then click/tap the enabled cards. The table keeps completed tricks visible briefly. Review the results; only the host can choose **NEXT HAND**.
7. Play through 5, 4, 3, 2, 1 cards and the blind finale. In the last hand, your card is a back and your opponents’ cards are face up. Choose **PLAY MY CARD** on your turn.
8. Check the final scores and choose **PLAY AGAIN** as host. The same room and connections are reused.

Keep the host’s tab open and devices awake throughout the game. When testing other devices, open the deployed HTTPS site rather than sending them a `localhost` link.

## Publish on GitHub Pages

This **`multiplayer/` directory is the root of the `gbyrka/multiplayer` repository**. Publish its contents, including `index.html` at the repository root; do not wrap them in another `multiplayer` directory.

1. Commit and push the files to the `main` branch of that repository.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Select **main** and **/(root)**, then save.
5. Open the URL GitHub provides, normally `https://gbyrka.github.io/multiplayer/`.

There are no GitHub Actions or build dependencies. `.nojekyll` is included. Asset URLs are relative (`./style.css`, `./app.mjs`); invite URLs use `window.location.origin` and `window.location.pathname`, so subdirectory deployment and custom domains work. Invites look like `?room=K7PX4M9Q&game=plan`.

This implementation does not automatically commit, push or change your GitHub Pages settings.

## Rules

- A game has exactly **six hands: 5, 4, 3, 2, 1, then 1 blind card** per player.
- A fresh 52-card deck is shuffled for every hand. Cards are dealt clockwise after the dealer. The next undealt card sets trump and is not played. Ace is high.
- Join order fixes seats. The first dealer is random and the dealer advances clockwise after every hand.
- Bid from zero to the number of cards in the hand, starting after the dealer. **Total bids cannot equal the number of available tricks**; this restricts the last bidder.
- The player with the **highest bid leads the first trick**, including in the blind hand. If several players share the highest bid, the one who bid earlier leads. If everyone bids zero, the first bidder leads.
- Follow the lead suit if you have it; otherwise play any card. Highest trump wins, or highest lead-suit card if there is no trump. The trick winner leads the next trick.
- An exact prediction earns **10 + bid** points. A miss loses **abs(bid − tricks won)** points. Bid 2/win 2 gives +12; bid 3/win 1 gives −2.
- The host advances after each hand’s results. Scores accumulate; the highest total wins. Equal highest totals are a **tie**.
- In the blind finale, you see everybody else’s one card but cannot see your own. Trump and bidding rules are unchanged. Your card becomes public when you play it.

The in-app **HOW TO PLAY** explains all rules and examples in short sections. **SCOREBOARD** shows PLAYER, H1–H5, BLIND and TOTAL and scrolls locally on narrow screens.

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

Dealing is an atomic host operation immediately before bidding. A host-only timer holds completed tricks for 2.2 seconds. Hand results wait indefinitely for the host. Timers are cancelled on disconnection or room closure and are guarded against stale state.

## Shared code and adding another game

```text
index.html                 Static shell, accessible dialog and announcements
style.css                  Collection, shared UI and responsive PLAN table
app.mjs                    Navigation, input, dialogs and session lifecycle
favicon.svg                Local vector icon
shared/
  random.mjs               Crypto randomness, room codes and name validation
  protocol.mjs             Central protocol, schemas, replay/revision helpers
  peer-loader.mjs          Pinned CDN loader and graceful failure
  network.mjs              Game-independent STAR transport and health checks
  room.mjs                 Connections → identities → authoritative adapter
  dom.mjs                  Safe DOM/card builders and shared instructions
  screens.mjs              Collection, game entry, lobby and connection screens
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
  browser-smoke.mjs        Optional real PeerJS Cloud / WebRTC browser test
  browser-ui.mjs           Responsive fixtures and connection failure screens
.nojekyll
.gitignore
README.md
LICENSE
```

Register another game in `games/registry.mjs` with a unique ID and PeerJS namespace. Supply an adapter with `createLobby`, `addPlayer`, `removePlayer`, `applyAction`, `buildViewForPlayer` and `automaticTransition`, plus game/rules/scoreboard rendering functions. Reuse the transport, room binding, invites, lobby, dialog and menu. Add any new intent schema to the centralized protocol. Game rules must stay independent of DOM and transport. The initial lobby policy (2–6 players and ready guests) is implemented in the adapter and can be reused or adjusted for a future game.

## Automated checks

Node is needed **only for development tests**, never in production. Use Node 22 or newer:

```sh
node --test tests/*.test.mjs
```

On Node 24+, to print every assertion group with the in-process reporter:

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs
```

The suite includes all fourteen requested rule/privacy checks, plus highest-bid first leads (including ties and the blind hand), invalid moves, host permissions, disconnects, duplicate joins/actions, stale snapshots, room ID collisions, six-player limits, rematches and 40 full randomly dealt games with varied legal bids across all supported player counts.

`tests/browser-smoke.mjs` is an optional developer-only Playwright script. It requires Playwright and Chromium installed **outside the production files**, a running local static server and access to the public PeerJS Cloud. For example, if Playwright is already available:

```sh
node tests/browser-smoke.mjs
```

Or point to an external installation:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-smoke.mjs
```

`PLAN_URL` can change the tested URL; `SCREENSHOT_DIR` can change the output directory. The script uses separate browser processes, desktop and touch-sized views, and actual WebRTC payload inspection. Test-only instrumentation is never imported by the app. Screenshots and development dependencies are gitignored.

The optional `tests/browser-ui.mjs` uses the same Playwright setup to check all six-player phases at 320–1920px, minimum touch-target sizes, reduced motion, the rules and scoreboard, CDN failure and an absent room.

After the first-leader rule correction, **42/42 Node tests passed**, including 40 complete simulated games and a host/guest synchronization check for the bidding winner. Initial browser verification on 2026-09-28 passed **12/12 real-network checks** using two independent Chromium processes and public PeerJS Cloud, plus **6/6 UI/failure checks**, including seven six-player phases at eight viewport widths. That browser run completed all six hands, rejected an injected illegal follow-suit move, inspected normal/blind payload privacy, completed a rematch and exercised both guest and host departures. There were no unexpected browser console errors. This is not a claim of testing every browser or two geographically separate networks.

## Connection behavior and limitations

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
