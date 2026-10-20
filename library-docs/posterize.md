---
looks: Colours snapped to a few flat bands of the palette: banded gradients, hard colours.
---
Snaps the colour above it to Steps flat bands by its brightness: the darkest band takes the first of Colours, the
brightest the last, each as bright as its step. Smooth gradients turn into contour bands and soft blends into a
handful of hard colours, all from your palette. A filter: it reworks the colour of everything above it in its chain,
so it goes after the sources. Reach for it for a retro, graphic look, or to give a smooth texture crisp edges;
**mosaic** flattens space into blocks instead, **recolour** maps colours without banding, **mask** with `self` cuts
shapes.

## Params
- colours: Any pick; `accent high` gives two-tone bands, `all` walks the whole palette from dark to bright.
- steps: 2 is hard light and dark, 3–5 clear banding; 8+ is barely visible.
- amount: 0.4–0.7 keeps some of the gradient under the bands.

## Pairings
- After clouds or a smooth bars: contour-map bands of colour that flow.
- With **mosaic** (a warp, after the source): blocks in a few hard colours, pixel art.

## Pitfalls
- Dim colours fall in the darkest band and fades jump band to band: smooth pulses become steps that pop on and off,
  which on large areas can trip the flash check. Use amount < 1 on pulsing sources.
- Hue is replaced, not kept: whatever colours come in, the bands are Colours'.
- Hard band edges alias on sparse LEDs; a blur after it softens them again.
