# Scrabble

Unlisted, direct-entry browser game for **2–4 players** or **solo score practice**.
Prepared canonical URL: <https://mod-it.games/multiplayer/games/scrabble/>.
No catalog, homepage, registry card or sitemap entry was added. The entry page
has `noindex,nofollow`. This change does not deploy or publish the game.

From the parent workspace, serve locally:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://localhost:8765/multiplayer/games/scrabble/>. For other devices,
serve over HTTPS. Keep the host tab open and devices awake throughout a game.

## Controls

- Select the first square with a mouse or touch. Select it again, use the
  direction button, or press Space in the word field to switch across/down.
- Type the **complete word**, including existing letters. For `. O .`, typing
  `KOT` uses the fixed O and places K and T from the rack. A conflicting fixed
  letter, missing tile or board boundary produces an explicit preview error.
- Preview tiles, consumed rack tiles, every new word and the combined score are
  visible before committing. Enter plays, Backspace edits, Escape/Clear discards
  the draft. The ordinary text input supports Polish AltGr and composed text.
  Its `inputmode=none` avoids a software keyboard covering the tablet board.
- Ordinary tiles are allocated first; missing letters can use blanks. The
  **Blanks** dialog lets you explicitly spend a blank at a particular new square
  while retaining the matching ordinary tile. Blanks have a dot and remain zero
  points on later turns. Selecting their represented letter is done by typing it
  in the complete word.
- Rack tiles can append letters to the word; Shuffle changes only their visual
  order. Exchange mode selects rack tiles rather than appending letters.
- Keyboard shortcuts apply only inside the word field; chat, settings and
  dialogs retain normal keyboard behavior. Native Tab and text selection work.

The primary layouts are computers and tablets with a physical keyboard. The
landscape board and editor fit standard laptop/tablet viewports. Narrow screens
stack the sidebar; phone software-keyboard play is not a target of this release.

## Rules and settings

- Standard symmetric 15×15 premium layout, seven-tile racks, two blank tiles,
  and separate 100-tile Polish and English distributions/letter values.
- Random starting player, clockwise player order, drawing back up to seven
  after a play. All new tiles lie in one continuous row or column, with existing
  tiles allowed to fill gaps. Opening play covers the centre; later plays must
  touch the existing board orthogonally.
- Every newly formed horizontal/vertical word, of at least two letters, must be
  in the selected dictionary. Automatic validation, with no challenge phase.
- New DL/TL squares multiply letter values; new DW/TW squares multiply word
  scores. A new premium can apply to both crossing words, and multiple word
  multipliers combine. Occupied premiums never apply again. Seven new tiles add
  50 points after scoring all words. A zero-valued blank still activates DW/TW.
- Exchange any selected owned tiles only with at least seven in the bag. Draw
  replacements **before** returning and shuffling exchanged tiles into the bag.
- No clock by default, presets 30/60/120/180 seconds, or a whole-number custom
  limit of 1–3600 seconds **per move**, including solo. Expiry discards the draft
  and records an automatic pass. Invalid actions, typing, settings attempts and
  chat do not reset or pause time. The host checks the deadline on every action,
  even if background-tab throttling delays the automatic callback. The next turn
  receives a fresh full limit when the host advances it; missed turns are not
  retroactively consumed after device sleep.
- Empty bag plus empty rack ends play. Six consecutive turns without points
  (including passes, exchanges and timeouts) also end play. Unused rack values
  are deducted. In multiplayer, a player going out gains the others' unused
  values. Highest final score wins, with shared ties. Solo is a sequence of
  self-played turns on one board, and also has an End practice action.

General scoring reference: [Hasbro's rules](https://instructions.hasbro.com/en-gb/instruction/scrabble-game).
Per-move timeout passes and the explicit six-scoreless-turn limit are the rules
chosen for this browser edition, rather than a claim of tournament compliance.

## Dictionaries and architecture

Shares Boggle's pinned SGJP Polish and SCOWL/ESDB English (UK + US) dictionary
binaries and immutable word-graph reader. Both include two-letter words and
inflections. See [sources, filtering and licenses](../boggle/data/README.md).
These are **not official tournament Scrabble word lists**. Source license links
are preserved in the About dialog; no dictionary files were duplicated.

Each participant loads its selected dictionary locally for the draft preview.
The host independently validates submitted placements against its own loaded
dictionary and rack state. No word lookups are sent to an external API. The
dictionary is cached per language in the current page; failure allows retry.

Uses `GameRoom`, PeerJS/WebRTC, `ChatPanel`, `GameSound` and Boggle's local
`SoloSession`. Solo never loads PeerJS or contacts signaling. The host alone
owns the bag and other players' racks; per-player snapshots contain only their
own rack, opponents' tile counts and the public board/history. Full racks are
revealed at the result screen's data boundary. Drafts remain local. As in the
other peer-hosted games, the host is trusted and can inspect their own memory.
Player disconnects stop the game. The host may reopen a lobby with the connected
players. No mid-game reconnection, refresh recovery or host migration is added.

`SCRABBLE_ACTION` adds a bounded schema to the shared protocol. Turn serials,
bound sender identities, state revisions, deadlines and request IDs prevent
late, out-of-turn, forged or replayed moves. The snapshot limit is 128 KiB for
this game only; history retains the latest 100 turns. Other games' limits and
concurrency policies are unchanged.

## Validation

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs

PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PEER_SERVER_MODULE=/path/to/peer/dist/module.mjs \
PEERJS_SCRIPT=/path/to/peerjs/dist/peerjs.min.js \
node tests/browser-scrabble.mjs
```

Development dependencies only: Playwright 1.58.0, peer 1.0.2, peerjs 1.5.5.
No package installation or build is required to serve the game. The browser
test starts local HTTP/signaling servers and uses real WebRTC. Deterministic
racks and a short test deadline are injected by the test harness; production
modules contain no test hooks. Screenshots go to gitignored
`test-results/scrabble/`. Set `SCRABBLE_ENGINE=webkit` for the WebKit run.

Tests cover real PL/EN dictionaries, scoring, cross words, blank choice, forged
placements, private racks, four participants, rematches, clocks, rack exchanges,
keyboard/touch input, Polish text, chat, disconnect and desktop/tablet layouts.
Tablet checks simulate touch plus hardware text input; they are not physical
iPad/Android device tests.

## Artwork

LinkedIn image: [scrabble-linkedin.png](../../marketing/scrabble-linkedin.png).
Only the title and full canonical URL accompany the letter-board illustration.
[Exact imagegen prompt](../../marketing/SCRABBLE-PROMPT.md).
