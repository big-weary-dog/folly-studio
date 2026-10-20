---
looks: Glowing shoots creep up the wiring from every foot to the tips, hold, then wither.
---
A five-colour **bars** gradient, old wood to fresh tip, laid out along the wiring by **reorder** (`wires` from
`bottom`), so it runs up each leg, over the arches, into the rose and up the spires. An **edge-fade** on `out`, its
position on a slow hold LFO (one season about every 33 seconds), grows it in, holds it, and withers it back tips
first. **turbulence** makes the front ragged, like shoots finding their way.

## Overrides
- reorder.from: `bottom` grows from the feet; `rose` or `spire` grows out from there; `top` pours down from the
  crowns: with hot bars.colours (`#300000 #ff3000 #ffb040`) it is lava.
- bars.colours: old wood first, the fresh tip last.
- turbulence.amount: how ragged the front is; 0 is a clean line.

## Pairings
- Under **sparkle** in `high` for blossom at the tips once it has grown.
- After **daybreak** for a whole morning.

## Pitfalls
- The season is edge-fade.position's LFO rate (0.03 a second); faster than 0.1 and it reads as a wipe, not growth.
- Reorder must stay below what it orders: above the bars and edge-fade, they run through the air from the middle.
