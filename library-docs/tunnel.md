---
looks: Rings of drifting cloud flowing out of the rose window through the building, like a tunnel.
---
**clouds** in every palette colour over a dim `low` bed, repeated by **mirror** Rings into 4 mirrored rings from the
rose's centre to the layer's farthest corner, moved outward by **scroll** `out` and centred on the rose by **anchor**,
measuring in a sphere so the towers and arches join in. **rose-ripple** spreads plain rings; **kaleidoscope** folds
into wedges instead.

## Overrides
- mirror.rings: rings from the centre to the edge (even); 2 broad, 8 tight.
- scroll.speed: how fast the rings move, in layers a second; 0.05 drifts, 0.2 rushes; negative flies back in.
- clouds.cover and clouds.size: how full and how fine the texture in each ring is.
- clouds.colours: the rings' colours; colour-wash.colours and colour-wash.brightness the bed.
- anchor.tag: the group the rings come from.

## Pairings
- On the whole rig with a **glow** on the rose above it, a light at the end of the tunnel.
- Bind scroll.speed to energy for a tunnel that speeds up into a drop.

## Pitfalls
- On the rose alone more than 4 rings alias across its 7 rings of panes.
- A fast scroll over a high-contrast texture flickers on every LED; keep scroll.speed under about 0.3.
