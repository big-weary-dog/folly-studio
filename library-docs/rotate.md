---
looks: The layer tilted by an angle or turning steadily: in the façade, from the side or in plan.
---
What is above it is turned round the layer's middle by Angle, and keeps turning at Spin. In the façade, upright bars
become diagonals or a turning propeller; from the side, a front-to-back roll leans with height (preset depth-wave);
in plan, a sweep turns as if seen from above. A warp: it bends the modules above it in its layer up to a blur or
trails, so it goes after the source. Reach for it to set any linear source at a slant or to set it slowly turning;
**twist** turns more at the rim than the centre, **scroll** slides instead of turning, **kaleidoscope** turns a
mirrored pattern.

## Params
- plane: `facade` turns in the front plane (the usual choice); `side` turns depth against height (leans
  front-to-back motion); `plan` turns across against depth, as seen from above (only shows on layers with depth).
- angle: the fixed tilt in turns; 0.125 (the default) is 45°, 0.25 a right angle. Small values (±0.02–0.05) give a
  subtle lean.
- spin: turns a second on top of the angle. 0.02–0.1 is a slow turn; above ~0.5 big stripes sweep past fast enough to
  flicker.

## Pairings
- Bars going `back` then rotate `side` with a small angle: waves rolling front to back, leaning with height (preset
  depth-wave).
- Bars or curtain then rotate `facade` with spin: a turning fan; add **mirror** below for a symmetrical one.
- Put **anchor** below it to turn round a group's middle.

## Pitfalls
- The default angle is 45°, not 0: add it and the look tilts at once. Set angle 0 for spin only.
- It turns the layer's 0..1 box, not metres: on the wide, short portal a 45° setting looks much flatter, and turning
  stretches the source as it goes round.
- Corners turn outside the source's box, where some sources repeat, clamp or go dark.
