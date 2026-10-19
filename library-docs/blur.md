---
looks: Colours softened into their neighbours: soft glows instead of hard edges and steps.
---
Every LED's colour is averaged with its neighbours within Radius metres, along its own wire, through space, or both,
so hard edges become soft glows and stepping chases glide. A filter of a special kind: it works on the real LED
colours of the whole layer at once, so it ends a stage: warps below it do not reach the modules above it, and sources
below it draw sharp on top of the blurred result. Reach for it to rescue aliasing on sparse LEDs or to make a look
dreamy; the layer's own soften setting already blurs lightly along the wire, so add blur only for more. **trails**
smears over time rather than space; **edge-fade** softens one edge of the layer.

## Params
- radius: in metres (of wire in `wire` mode). 0.1–0.2 removes stair-steps; 0.5–1 is a soft glow; capped at 1.5.
- mode: `wire` blurs along each strand only (keeps strands and arches separate); `space` blurs between nearby LEDs on
  any strand (the rose's rings and the spire's strands melt together); `both` does both.
- amount: mix with the sharp colour; 0.5 keeps crisp cores with a halo.

## Pairings
- After single-strand, arch-chase or bars with a step profile: smooth movement without stepping.
- After sparkle with `space`: twinkles that bloom; follow with a sharp sparkle below it for sharp highlights.
- After mosaic or posterize: softened blocks or bands.

## Pitfalls
- Blur hides warps below it from what is above: put warps above the blur, not below.
- Large radius in `space` costs time on dense areas (the rose, the spire globes); keep radius ≤ 0.6 on whole-rig
  layers.
- Fine detail (small sparkle, thin lines) blurs away and goes dim; turn the source's brightness or size up.
