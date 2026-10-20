---
looks: Rainbow rings spreading out from the rose window through the whole building.
---
Soft rings of colour, `body` and `accent` in turn, spread outward from the rose window across the whole layer
over a `low` bed, about four metres a second: pulse **bars** on `in` with a negative speed, centred on the rose by
**anchor** measuring in a sphere out to 30 metres. Use it on the whole rig to make the rose the source of
everything. **rose-chase** keeps its rings and comets inside the rose; **shockwave** is a single burst.

## Overrides
- bars.speed: rings a second; negative spreads them out, positive draws them in toward the rose.
- bars.bars: rings within the reach; 5 over 30 m is one every 6 m; 10 for tight ripples.
- bars.duty: ring thickness; 0.2 thin, 1 rings back to back.
- bars.profile: `comet` for a bright leading edge; `step` for flat bands.
- bars.colours: `all` for every palette colour; `rainbow` ignores the palette.
- anchor.reach: metres counted as the edge; smaller packs the rings tighter, 0 uses the layer's farthest corner.
- anchor.shape: `facade` ignores depth (rings on the façade); `plan` makes rings on the ground round an upright axis.
- anchor.tag: ripple from another group (`tower` with which `nearest` for one set from each tower).

## Pairings
- On the whole rig, with the rose itself in its own layer above (a **spot** or **rose-bloom**).
- Bind bars.speed to energy (`from` −0.3 `to` −1.2) for ripples that quicken.

## Pitfalls
- Each LED blinks at speed × bars Hz; above 3 on the whole rig is large-area flashing.
- On the rose alone the 30 m reach makes the rings far wider than the window; use **rose-chase** or set reach low.
