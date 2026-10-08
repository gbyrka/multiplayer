# HAMSTER multiplayer — Little paws. Big company.

A friendly, slightly chaotic 3D picnic for **2–4 players**. Based on the sibling HAMSTER: the same detailed furry hamster, wooden habitat, three floors, ramps, hideout, water bottle, wheel and pastel Y-shaped tubes.

**Direct entry:** `./games/hamster/`, beside PLAN and TOW. On the existing GitHub Pages deployment the path is `https://mod-it.games/multiplayer/games/hamster/`. It is intentionally absent from the public multiplayer collection and the general games catalog. Its HTML has `noindex, nofollow`. This is an unlisted game, not a password-protected site.

## Play locally

From the multiplayer repository root:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/games/hamster/`. Do not open the HTML through `file://`: this game uses versioned ES modules and WebRTC. Use HTTPS when sharing a deployed link with other devices. WebGL 2 is required; a desktop and keyboard are recommended. Touch controls are also available on touch devices. All graphics, Three.js 0.170.0, its MIT license, textures and sounds are local. No build or package install is required for production.

## Bring friends

Enter a name and select **CREATE GAME**. Copy the invite link or share the eight-character room code. Other players open the invite, enter their names and select **JOIN GAME**, then **READY**. The host starts with 2–4 ready players after their realtime channels open. The host is also a player. Room invites keep the current origin and pathname, including a GitHub Pages repository subpath.

This uses the same PeerJS 1.5.5 loader, public signaling service, secure-context requirements, reliable room channel and shared star transport as PLAN and TOW. HAMSTER has a separate `hamster-v1-` room namespace and an independent transient `hamster-state-v1` channel. Codes from other games do not open HAMSTER rooms. Guests must use the same configured application version as the host.

Keep the host's tab open. The host can pause for everyone; a hidden host tab or a long suspension pauses automatically. A departing guest returns all remaining players to a clean lobby, resetting guest readiness. Host departure ends the room. There is no host migration or mid-round joining. Results offer a rematch with the same connections, or a return to the lobby so more friends can join.

## Rules

One **180-second shared clock**, after a three-second countdown. Highest banked score wins; ties share the victory. The live scoreboard, name labels, collar colors and minimap distinguish every player.

Collect up to five shared treats. Seeds are worth **10**, carrots **20**, broccoli **30** points. Each ordinary treat respawns after collection on its original floor. There are 8, 10 or 12 ordinary treats for 2, 3 or 4 players. Only one hamster can collect a treat; simultaneous claims rotate priority between players.

Hold **Space for 0.85 seconds** to eat the whole pouch and bank its points. Eating restores 12 energy per treat. Releasing early cancels the bite. Uneaten treats score nothing when the clock ends.

- **Soft nudges:** bodies collide on the same floor, respecting the habitat walls and fixtures. Ordinary contact never spills treats.
- **Q dash:** a short forward burst costs 12 energy, with a four-second cooldown. A frontal contact pushes another hamster and spills at most one unbanked treat. The recipient gets two seconds of protection from more spills. Anyone can gather the dropped treat after a short pickup delay; it disappears after 12 seconds. Already banked points are always safe. Holding Q never repeatedly dashes.
- **Golden snacks:** every 30 seconds, six golden treats appear for ten seconds. Events rotate between the bedding, wooden loft and lookout deck. Gather them in time, then eat them for **50 points each**. There are five events in a round. A picked-up golden treat stays in the pouch until eaten or spilled.
- **Wheel:** approach its open front and tap E to enter or leave with the original walking transition. Only one hamster can occupy or approach the wheel at a time. W or S runs in either direction, restoring energy. Every five seconds of movement gives **10 points**, up to three bonuses per player per round. Leaving resets partial progress. Unlike solo HAMSTER's time bonuses, this keeps every player's round equally long.
- **Water:** face the nozzle and hold Space for 1.2 seconds to earn 2 points and restore 8 energy. A five-second cooldown follows. Drinking takes priority over eating near the nozzle and never consumes the pouch.
- **Bubble trail:** walk into a tube mouth. W moves, S curls and turns, A / D chooses the fork. You can stop and nibble inside a tube. Wheel and tube occupants are sheltered from nudges.

Running uses energy; hold Shift to walk and recover. At low energy forward movement slows to a walk. Resting and eating also restore energy. Each hamster uses the original ramp support, falling, static fixture collision, turning paws and tunnel movement.

| Key | Action |
| --- | --- |
| W / Up, S / Down | Forward / backward; tube turn; wheel direction |
| A / D, Left / Right | Steer; choose the tube fork |
| Shift | Walk and recover energy |
| Space, held | Eat all pouch contents / drink |
| Q | Dash and nudge |
| E | Enter / leave the wheel |
| H | Squeak hello |
| C | Switch camera distance |
| Escape | Host pause / resume |

## Implementation

`game-core.mjs` owns the round, shared food, collisions, snack events and scoring. `physics.mjs` adapts the solo HAMSTER movement without requiring Three.js or the DOM. `world.mjs`, `tunnel.mjs`, `wheel-transition.mjs` and `paws.mjs` preserve the original geometry and movement helpers. `scene.mjs` adapts the original procedural habitat, anatomical hamster, textured food, camera and minimap; static scenery is batched for fewer draw calls.

Only the host advances the 60 Hz simulation. Guests send bounded key masks with a round ID, input epoch and increasing sequence, at about 30 Hz. The channel's assigned slot determines their hamster. Positions, food, scores and other players' identities are never accepted from guests. Input expires after 350 ms without a fresh packet. Short Q/E/H presses use reliable, replay-protected tap intents, latched for one simulation step so they survive transient packet loss or a slow render. Snapshots travel at about 20 Hz; reliable messages also carry lobby, start, pause, resume and results. Delayed/replayed input and stale snapshot epochs are ignored.

Guests predict their own ordinary ground movement and smooth corrections; remote hamsters interpolate snapshots. Tube and wheel movement follows authoritative poses. Tube snapshots include a bounded orientation frame rather than transmitting the large fork/transition path tables. Sounds follow accepted events, are deduplicated and honor device-local mute, hidden tabs and user-gesture audio unlocking. A win sound plays only for tied or sole winners. Reduced motion disables decorative body sway and golden-treat motion. Names are rendered as plain text, including canvas labels.

Graphics render at up to 30 fps while simulation and input remain independent. Hardware GPUs use detailed fur and soft shadows. A software renderer automatically gets fewer guard hairs, simpler lighting, contact shadows and a smaller drawing buffer. Repeated tube ribs are instanced and static facial details are merged inside their animated rigs. The scene and food shaders warm up before opening a room. A three-second host stall during play pauses the match; shorter slow frames use bounded catch-up rather than teleporting the hamsters. Host visibility changes always pause immediately.

`../../config.json` versions the entire module graph and stylesheet. New HAMSTER modules are listed there but are not loaded by the public collection, PLAN or TOW. Publish this game with the whole multiplayer repository; it has no dependency on the separate solo HAMSTER deployment. The existing consent-aware helper manages one persistent footer ad below the game. No ad overlaps the canvas or the controls.

## Checks

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs
node --test --test-isolation=none --test-reporter=spec tests/hamster.test.mjs
```

The HAMSTER suite checks supported player counts, seeded food, original ramps and all six tube routes, atomic collection, full-pouch eating and interrupted bites, drinking/cooldown, height-aware contacts, protected spills, dash costs/cooldowns, shared snack events, exclusive wheel entry and bonuses, timed results/ties, snapshot validation, input ownership/replay, prediction, host-only room lifecycle, direct-only entry and module versioning.

Optional Playwright checks use a local PeerServer to exercise actual WebRTC channels in separate Chromium processes, including separate GPU contexts to approximate separate devices. Playwright, Chromium, PeerServer and PeerJS are development dependencies installed outside this repository:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PEER_SERVER_MODULE=/path/to/peer/dist/module.mjs \
PEERJS_SCRIPT=/path/to/peerjs/dist/peerjs.min.js \
node tests/browser-hamster.mjs
```

The test captures actual channel packets, tests 2–4 players and the fifth-player rejection, and uses controlled host fixtures for scoring, nudges, snack events and the end of a round. It also checks pause/resume, ties, rematches, departures, inert names, responsive layout, mute and entry errors. Screenshots are saved to the gitignored `test-results/hamster/`. No test hooks are shipped in the app.

Verified on 2026-10-08: all 97 repository unit tests, all 14 HAMSTER browser scenarios and all 7 shared browser asset/effect checks passed. Browser layout checks cover 320–1440px widths, including the canvas and minimap bounds. The original solo HAMSTER repository remains unchanged.

Artwork and geometry originate in the sibling HAMSTER project. The existing MIT license and included Three.js license apply.
