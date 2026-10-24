---
looks: Rain-like streaks falling in lanes with fading tails, or swaying round snowflakes.
---
Streaks fall in lanes, each at its own pace; depth slots give arches at different depths different streaks. Rain,
snow, rising embers. **single-strand** for orderly runs along wires, **sparkle** for points that stay put.

## Params
- colours: `"accent high"` gives accent tails with highlight heads; use hex colours for fixed blue and white.
- direction: `up`, `down` or `along` strands; angle tilts the fall sideways (±0.25 is horizontal).
- speed: Each streak ±40%. 0.1–0.2 flakes, 0.6–1 rain, 2+ a downpour.
- lanes: 20–40 for rain on the whole rig; flakes use one column per four lanes.
- density: Each of three streams per lane has this chance of appearing. 0.5 admits at least one stream in 87.5%
  of lanes; where they show also depends on their phase and the layer's geometry.
- tail: Shown for streaks; sway is shown for flakes.
- depth: 1 if the layer is flat.

## Pairings
- Over a dim **colour-wash**; bind density to `energy` (**rain**).
- Then **turbulence** to swirl them (**snowstorm**).

## Pitfalls
- The hard head hops LED to LED with few lanes on sparse LEDs: more lanes, longer tail.
- On `along`, keep angle 0.
