# Catana Codex

A complete turn-based resource-trading board game for **2–4 human players**, with original terrain artwork, mouse/touch controls and an English interface. It is deliberately **unlisted** in both public game collections. Open **`/multiplayer/games/catana/`** directly; invitations use that same pathname with `?room=XXXXXXXX`.

## Run

From the multiplayer repository:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/games/catana/`. Create a room, share the invite, wait for guests to choose **READY**, and choose **START GAME**. Production continues to use the existing static GitHub Pages deployment and shared PeerJS 1.5.5 loader. No production dependency, build step, application server or database has been added. `config.json` versions all six new modules and the entry loader follows the existing subdirectory, cache-refresh and HTTPS conventions.

## Rules

The in-game **HOW TO PLAY** explains setup, costs, production, trading, development cards, the robber, awards and victory. Three or four players play to **10 VP**. Two players play to **12 VP** with the user's only other modification: a separate, authoritative two-dice roll determines every robber destination, including Knight moves. A 7 selects the desert; other totals select matching tokens. The current hex is excluded, and unavailable destinations are automatically rerolled. No neutral settlements, doubled turns or other two-player variants are added.

Terrain and tokens retain their standard distributions. The host generates the 19-hex island once at match start and validates it before publishing. Four red tokens (6/8) form an independent set of the hex adjacency graph. The coast has four general 3:1 harbors and one 2:1 harbor per resource, with distinct endpoint pairs. Every client uses the same canonical 54-vertex, 72-edge graph.

The implementation uses the rulebook's recommended combined trade/build phase for every player count. It enforces the 19-card bank per resource, 15 roads/5 settlements/4 cities per player, and the 25-card development distribution. It includes the single-recipient bank-shortage exception, card age and one-card-per-turn restrictions, a depleted-bank Year of Plenty, free-road piece limits, road interruption by opposing towns, incumbent award ties, and victory only on the winner's own turn. Hidden Victory Points are counted automatically, including cards bought on the winning turn.

Rules were checked against the [classic base rulebook and almanac](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf) and the [official base-game FAQ](https://www.catan.com/faq/basegame). All game art and the interface are original; no commercial artwork or logo is used.

## Integration and privacy

`catanaGame` supplies a game adapter to the unchanged shared `GameRoom`. The shared `StarNetwork`, room-code generator, names, player bindings, handshake, readiness, request cache, stale-revision protection, reliable WebRTC channels, connection health, private snapshot delivery, chat and sound are reused. Only one centrally validated intention envelope, `CATANA_ACTION`, was added to the existing protocol. The catalog registry is unchanged.

As in PLAN, the **host browser is authoritative and trusted**. There is no dedicated game server in this repository. Guests send intentions; the room assigns their identity from the connection and the reducer validates every rule before committing an independent cloned state. The host generates dice, shuffles cards, resolves steals, and publishes separate allowlisted views. Guests never receive opponent resource types, unplayed development IDs/types, purchase turns or development-deck order. Public scores exclude hidden Victory Points until game over. The host UI uses the same filtered view; a host can necessarily inspect its full authoritative state in developer tools.

Connection handling intentionally follows the existing turn-based room policy. Peer signaling can reconnect while established data channels continue to work. A lost player data channel stops the match with a clear interruption screen. The host can return connected players to the lobby; the disconnected player rejoins through the normal invitation and everyone starts a new match. Active seats are not silently replaced. A lost host ends the room. A normal **PLAY AGAIN** preserves the room, identities, connections and chat while creating a fresh island and supplies.

## Files

- `board.mjs`: canonical topology, randomized layouts and validation.
- `constants.mjs`: distributions, components, costs, resources and phases.
- `action-schema.mjs`: bounded game intention schemas.
- `game-core.mjs`: atomic rule reducer, legal moves, longest paths, awards and private views.
- `ui.mjs`: original SVG board/pieces, cards, forms, rules and results.
- `app.mjs`: existing room integration, accessible input, sound, chat and navigation.
- `assets/terrain-atlas.webp`: original six-terrain illustration, 1536 × 1024, generated using the built-in image tool. [Artwork prompt and provenance](ARTWORK.md).

## Checks

```sh
node --test tests/*.test.mjs
```

The Catana tests check 1,000 randomized layouts, setup and legal construction, exact costs and component limits, production and shortages, both robber modes, discard/steal, bank/harbor/player trades, every development effect, path branches/loops/cuts, award ties/transfers, hidden points and victory, message schemas and unlisted deployment. Nine complete seeded matches cover all supported player counts and conserve every resource and development card after every action. Three additional complete matches run through the real `GameRoom` with an in-memory transport, including recipient-specific snapshots, forged/stale/replayed requests, rematches, chat and disconnect/rejoin handling.

Optional browser checks require development-only Playwright, Chromium, `peer` and `peerjs` installed outside production:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PEER_SERVER_MODULE=/path/to/peer/dist/module.mjs \
PEERJS_SCRIPT=/path/to/peerjs/dist/peerjs.min.js \
node tests/browser-catana.mjs
```

The test starts temporary local HTTP and signaling servers and uses **actual WebRTC**. It plays a complete two-player match through mouse/touch UI controls and a four-player match through room intentions, inspects real channel snapshots, checks rematches and interrupted rooms, and exercises responsive views, special-action forms and connection failure screens. Screenshots go to the gitignored `test-results/catana/` directory. The existing `browser-assets-effects.mjs` also checks the updated complete module manifest and release caching.

The repository's MIT license applies to the code and original artwork.
