# CHECKERS — A table for two

Two-player checkers at `./games/checkers/`, deployed as `https://mod-it.games/multiplayer/games/checkers/`. It is linked from the sibling games catalog and omitted from the multiplayer collection; its HTML retains `noindex, nofollow`. No clock is offered or accepted by the protocol.

The layout, board perspective, selection, highlight colors, compact lobby and panel behavior match CHESS. The full-window layout uses CHESS's stylesheet as an explicitly versioned base and adds local counter/capture styles. Each player sees their pieces nearest them. Original shaded SVG counters replace chess pieces, and kings are double-stacked with a crown mark. The host chooses White, Black or random colors; White always starts. Saving settings resets guest readiness, and a rematch reuses the room/chat while returning to the lobby.

## Play locally

Serve the multiplayer repository root:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/games/checkers/`. Create a table, share its link or eight-character code, have the guest choose Ready, and start as host. Production is static HTML/CSS/ES modules without installation or a build step. Keep the host tab open; a disconnect stops the match, and the host can reopen the lobby for a replacement. Rooms use the separate `checkers-v1-` namespace and the shared authoritative GameRoom, PeerJS transport, revision and replay checks.

## Rules used here

This is an **8×8 Brazilian-style** game, with 12 pieces per side, based on the capture and promotion principles in the [official draughts-64 rules, including the Brazilian section](https://www.fmjd.org/downloads/64cb/Official_Rules_of_the_game_in_64_classic_draughts.pdf). The in-game rules state this variant explicitly.

- Only dark squares are playable. Men move one diagonal square forwards.
- **Capturing is compulsory across the whole board.** If any piece can capture, quiet moves and pieces without a valid capture are unavailable.
- Men capture both forwards and backwards. Kings move along an unobstructed diagonal and capture one opposing piece at a time, landing on an empty square beyond it.
- **The sequence taking the largest number of pieces must be chosen.** Any equal-length maximum is allowed; a captured man and king each count as one. The server validates every hop against the complete remaining sequence.
- Continue with the same piece until all required jumps finish. Selection stays locked to it, the next destinations appear automatically, and the UI says **CONTINUE CAPTURE**. There is no End Turn shortcut.
- Captured pieces stay on the board as faded blockers until the sequence is complete, then disappear together. A piece cannot be captured twice or crossed again; empty squares, including the starting square, may be revisited.
- A man is crowned only if its **completed turn ends** on the opposite back rank. Passing through that rank during a capture does not give king powers mid-turn.
- A player loses when they have no pieces **or no legal move**. No-move positions are losses, unlike chess stalemates. Resignation and draw offers are available in Table controls.

Casual draw handling: the third occurrence of the same completed position with the same side to move is a draw. So are 25 moves per player (50 plies) by kings only, without a capture or a man moving. Tournament-specific limited-material draw counts and arbitration are not implemented. Partial capture positions are not counted as repetitions, and a blocked-player win takes precedence.

`rules.mjs` searches legal sequences with memoization keyed by moving square and already-jumped pieces. It keeps victims as blockers and sends only the valid **next steps**, not entire path trees. `game-core.mjs` locks a partial chain, binds moves to the current player's color, removes victims atomically, and builds independent player views. Message history is bounded to the latest 80 completed plies. Captures update the board after each hop; a complete chain becomes one history entry.

## Chat, analytics and advertisements

The persistent room chat preserves drafts/focus through updates and between games. Chat, history and table controls share the desktop sidebar or mobile drawer. Long messages/history scroll within their panel; the game page stays in the viewport. No test hooks are exposed by the production app.

The shared local `monetization.js` supplies Google Analytics **G-WTPHWDLQ7K**, subject to the same Google CMP consent handling as the other multiplayer games. Pre-consent/denied events are discarded. `game_start`/`game_end` carry only the game name and ending, without room codes, names, board positions or chat. The `game_footer` placement (`9380002810`) is in **About & sponsors**, outside the playing area and requested only when opened. Blocked/unfilled ads do not affect the board.

## Prepared artwork

[Artwork masters and the exact built-in image-generation prompts](../../marketing/BOARD-GAMES-PROMPTS.md) cover both games and the chess LinkedIn campaign. The checkers/chess covers have ready-to-use 1200px JPEG and 600/1200px WebP copies in both repositories. The sibling games catalog uses these covers for its CHESS and CHECKERS cards. The direct pages have static Open Graph images for link sharing. No artwork generation is required to run or publish the game.

## Tests

```sh
node --test --test-isolation=none tests/checkers.test.mjs tests/checkers-room.test.mjs
```

These cover global compulsory/maximal capture, backward captures, flying king landing choices, continuation locking, victim blocking, capture loops, end-of-turn promotion, wins/draws, random colors, invalid payloads, stale/replayed requests, room chat, disconnects and seeded complete matches.

Optional browser test, with separately installed Playwright/Chromium, `peer@1.0.2` and `peerjs@1.5.5`:

```sh
node tests/browser-checkers.mjs
```

Dependencies outside the repo can be selected through `PLAYWRIGHT_MODULE`, `PEER_SERVER_MODULE` and `PEERJS_SCRIPT`. `SCREENSHOT_DIR` overrides `test-results/checkers`. Tests run actual PeerJS/WebRTC through a local signaling server, use mouse and touch, verify both perspectives, complete forced capture sequences, promotion and rematches, and check full-window layouts on 11 sizes including 568×320 landscape and 320×480 portrait. Google scripts are stubbed; no real ad/analytics requests run during validation.
