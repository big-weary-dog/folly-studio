---
looks: The layer broken into flat blocks of one colour each, like big pixels.
---
The space of the layer is cut into a grid, Blocks along each of width, height and depth, and every LED in a block
takes the colour of the block's middle, so smooth sources become chunky tiles that step rather than glide. A warp: it
bends the modules above it in its layer up to a blur or trails, so it goes after the source. Reach for it for a retro,
pixel-art or digital look, or to make a busy texture read from far away. **posterize** flattens colours instead of
space; **mirror** and **kaleidoscope** fold rather than snap.

## Params
- cells: The grid follows the layer's box, so on the wide portal blocks are wider than tall. 6–12 reads as tiles from a
  distance; above ~30 it hardly differs from no mosaic.
- leds: Every LED in a block already shares one sample, so in practice it only nudges where each block takes its colour;
  leave it at the default.

## Pairings
- After plasma, clouds or bars (smooth profile): moving colour in tiles that change step by step.
- Then **hue-shift** or **recolour**: each tile a different colour.
- Over a dim bed blended under: blocks that light up from a grid.

## Pitfalls
- Few cells over the whole rig with a fast source makes big areas change colour at once; keep the source slow (under
  ~1 change a second per block) to stay clear of the 3 Hz flash check.
- A block whose middle falls in empty space takes the colour of the nearest LED, possibly on another structure.
- Snapped motion stutters; it is the look, but it fights smooth bindings to the beat.
