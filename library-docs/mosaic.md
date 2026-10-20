---
looks: The layer broken into flat pieces: blocks like big pixels, or runs along each strand.
---
Snaps what is above it in its layer to flat pieces, so smooth sources become chunky tiles that step rather than glide.
Blocks cuts the layer's space into a grid, Blocks along each of width, height and depth, every LED in a block taking
the colour at its middle. Runs breaks each strand into runs of LEDs per run, each run one colour, which reads on
sparse rigs where blocks fall between wires. A warp: it bends the modules above it up to a blur or trails, so it goes
after the source. **posterize** flattens colours instead of space; **mirror** and **kaleidoscope** fold instead.

## Params
- shape: `runs` for strands and arches, where a grid's blocks hold one or two LEDs each.
- cells: The grid follows the layer's box, so on a wide layer blocks are wider than tall. 6–12 reads as tiles from
  a distance; above ~30 it hardly differs from no mosaic.
- leds: 4–8 on 40-LED strands; on short strands (rose cells, globes) a run is the whole strand.

## Pairings
- After plasma, clouds or bars (smooth profile): moving colour in tiles that change step by step.
- Then **hue-shift** or **recolour**: each tile a different colour.
- Over a dim bed blended under: blocks that light up from a grid.

## Pitfalls
- Few cells over the whole rig with a fast source makes big areas change colour at once; keep the source slow (under
  ~1 change a second per block) to stay clear of the 3 Hz flash check.
- A block whose middle falls in empty space takes the colour of the nearest LED, possibly on another structure.
- Snapped motion stutters; it is the look, but it fights smooth bindings to the beat.
