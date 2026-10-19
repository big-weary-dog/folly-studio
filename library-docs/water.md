---
looks: The lower half of the layer filled with colour, its surface rolling like water.
---
The layer fills with `accent` colour from the ground to just over half its height, the waterline wobbling slowly:
a still **bars** (one bar, half duty) bent by **turbulence**. Above the surface is clear, so it needs a sky beneath
(a layer below, or a bed). A level rather than a motion: floods, tides, a building half under the sea; bind the duty
to raise the tide. **rising-sweep** sends a band up repeatedly; **wash-breathe** fills and drains on its own.

## Overrides
- bars.duty: the water level, as a share of the layer ≈ duty ÷ 0.9; 0.2 a shallow pool, 0.85 nearly full. Bind to
  a hold LFO or the clip envelope for a rising tide.
- bars.colours: the water; `body accent` stacks two bands (deep and surface) only if bars rises above 1.
- bars.softness: the surface's edge; 0.04 crisp, 0.2 a soft blur into the sky.
- bars.direction: `down` hangs it from the top; `right` floods sideways.
- turbulence.amount: wave height; 0.08 is gentle, 0.2 stormy, 0 a flat surface.
- turbulence.size and turbulence.speed: the length of the waves and how fast they roll.

## Pairings
- On a layer over a **starfield** or **clouds** sky, or put a **colour-wash** under it with `blend: "under"`.
- Add **sparkle** (`high`, low density) after it with **mask** by `self` to glint only in the water.
- Bind bars.duty to the clip envelope (`from` 0.1 `to` 0.9) to flood the building over a clip.

## Pitfalls
- The lowest LEDs sit on the bar's soft lower edge: the ground row is about half bright and wobbles with the waves.
- bars.speed above 0 makes the water rise off the top and refill repeatedly; leave it at 0 for a level.
