# TOW: Driver’s Seat

An **unlisted, first-person version of TOW multiplayer for 2–4 drivers**. Its production path is **https://mod-it.games/multiplayer/games/tow-drivers-seat/** after publishing this repository. It is deliberately absent from both game catalogs and the game registry. The entry includes `noindex, nofollow, noarchive`. Anyone with its direct link can open it and share a room invitation.

Serve the workspace root with `python3 -m http.server 8080`, then open **http://localhost:8080/multiplayer/games/tow-drivers-seat/**. Serve `multiplayer/` alone to use **http://localhost:8080/games/tow-drivers-seat/** instead. ES modules require HTTP; use HTTPS for other devices.

## Play

The host creates a room, shares its link, and starts when the other drivers choose READY. Drive with **arrow keys**, brake with **Space**, hold **H** for the horn, and use **R** to reset to the checkpoint with the original three-second penalty. **Escape** pauses/resumes for the host. Existing touch buttons are retained; as in TOW, keyboard play is the supported input.

The eye sits at the left seat's centreline, **0.43 m left of the car's centre**, with the steering wheel on that same centreline. The 1.70 m-wide car's bonnet, windshield pillars, side window, dashboard and centre console use the same car coordinates. The console and bonnet centre are therefore to the driver's right. Smooth, simplified hands grip the wheel and follow its actual steering angle, including the steering reduction at speed. The compact instrument display shows speed and gear without a brake warning. Opponents’ car and trailer stop lamps brighten when their shared braking state is active, including braking before reversing; each rig has independent lamps.

The left mirror is a **0.28 × 0.17 m planar surface outside the side window**, at local position `(-1.04, 1.10, -0.55)` m. Its outer portion naturally falls outside the driver's field of view; it is not a screen inset. `view-geometry.mjs` reflects the seated eye through this plane, constructs an off-axis camera bounded by the four glass corners, and clips at the glass. The glass's UVs map the reflected view back onto that physical surface. The mirror and cabin keep their car-relative positions at every heading and screen size.

The reflected pass retains the **complete exterior car and articulated trailer**, with depth testing. The body occludes the coupling and far parts of the trailer. With the rig straight, the visible near flank, left wheel and front-left edge appear beside the car's inner-edge sliver; the drawbar, centre of the trailer's front and right wheel do not. Turning changes what is actually exposed through the mirror aperture, rather than drawing a fixed trailer image or filtering parts to force a view. Other drivers and obstacles appear only when their geometry enters the reflected field of view.

The compact upper-right panel gives every driver a named, color-coded progress bar, current position and percentage. It uses authoritative host progress, so checkpoint resets move the bar back. Only a completed trailer crossing marks a driver FINISHED; an unfinished driver remains below 100%. The existing route percentage, speed, gear, clock, pause, results and penalties remain available.

## Shared behavior

`../tow/client.mjs` owns both versions' complete input, lobby, networking, prediction, sound and race lifecycle. `../tow/app.mjs` starts its original overhead renderer; this version supplies `CockpitScene`. **No changes to track generation, physics, prediction, race rules or audio modules are needed.** Both versions generate exactly the same track for the same seed.

Rooms use their own `tow-cockpit-v1-` discovery namespace, so a room code from the overhead TOW cannot accidentally join a cockpit room. Invitations preserve this game's path. No production backend, bundler, install, downloaded sound or new external dependency is introduced. Three.js and the mesh-merging helper reuse the repository's existing, locally licensed HAMSTER renderer utilities. Shared consent-controlled ads, analytics and saved sound/name preferences follow TOW; analytics labels this variant `tow_drivers_seat`.

## Rendering budget

- One WebGL renderer for the road, physical cabin and mirror. Static cabin surfaces and hand details are merged; only the steering assembly and arms move. A small instrument texture updates only when its displayed values change. The transparent screen overlay is used only for a graphics-context restoration message.
- Low-poly vehicles with merged static parts; spatially batched trees, markings, barrels and crates. Short road chunks and distant batches are frustum-culled for each camera.
- No live shadow maps, post-processing or giant route-sized texture.
- The mirror renders at **256 × 180**, at most **15 times per second**, sharing vehicle geometry with the main view.
- Paused/results scenes redraw only when needed. Software rendering is capped at 30 graphics frames per second, without changing simulation, input or sound updates.
- Main resolution is capped at **1.4× device density** and approximately **1.8 million pixels**. Software renderers start at lower resolution; persistent slow frames reduce graphics resolution, preserving the original simulation and network rates.
- Rematches dispose track-specific GPU geometry, materials, textures and instance buffers. Vehicle meshes are reused.

This view needs WebGL 2; startup explains how to enable hardware acceleration if unavailable. A lost graphics context shows a restoration message. Performance still depends on the device, browser and window size.

## Verification

From the repository root:

```sh
node --test --test-isolation=none --test-reporter=spec tests/tow.test.mjs tests/tow-audio.test.mjs tests/tow-cockpit.test.mjs
node tests/browser-tow-cockpit.mjs
node tests/browser-tow.mjs
TOW_GAME=tow-drivers-seat SCREENSHOT_DIR=test-results/tow-drivers-seat-network node tests/browser-tow.mjs
```

The browser scripts use development-only Playwright/Chromium, plus `peer` and `peerjs` for the WebRTC tests. See the original TOW README for `PLAYWRIGHT_MODULE`, `PEER_SERVER_MODULE` and `PEERJS_SCRIPT` overrides.

The cockpit test renders actual WebGL frames and reads the mirror render target. It recolors individual trailer surfaces to verify that the left side and left wheel contribute pixels while the coupling and right wheel contribute none. It checks changing articulation and rivals entering/leaving the reflected view. Node tests additionally verify the left seat position, equal incidence/reflection angles, exact projection of all four mirror corners, and sight lines through the car geometry. It also checks steering, all-driver progress/reset/finish states, layout at 320–1440px and GPU memory across rematches. The shared integration script runs real two-, three- and four-player WebRTC sessions with audio and delayed/lost packets in either view. Screenshots stay under gitignored `test-results/`.
