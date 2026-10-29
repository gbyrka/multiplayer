# CHESS — A table for two

Two-player browser chess at `./games/chess/`, published as `https://mod-it.games/multiplayer/games/chess/`. It is listed in both catalogs and is indexable. Anyone with the direct link can also open it.

From the multiplayer repository root, run `python3 -m http.server 8080` and open `http://localhost:8080/games/chess/`. There is no build step, package installation or runtime chess CDN. Publish the whole repository, including the new modules in `config.json` and the local vendor files.

## Bring an opponent

Enter a name, choose **CREATE A TABLE**, and share the invite link or eight-character room code. The host chooses White, Black or random colors, and either no clock or **1–180 whole minutes per player**, with no increment. Save settings before starting. Saving settings resets the guest’s ready status so the guest can confirm the current setup. White always moves first; random colors are drawn at each start. A rematch returns both players to the same lobby, retaining the settings and chat and requiring the guest to become ready again.

The lobby and playing view fit the viewport without page scrolling, including short laptop screens and phones in either orientation. The board scales to the available width and height and is slightly tilted, with shaded original SVG pieces and a warm wood frame. Movable pieces have high-contrast gold frames with dark edges, visible around ivory pieces on pale squares. Each player’s pieces are nearest them; coordinates and input rotate with the perspective. Only pieces with at least one legal move are lit on the active player’s turn. After selecting one, only its legal destinations are marked; captures have rings. Select the piece again, choose Cancel or press Escape to clear a selection. Mouse, touch and keyboard-activated square buttons work. Pawn promotion presents four explicit choices. A red king square and a prominent CHECK message explain checks. CHECKMATE and STALEMATE have distinct final status panels, as does a timeout.

## Rules and clocks

The locally vendored [chess.js 1.4.0](https://github.com/jhlywa/chess.js/tree/v1.4.0), under its [BSD 2-Clause license](vendor/LICENSE), validates all moves, including king safety, castling, en passant and underpromotion. `vendor/chess.mjs` is the release’s ESM distribution with its unavailable source-map comment removed. The unmodified copyright/license is preserved. `ui.mjs` contains original vector artwork; there are no external fonts or art assets.

The host’s reducer decides every move and result. Positions retain castling/en-passant rights and repetition counts. It detects check, checkmate, stalemate and insufficient material. Fivefold repetition and the 75-move rule end automatically; a player on move can claim a draw when the current position has occurred three times or after 50 moves per side without capture/pawn movement. Intended-next-move draw claims and general tablebase/dead-position analysis are not implemented. Players can offer/accept/decline a draw or resign.

The host uses a monotonic clock, charges only the player on move, and schedules an automatic timeout even if no player acts. A move arriving after the deadline cannot escape a timeout. Both clients animate remaining time from the latest host snapshot, independent of their wall clocks; network transit can create a small display difference, and the host confirms the final result. Illegal moves, selections, promotion choices, chat and draw offers do not pause or reset time. Hidden tabs continue using elapsed time. Keep the host’s browser open and device awake. As with the other games, the host is trusted and can inspect or alter their own browser state; this is casual peer-to-peer play, without tournament anti-cheat guarantees.

Timeout/resignation is drawn when the opponent has only a king or the supported insufficient-material cases make mating impossible. Some unusual dead positions are beyond chess.js’s material detection. Mate takes precedence over the 75-move draw on the mating move. Disconnecting stops the game and freezes its clock. The host can reopen the lobby and invite a replacement; there is no mid-game reconnect, host migration or saved game restoration.

## Networking, chat, advertisements and analytics

CHESS reuses `GameRoom`, the shared star transport and the persistent `ChatPanel`, with namespace `chess-v1-`. Only two players may join. `CHESS_ACTION` has a small explicit schema; the host checks bound identity, turn, legal moves and settings permissions. Existing revision and replay checks apply. Board snapshots are public, and history sent to clients is bounded to the latest 80 plies. The authoritative state retains full repetition information. No chess engine or board modules load when browsing the collection; the shared protocol only imports the small action schema.

Room chat retains drafts and focus through board updates and remains available between games. Chat, move history and table controls share a tabbed desktop sidebar. On smaller or shorter screens, the same panels open as a bounded drawer above the board, with Escape and a close control; long message/move histories scroll inside their panel. Names/messages use text nodes. The single `game_footer` advertising placement (`9380002810`) is in the separate **About & sponsors** dialog, requested when that dialog opens. It cannot enlarge or displace the playing area. Unavailable or unfilled ads hide without affecting the board.

`../../monetization.js` supplies Google Analytics `G-WTPHWDLQ7K` and the same consent behavior as PLAN, TOW, HAMSTER and Catana. Analytics loads only after Google CMP allows it; pre-consent/denied gameplay events are discarded. Chess emits `game_start`/`game_end` with the game name, clock presence and ending, without names, messages, room codes or positions. Keep AdSense/CMP configured for the existing domain as described in the parent README.

## Validation

```sh
node --test --test-isolation=none tests/chess.test.mjs tests/chess-room.test.mjs
```

These exercise legal move filtering, pins/check, castling, en passant, four promotion choices, mate/stalemate, repetition and move-count draws, host settings, color assignment, clock expiry, disconnects, authoritative two-room synchronization, malformed/stale/replayed actions and chat.

The optional real-browser test needs Playwright, its Chromium installation, `peer@1.0.2` and `peerjs@1.5.5` installed separately. Production has no dependency installation. The test serves both sibling repositories locally and stubs Google scripts so it sends no real analytics/ad requests:

```sh
node tests/browser-chess.mjs
```

For dependencies outside the repository, set `PLAYWRIGHT_MODULE`, `PEER_SERVER_MODULE` and `PEERJS_SCRIPT` to absolute entry-file paths. `SCREENSHOT_DIR` overrides `test-results/chess`. It covers actual PeerJS/WebRTC, both perspectives, settings, clocks, check/mate/stalemate, special moves through the UI, touch, chat drafts, 320–1440px layouts, 320–1024px viewport heights, no page scrolling in lobby/play/check/end/promotion states, drawer navigation, unsaved settings preservation, separate sponsors dialog and Analytics/consent on all multiplayer entries. Position fixtures and room references are injected by the test; the production app exposes no test API.
