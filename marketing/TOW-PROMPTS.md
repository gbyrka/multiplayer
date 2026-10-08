# TOW launch artwork

Generated with the built-in `image_gen` tool using the imagegen skill.

- `tow-social.png`: full-resolution social poster (online multiplayer, 2–4 drivers, keyboard controls only for now).
- `tow-cover.png`: matching illustration master, without typography. Each catalog overlays a responsive, accessible keyboard notice.
- `../assets/tow-social.jpg`: 1200 × 686 social link preview, preserving the entire poster.
- `../assets/tow-cover.jpg` and 600/1200px WebP variants: responsive covers. The games catalog has independent copies.

## Final prompt — social poster

```text
Use case: ads-marketing.
Asset type: finished landscape social advertisement for TOW, a real free online multiplayer browser trailer-racing game. Generate one 1792 x 1024 landscape image.
Primary request: beautiful inviting editorial game-launch poster consistent with an independent emerald/ivory browser game collection and PLAN's premium emerald-and-cream campaign. Energetic yet restrained, clear readable typography, memorable trailer racing.
Scene/backdrop: dark forest emerald and graphite background, moss-green verges around a winding asphalt road sweeping through the right half; subtle cream road markings and warm directional lighting.
Subject: four small stylized top-down cars in gold, dusty blue, coral and sage, EACH towing exactly one small ivory cargo trailer connected behind the car with a visible hitch. They race around a bend, separated enough to clearly see every car, trailer and hitch. A few barrels by the verge suggest careful driving. No trucks, no tow trucks or cranes. Match the idea of PARK's simple colorful top-down cars with polished miniature materials.
Composition/framing: designer editorial poster. Clear spacious typography on the left; attractive road and vehicles on the right. All essential content inside 8% safe inset. Should also crop gently to a 1.91:1 social preview without losing text.
Style/medium: polished original game illustration / premium miniature diorama, crisp silhouettes, softly textured paper-like surfaces, not photorealistic racing, not a fake screenshot or UI.
Color palette: graphite #101b1a, deep emerald #153d33, moss #344734, warm ivory #f4f1e7, restrained gold #ead6a7 and lime #c4ee91.
Text (verbatim, English, no additional text):
Very large title: "TOW"
Elegant italic tagline: "Keep your trailer close."
Strong supporting line: "ONLINE MULTIPLAYER"
Supporting line: "2–4 drivers. One finish."
Highly legible prominent contrasting cream or gold badge: "KEYBOARD CONTROLS ONLY FOR NOW"
Small bottom line: "Free to play. No sign-up."
Readable URL: "MoD-IT.games/multiplayer/"
Typography: confident cream serif title, elegant cream-gold italic tagline, crisp sans-serif secondary lines, keyboard notice prominently readable even at social-feed size. URL exact, never garbled.
Constraints: physically coherent car/hitch/trailer connections. No people, no logos, no watermark, no casino imagery, no fabricated screenshot, no phones, no touch controls, no excessive speed blur, no neon. No extra copy. Professionally composed, friendly and playful.
```

## URL replacement — 2026-10-08

Edited `tow-social.png` with the built-in `image_gen` tool. The previous poster was the edit target; the replacement preserves its actual 1659 × 948 PNG dimensions and the existing layout.

Final edit prompt:

```text
Use case: text-localization. Edit target: the supplied TOW social advertisement. Replace ONLY the lime-green URL at the bottom left, currently "gbyrka.github.io/multiplayer/games/tow/", with the exact text "MoD-IT.games/multiplayer/". Preserve the exact uppercase and lowercase spelling, hyphen, dot and trailing slash: MoD-IT.games/multiplayer/. Render it clearly and legibly, left-aligned in the same location with the same lime-green bold sans-serif style and comparable letter size. Remove the entire old URL. Preserve the image dimensions/aspect ratio and everything else: composition, four gold/blue/coral/sage cars each towing one ivory trailer, forest, winding road, lighting, colors, title "TOW", tagline "Keep your trailer close.", "ONLINE MULTIPLAYER", "2–4 drivers. One finish.", keyboard badge "KEYBOARD CONTROLS ONLY FOR NOW", and "Free to play. No sign-up.". No additional text or design changes.
```

## Final prompt — cover illustration

Reference image: `tow-social.png`, used for style and car/trailer consistency.

```text
Use case: ads-marketing.
Asset type: landscape 3:2 cover illustration for the TOW trailer racing game, matching the just-created TOW social poster.
Input image: reference for style, colors and exact car-and-trailer concept. Create a separate artwork-only companion image, not a poster.
Primary request: four colorful small top-down cars (gold, dusty blue, coral, sage), each towing exactly one ivory cargo trailer connected behind its rear bumper with a visible hitch. Winding asphalt road, moss-green/emerald verges, a few barrels and crates as roadside obstacles. Friendly independent browser game art, premium miniature diorama, visually coherent towing connections.
Composition: camera above the road at a modest tilted top-down angle; broad sweeping S bend fills image; all four complete car/hitch/trailer rigs arranged around the bend visible in central 75 percent of image, no overlapping rigs. All cars driving in the same direction, clear breathing room and minimal visual noise. Keep upper-left 25 percent fairly quiet for a live HTML keyboard notice. Do not crop vehicles.
Style: match reference illustration materials, warm soft directional light and clean vehicle silhouettes. Dark forest emerald #153d33, asphalt charcoal, ivory #f4f1e7, gold #ead6a7 and moss green.
Constraints: artwork only, NO text, letters, words, badges, typography, logos, watermarks or UI. No people, no tow trucks, no cranes. Exactly four cars and four trailers, one trailer per car. All trailers behind the cars. Finish as an attractive cohesive game-card image.
```
