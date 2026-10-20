---
looks: The lower half of the layer filled with colour, its surface rolling like water.
---
A level, not a motion: floods, tides, a building half under the sea. Above the surface is clear, so it needs a sky
beneath. **rising-sweep** sends bands up; **wash-breathe** fills and drains on its own.

## Overrides
- edge-fade.position: counts from the top, so higher is lower water; 0.8 a pool, 0.1 nearly full.
- edge-fade.width: 0.04 crisp, 0.3 soft.
- edge-fade.direction: `up` hangs it from the top; `left`/`right` floods sideways.
- turbulence.amount: 0.08 gentle, 0.2 stormy, 0 flat.

## Pairings
- Over a **starfield** or **clouds** layer, or **colour-wash** with `blend: "under"`.
- **sparkle** after it with **mask** by `self` to glint in the water.
- Bind edge-fade.position to the clip envelope (`from` 0.9 `to` 0.1) to flood over a clip.

## Pitfalls
- colour-wash.speed above 0 cycles the water's colour.
