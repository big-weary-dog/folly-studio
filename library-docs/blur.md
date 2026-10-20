---
looks: Colours softened into their neighbours: soft glows instead of hard edges and steps.
---
Averages each LED with its neighbours to rescue aliasing on sparse LEDs or make a look dreamy. It ends a stage: warps
below it don't reach modules above it, and sources below it draw sharp on top. The layer's soften already blurs lightly
along the wire; **trails** smears over time instead.

## Params
- radius: 0.1–0.2 removes stair-steps; 0.5–1 a soft glow.
- mode: `wire` keeps strands and arches separate; `space` melts the rose's rings and spire strands together.
- amount: 0.5 keeps crisp cores with a halo.

## Pairings
- After stepping chases (single-strand, bars step profile) or mosaic/recolour Steps: smooth glides.
- After sparkle in `space`: blooming twinkles; a sharp sparkle below adds highlights.

## Pitfalls
- `space` with radius over 0.6 is slow on dense whole-rig layers.
- Fine detail blurs away and dims; raise the source's brightness or size.
