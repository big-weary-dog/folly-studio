---
looks: The lower half of the layer filled with colour, its surface rolling like water.
---
The layer fills with `accent` colour from the ground to half its height, the waterline soft and wobbling slowly: a
still **colour-wash** cut off by **edge-fade** (from the top, at half), bent by **turbulence**. Above the surface is
clear, so it needs a sky beneath (a layer below, or a bed). A level rather than a motion: floods, tides, a building
half under the sea; bind the position to raise the tide. **rising-sweep** sends a band up repeatedly;
**wash-breathe** fills and drains on its own.

## Overrides
- edge-fade.position: the water level from the top; 0.5 half full, 0.8 a shallow pool, 0.1 nearly full. Bind to a
  hold LFO or the clip envelope for a rising tide.
- edge-fade.width: the surface's edge; 0.04 crisp, 0.3 a soft blur into the sky.
- edge-fade.direction: `up` hangs it from the top; `left` or `right` floods sideways.
- colour-wash.colours: the water; `body accent` with a little speed drifts between deep and surface colours.
- turbulence.amount: wave height; 0.08 is gentle, 0.2 stormy, 0 a flat surface.
- turbulence.size and turbulence.speed: the length of the waves and how fast they roll.

## Pairings
- On a layer over a **starfield** or **clouds** sky, or put a **colour-wash** under it with `blend: "under"`.
- Add **sparkle** (`high`, low density) after it with **mask** by `self` to glint only in the water.
- Bind edge-fade.position to the clip envelope (`from` 0.9 `to` 0.1) to flood the building over a clip.

## Pitfalls
- Position counts from the top (the fade runs down), so a higher number is lower water.
- colour-wash.speed above 0 cycles the water's colour; leave it at 0 for still water.
