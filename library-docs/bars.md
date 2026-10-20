---
looks: Bands of colour sweeping one way: flat, smooth, pulsing or comet-tailed.
---
Bands of colour march across the layer in Direction, each the next colour of its pick. The plainest moving source and
the most flexible: one wide smooth bar is a slow tide, 3 pulse bars on `in` are rings from a centre, 2 comets on
`round` chase a circle, 2 comets on `orbit` sweep like a lighthouse. Reach for **single-strand** when the motion
should follow each wire rather than space, **colour-wash** when the whole layer should change at once.

## Params
- colours: A role (`body`) gives a family, `rainbow` a spectrum.
- direction: With `in`, a negative speed sends rings outward. `orbit` turns round an upright axis in metres (the
  layer's middle, or each group's after `anchor` shape `plan`), across the front and round the back.
- speed: Above ~1 on a step profile reads as flicker on big groups.
- bars: 1–2 for slow tides, 4–8 for stripes; rounded to whole numbers on `round` and `orbit`.
- twist: On `round` and `orbit`, turns of winding over the layer's height: 4 on `orbit` round a tower is a
  barber's pole (spire-helix).
- duty: Below 1 the layer under shows through the gaps.
- softness: 0 aliases on sparse LEDs; keep ≥ 0.1.

## Pairings
- Over a dim `colour-wash` with duty < 1: bands over a bed (presets rising-sweep, nave-procession).
- Then `polar` and `twist`: spiral arms (galaxy). Then `anchor`: rings centred on a tagged group (rose-ripple).
- Bind speed to an lfo `hold` in beats for a step-per-beat march.

## Pitfalls
- Step profile, high speed and few bars on the whole rig is large-area flashing; over 3 Hz fails the flash check.
- Comet needs duty < 1 to show a tail; at duty 1 bars sit back to back.
