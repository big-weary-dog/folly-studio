---
looks: Soft, ragged clouds drifting across the layer, clear sky between them.
---
Billowing noise clouds drift in Direction, translucent at their thin edges in the first colour and densest in the last
colour at their cores, with nothing drawn where the sky is clear. Use it for sky, fog and weather, or as the input of
`mask` to show another element only inside the clouds. **plasma** is a regular, full-cover field; **fire** is the same
kind of noise rising and burning out; **turbulence** pushes an existing pattern around rather than drawing clouds.

## Params
- colours: A dark-to-light pick reads as cloud; a single colour gives even, wispy clouds.
- direction: Back and front move them in depth, which on a shallow layer reads as clouds slowly changing shape rather
  than travelling.
- speed: In cloud sizes a second, the same in every direction, so big clouds move faster across the layer. 0.03–0.1 is
  a sky; 0.3+ is a gale.
- cover: Roughly the lit share: 0 is a few wisps, 0.5 half, 1 overcast; 0.3–0.7 for distinct clouds.
- size: A share of the layer. 0.2–0.5 for a few clouds; below 0.2 it breaks into mottling.

## Pairings
- `as: "input"` feeding `mask`, under a source, so the source shows only in the clouds (aurora, storm).
- Over a dark `colour-wash` with `blend: "over"` for a night sky, `sparkle` on top for stars (starfield).
- Under `lightning` for a storm; under `streaks` for rain.

## Pitfalls
- Small size on the sparse spires and globe strands turns to noisy speckle; keep size ≥ 0.25 on those groups.
- Low cover with a dim first colour can leave the layer almost dark; pair with a bed if every LED needs a look.
