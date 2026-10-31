# Boggle — Good words. Good company.

An **unlisted** word game for **2–6 friends** or **solo practice**, available directly at
`/multiplayer/games/boggle/`. Neither public catalog includes it; the entry
uses `noindex, nofollow`. Knowing the link is sufficient to open it: unlisted
does not mean password-protected. No deployment or public catalog change is
required to test it locally.

The previous `/multiplayer/games/word-trail/` URL redirects here and preserves
room invitation parameters and fragments.

From the `multiplayer` directory, run `python3 -m http.server 8080` and open
<http://localhost:8080/games/boggle/>. Use HTTPS on other devices. As with the
other games, PeerJS 1.5.5 supplies reliable WebRTC connections and rooms need no
account or application server. Leave the host's tab open and devices awake.

## Play

Choose **PLAY ALONE** on the create screen for a local practice session, then
adjust the settings and press **START**. This mode does not load PeerJS or
connect to signaling/other players; it works even when WebRTC is unavailable.
It uses the same dictionaries, deadlines, scoring and longest-word results as
multiplayer. Rematches remain solo and immediately allow another start.

The header's **MOBILE TYPING ON/OFF** switch saves a preference on this device.
It defaults to off, so touch-only phones are not asked to open their keyboard
when a round begins. Turn it on when using a Bluetooth keyboard: each round
focuses the word field automatically, and typing a letter outside another form
field restores word input. Chat, other editable fields and open dialogs retain
their own keyboard input. Turning this on may open a phone's on-screen keyboard;
desktop auto-focus is unchanged. The shared MoD-IT logo and Grzegorz Byrka's
LinkedIn author credit are shown in the header and footer.

Create a room, share its invitation, and have guests choose Ready. The host can
choose Polish or English (UK + US), board size **4×4 / 5×5 / 6×6**, minimum word
length **3 / 4 / 5**, round duration **1 / 2 / 3 minutes**, and **1 / 3 / 5 rounds**.
Defaults: Polish, 4×4, 3 letters, 3 minutes and 3 rounds. Saving settings resets
guest readiness. A four-second countdown hides the board until play begins.

- **Keyboard:** type a word and press Enter. Its first found path is highlighted.
  Validation on the host accepts any valid path, including repeated letters on
  different tiles. The input supports Polish characters and Unicode NFC.
- **Mouse or touch drag:** follow neighboring tiles, then release to submit.
- **Tap or accessible tile buttons:** select a trail, then choose Add word.
  Moving to the immediately previous tile undoes one step. Clear or Escape resets
  the selection. Canceled gestures never submit.
- Neighbors include diagonals; a tile is used at most once per word. Each tile
  holds one letter (Q is a single letter, with no special Qu tile).
- Each inflected spelling counts separately. No maximum length beyond the board.
  Dictionary policies and attribution: [data/README.md](data/README.md).
- Classic unique-word scoring: 3–4 letters = 1 point, 5 = 2, 6 = 3, 7 = 5,
  8+ = 11. A word found by more than one player scores zero for everyone. Raising
  the minimum does not change points for longer words. Each player can submit
  up to 250 distinct accepted words per round.
- Submissions are private until the round ends. The results reveal accepted
  words, canceled shared words, per-round points and cumulative totals.
- After each round, show up to five **equally longest** possible dictionary
  words, their exact paths and who found them; no full list of solutions is
  displayed. The host can start the next round after three seconds.
- Highest cumulative total wins; ties share victory. A rematch reuses the room
  and chat, resets scores and asks guests to ready up again.

## Architecture and limits

The existing `GameRoom`, private views, PeerJS transport, chat, synthesized sound,
consent-aware Analytics and About/sponsor dialog are reused. No bitmap assets,
fonts or frontend dependencies are added. The local dictionary graphs are
prepared offline and shipped with the game. Only the host downloads a dictionary,
in a module worker; dictionary/worker failure leaves the lobby available to retry.
All possible words and one path each are solved **before** the countdown.

The host browser is authoritative, as in the other games. It enforces readiness,
settings, the monotonic deadline, dictionary membership, board paths, duplicates
and points. A dishonest host can inspect its own memory; this is a friends-only
game, not an anti-cheat service. Only the board and each recipient's own accepted
words are transmitted during play. The host's own UI uses the same privacy view.
The board and solutions stay hidden during the countdown.

Simultaneous submissions can arrive with an earlier valid revision; a game-owned
concurrency policy opts in only `BOGGLE_ACTION/SUBMIT`. The round token and
host deadline prevent accepting late or previous-round words. Replay and schema
validation remain shared. Turn-based games keep their existing revision checks.
Result snapshots have a game-specific 256 KiB limit to accommodate six players'
bounded word lists; inbound intents retain the existing 1–2 KiB limits and rate
limits. Other games retain their original snapshot limits.

Timers use `performance.now()` and absolute host deadlines, so submissions and
chat cannot extend a round. Clients display a remaining duration, not the host's
clock. Network latency can make their display slightly late: a word must **reach
the host** before the deadline. A throttled host may publish results late, but
cannot accept words after the deadline. A guest disconnect stops the game; the
host can reopen a clean lobby with remaining connected players. Host migration,
refresh recovery and midgame joining are not supported.

Current browsers with WebRTC, import maps, module workers and `DecompressionStream`
are required. Dictionary coverage is versioned, not exhaustive. The broad English
lists include rare vocabulary; Polish removes historical-only meanings but keeps
contemporary regional, colloquial and technical entries. See data policies before
changing filters. Keep data license notices when distributing the game.

## Checks

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs
```

`tests/boggle.test.mjs` verifies real dictionary contents, graph integrity,
board traversal, long words, minimum lengths, permissions, privacy, deadlines,
scoring, longest paths, rematches, disconnects and snapshot size.
`tests/boggle-room.test.mjs` uses actual GameRooms with an in-memory transport
for two and six players, concurrent/replayed/forged intents and private views.

The optional browser test uses Chromium, a local PeerServer and actual WebRTC:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PEER_SERVER_MODULE=/path/to/peer/dist/module.mjs \
PEERJS_SCRIPT=/path/to/peerjs/dist/peerjs.min.js \
node tests/browser-boggle.mjs
```

Dependencies are development-only and may be installed outside the repository.
No external signaling or advertising requests are needed by the browser test.
It tests production dictionary workers, keyboard, mouse and touch controls,
responsive layouts from 320px to 1440px, shared words, longest paths, three rounds,
rematch, Polish accents and disconnects. A test-only adapter shortens countdowns
and advances deadlines; no fixture hooks are shipped in production modules.
Screenshots go to the gitignored `test-results/boggle/` directory.

For the extended phone/tablet audit, set `BOGGLE_DEVICE='Pixel 7'` or
`BOGGLE_DEVICE='iPad (gen 7)'`. Add `BOGGLE_ENGINE=webkit` to check the
WebKit engine, and optionally `BOGGLE_FIRST_SIZE=5` to exercise 5×5 before
the final 6×6 game. The audit checks 15 portrait/landscape sizes (320–1180px),
minimum 44×44px tiles contained in the board, at least 16px form text, a whole board fitting in a
landscape viewport, and focus/drafts in a reduced keyboard viewport. Chromium
also injects real touch streams, including a fast swipe over intermediate tiles
and cancellation. WebKit covers native taps and shared pointer dragging; CDP
touch-stream injection is Chromium-only. These are automated device simulations,
not tests on physical iOS/Android hardware or a native on-screen keyboard.
