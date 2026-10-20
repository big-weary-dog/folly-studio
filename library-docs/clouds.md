---
looks: Soft, ragged clouds drifting across the layer, clear sky between them.
---
Noise clouds, clear where the sky is: for sky, fog and weather, or as the input of **mask**. **plasma** is a
regular full-cover field; **fire** rises and burns out; **turbulence** pushes an existing pattern instead.

## Params
- colours: A dark-to-light pick reads as cloud.
- direction: `back`/`front` on a shallow layer read as clouds changing shape, not travelling.
- speed: In cloud sizes, so big clouds cross faster. 0.03–0.1 a sky; 0.3+ a gale.
- cover: 0.3–0.7 for distinct clouds.
- size: Below 0.2 it mottles; keep ≥ 0.25 on spires and globe strands.

## Pairings
- `as: "input"` to **mask** (presets **aurora**, **storm**).
- Over a dark **colour-wash**, **sparkle** on top: a night sky (**starfield**).

## Pitfalls
- Low cover with a dim first colour leaves the layer nearly dark; add a bed.
