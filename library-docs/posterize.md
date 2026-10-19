---
looks: Colours rounded to a few flat steps: banded gradients, poster-like hard colours.
---
Each red, green and blue channel of the colour above it is rounded to Steps levels, so smooth gradients turn into
bands and soft blends into a handful of hard colours; at 2 every LED is one of eight saturated colours (or black). A
filter: it reworks the colour of everything above it in its chain, so it goes after the sources. Reach for it for a
retro, 8-bit or graphic look, or to give a smooth texture crisp edges; **mosaic** flattens space into blocks instead
of colour into steps, **recolour** picks new colours, **mask** with `self` cuts shapes rather than banding colours.

## Params
- steps: levels per channel. 2 is harsh primary colours, 3–4 clear banding, 6+ barely visible.
- amount: 1 fully stepped; 0.4–0.7 keeps some of the gradient under the steps.

## Pairings
- After plasma, clouds or a smooth bars: contour-map bands of colour that flow.
- After hue-shift: rainbow stripes with hard edges.
- With **mosaic** (a warp, after the source): blocks in a few hard colours, pixel art.

## Pitfalls
- Dim colours round to black and the edges of fades jump to a level: smooth fades and pulses become steps that pop
  on and off, which on large areas can trip the flash check. Use amount < 1 on pulsing sources.
- Hard band edges alias on sparse LEDs; a blur after it softens them again.
- Colours are rounded per channel, so a palette colour may become a different hue.
