---
looks: Bands of colour sweeping one way: flat, smooth, pulsing or comet-tailed.
---
Bands of colour march across the layer in Direction, each the next colour of its pick. The plainest moving source and
the most flexible: one wide smooth bar is a slow tide, 3 pulse bars on `in` are rings from a centre, 2 comets on
`round` chase a circle. Reach for **single-strand** when the motion should follow each wire rather than space,
**lighthouse** for beams turning round a centre, **colour-wash** when the whole layer should change at once.

## Params
- colours: the bands' colours, dealt in turn; a role (`body`) for a family, `rainbow` for a spectrum.
- direction: which way bands move; `in` runs toward the centre (a negative speed sends rings outward), `round` circles
  it, `along` follows each wire.
- speed: how fast bands move; negative runs them backward. Above ~1 on a step profile reads as flicker on big groups.
- bars: how many fit across. 1–2 for slow tides, 4–8 for stripes; rounded to whole numbers on `round`.
- duty: lit share of each bar; below 1 the gaps are clear, so the layer under shows through.
- profile: step (flat bands), smooth (a gradient, no edges), pulse (bright middles), comet (bright front, fading tail).
- softness: edge width on step. 0 aliases on sparse LEDs; keep ≥ 0.1.

## Pairings
- Over a dim `colour-wash` with duty < 1: bands over a bed (presets rising-sweep, nave-procession).
- Then `polar` and `twist`: spiral arms (galaxy). Then `anchor`: rings centred on a tagged group (rose-ripple).
- Bind speed to an lfo `hold` in beats for a step-per-beat march.

## Pitfalls
- Step profile, high speed and few bars on the whole rig is large-area flashing; over 3 Hz fails the flash check.
- Comet needs duty < 1 to show a tail; at duty 1 bars sit back to back.
