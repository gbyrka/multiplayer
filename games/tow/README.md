# TOW — Keep your trailer close.

Public online multiplayer trailer racing for **2–4 drivers**: **https://mod-it.games/multiplayer/games/tow/** after publishing the repository. Both the multiplayer collection and the main games catalog link directly to it. The entry page is indexable and has its own canonical URL, Open Graph and Twitter metadata.

**Keyboard controls only for now.** Public cards, the entry/lobby and the social artwork clearly communicate the current supported input. The existing experimental touch controls remain available; they are not advertised as supported mobile gameplay.

Run from the `multiplayer/` directory with `python3 -m http.server 8766 --bind 127.0.0.1`, then open **http://localhost:8766/games/tow/**. For separate devices, use the published HTTPS address. The host creates a room, shares its invite link or eight-character code, and starts once all guests choose **READY**. The host can start with two, three or four players; a fifth driver and arrivals during a race are rejected.

The game uses PARK's original Canvas vehicle artwork and arrow-key/Space controls. A faster car pulls a white trailer through a seeded winding road with dense groups of barrels and crates at the edges, inside lanes and in the centre. Each group leaves room to pass with a trailer, with clearance to change sides between groups. Every rematch gets a new seed. Follow the arrows, cross the checkpoints in order, and take the entire trailer across the finish. Routes are 24,000–29,000 game units long; automated runs that steer around obstacles complete within 1–3 minutes. Collisions and recovery make player times longer. The race ends after all drivers finish, four minutes of racing, or one minute after the first finish. An unfinished racer is marked DNF.

- **Up / Down:** accelerate, brake before changing direction, then reverse.
- **Left / Right:** steer. **Space:** brake with priority over acceleration.
- **H:** hold the horn; a touch horn button is provided on phones. Other drivers hear it at their vehicle's distance.
- **R / RESET:** return to the last reached checkpoint with a three-second time penalty, at most once every eight seconds. The host selects a clear spawn position.
- **Escape / PAUSE:** host pauses all cars and the race clock. Hiding the host's tab also pauses. The host must choose **RESUME RACE**. A guest leaving their tab releases driving controls; missing inputs make their car brake.
- Touch devices have simultaneous steering, accelerator, reverse and brake buttons.

The soundscape is synthesized locally with Web Audio: four-cylinder combustion and intake/exhaust noise follow speed, throttle and automatic gear changes; tyres squeal during fast turns, sideways slip and hard braking. Rolling tyres, wind, trailer hitch rattles and a quiet reversing signal accompany the drive. Dual-tone horns can be held with H. Countdown, start, checkpoint, reset and finish signals provide feedback. Impacts follow the host's collision impulses and sound different for curbs and vehicle bodies. All cars are audible, with each other car fading with distance, moving in stereo and changing pitch slightly when passing. These are original procedural sounds, not downloaded recordings.

**SOUND ON / SOUND OFF** mutes the local mix and remembers the preference. Browser audio starts after a click/tap/key press. Pause, hidden tabs and leaving stop the sounds, and returning does not replay old effects. Horn press/release travels reliably with a timeout for lost releases; host collision events have IDs and are briefly repeated in snapshots so packet loss and prediction replay do not produce duplicate impacts.

Room discovery uses the same on-demand PeerJS 1.5.5 loader, public signaling service and star topology as PLAN, in an independent `tow-v1-` namespace. Reliable messages handle joining, readiness, race start/pause/reset/results. Each guest has a separate native WebRTC DataChannel on their peer connection carrying transient input and snapshots, with `ordered: false, maxRetransmits: 0`. No new production service, dependency, backend or bundler is needed; network reachability has the same ICE/service limitations as PLAN.

The host runs shared rigid-body physics at 120 Hz and sends snapshots at about 20 Hz. Cars and trailers have mass, angular velocity, tyre grip, impulse collisions and a constrained hitch. Guests send only bounded, numbered future input ticks, resending up to 64 pending ticks at about 30 Hz. The host owns physics, checkpoints, finish order and time penalties. Clients predict their own car, replay unacknowledged inputs against host state, soften visual corrections and interpolate all other cars. Every guest has an independent host-side input queue; the accepted connection determines the driver and clients cannot select another slot. The host has a latency advantage. Contact at high latency can still need visible corrections; contact quality depends on the connection between actual devices.

A guest leaving during a race returns the remaining drivers to the lobby. Their slots are reassigned, guests choose **READY** again, and the host can start with the remaining drivers or invite replacements. If the host leaves, all guests disconnect.

Open `?debug=1` to expose **Connection test settings**, which let any player add 50/100/200 ms to their outgoing transient packets and 5/15/30% loss. Debug invites keep this flag; ordinary players do not see the diagnostic controls. Ping includes the simulated delay on both paths. Reliable room messages remain unaffected. This simulates delay/loss, rather than bandwidth congestion or every characteristic of an actual mobile connection.

All assets are served within this repository, without relying on the sibling PARK repository. New modules are in the root version manifest; the page loads its own versioned stylesheet and module entry point. Bump `config.json` before deployment as for PLAN.

Checks from the repository root:

```sh
node --test tests/*.test.mjs
node tests/browser-tow.mjs
node tests/browser-tow-audio.mjs
node tests/browser-publication.mjs
```

Browser checks need Playwright and Chromium, plus `peer` (local signaling server) and `peerjs` (the client fixture), in development only. `PLAYWRIGHT_MODULE`, `PEER_SERVER_MODULE` and `PEERJS_SCRIPT` can point to those files in an external development installation. The checks use two, three and four real WebRTC drivers with a local signaling server and test simulated latency/loss. `TOW_URL` overrides the local default; `SCREENSHOT_DIR` chooses where screenshots are saved.

## Analytics, advertising and artwork

Every screen shares the root `../../monetization.js` and `../../ads.css` helper. Google Analytics (`G-WTPHWDLQ7K`) loads only when the existing Google CMP grants analytics consent or reports it not applicable. Unknown/denied consent discards events. `game_start` and `game_end` contain the game name, driver count and local finish status, without names, room codes or invite links; each fires once per race, not per snapshot.

One persistent responsive `game_footer` AdSense unit (`9380002810`, publisher `ca-pub-3806610967714181`) stays outside the app. It is available on the home, race, pause and results screens, with at least 150px separation after all controls. Connecting, lobby, disconnected and loader-error screens hide it. Blocked/unfilled ads hide their section. Moving through the game never recreates or refreshes the unit. The shared Privacy Policy is linked in the footer.

Full-resolution artwork is in `../../marketing/tow-social.png` (ready to post) and `../../marketing/tow-cover.png` (illustration master). Optimized JPEG/WebP assets are in `../../assets/`. `../../marketing/TOW-PROMPTS.md` records the built-in imagegen prompts. The main catalog keeps its own cover copies so each project deploys independently.
