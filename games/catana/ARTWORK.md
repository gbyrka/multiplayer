# Original terrain artwork

Created for Catana Codex using the built-in `image_gen` tool, through the `imagegen` skill. The result is a single six-cell texture atlas, not a copy of commercial board-game art. It was generated at 1536 × 1024 and encoded as WebP (quality 88) without changing its composition.

The final project asset is [`assets/terrain-atlas.webp`](assets/terrain-atlas.webp). The SVG renderer and resource cards use this same atlas, with no external image requests. Roads, towns, dice, number tokens, resource symbols, harbors and the robber are original code-native SVG/CSS graphics.

## Final prompt

```text
Use case: stylized-concept
Asset type: original terrain texture atlas for the browser board game Catana Codex.
Primary request: a premium realistic miniature landscape artwork atlas consisting of exactly six equal rectangular cells, arranged three columns by two rows in a landscape 1536 by 1024 image. Each cell is a complete richly detailed overhead landscape filling its rectangle, with no gaps, borders, text, numbers, icons, hexagons, tokens, buildings, roads, logos or watermarks.
Cell positions: upper left dense evergreen forest with deep emerald pine trees; upper middle rust-colored clay hills with terracotta layered earth and small rocks; upper right luminous grassy green pasture with tiny white sheep. Lower left golden wheat fields with curving cultivated strips; lower middle cool slate and silver rocky mountain peaks with subtle snow; lower right sandy amber desert dunes with wind ripples and small scattered stones.
Style/medium: realistic handcrafted miniature diorama, natural fine textures, restrained painterly polish, top-down orthographic viewpoint, consistent scale and warm daylight from upper left, soft ambient shadows, expensive tactile tabletop aesthetic. Make each terrain immediately recognizable at small size. The cell centers should have restrained detail so a number token overlaid there remains legible. Each full rectangle will be clipped to a hexagon by the application. Original composition only, do not reproduce any commercial board game artwork.
```
