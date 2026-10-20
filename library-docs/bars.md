---
looks: Bands of colour sweeping one way: flat, smooth, pulsing or comet-tailed.
---
The plainest, most flexible moving source: one smooth bar is a slow tide, pulse bars on `in` are rings, comets on
`clockwise` chase a circle, on `orbit-counterclockwise` sweep like a lighthouse. Use **single-strand** to follow each
wire, **colour-wash** to change the whole layer at once.

## Params
- direction: Named both ways: `out`/`in`, `clockwise`/`counterclockwise` (from the front), `orbit-clockwise`/
  `orbit-counterclockwise` (from above, round the layer's middle or each group's after **anchor** `plan`). Negative
  speed runs any of them the other way.
- bars: Rounded to whole numbers on the turning ways and orbits.
- softness: Keep ≥ 0.1; 0 aliases on sparse LEDs.
- profile: `comet` needs duty < 1 to show a tail.

## Pairings
- Over a dim **colour-wash** with duty < 1 (presets **rising-sweep**, **nave-procession**).
- Then **polar** and **twist**: spiral arms (**galaxy**).
- Speed on an lfo `hold` in beats: a step-per-beat march.

## Pitfalls
- Step profile, high speed and few bars on the whole rig is large-area flashing; over 3 Hz fails the flash check.
