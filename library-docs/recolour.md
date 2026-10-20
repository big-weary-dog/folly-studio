---
looks: The layer repainted in new colours by brightness: shadows one colour, highlights another.
---
Every colour above it is replaced by a colour from Colours chosen by its brightness: dark parts take the first
colours, bright parts the last, while (with Shade) light and dark stay where they were. Steps snaps both into a few
flat bands, dark to bright: smooth gradients become contour bands, a poster in your palette. A filter: it reworks the
colour of everything above it in its chain, so it goes after the sources it repaints; sources below it keep their
own colours. Reach for it to put a texture (clouds, fire, sparkle) into the show's palette, or to make one
source read as a heat-map; **hue-shift** turns colours round the wheel by place instead of by brightness,
**mosaic** flattens space instead.

## Params
- colours: A role (`body`, `accent`) or a list. Order matters: darkest first.
- amount: 0.3–0.6 tints the original.
- shade: Off lights dark areas in the first colour.
- steps: 0 smooth; 2 is hard light and dark, 3–5 clear banding, 8+ barely visible. `accent high` with 2 steps is
  two-tone.
- contrast: Above 1 pushes toward the two ends (bold, two-tone); below 1 keeps most LEDs in the middle colours.
- shift: It bounces back at the ends; ±0.2 re-centres which colour dominates.
- drift: Colours a second, back and forth; 0.02–0.1 for a slowly changing palette.

## Pairings
- After clouds or fire: the texture's shape in the palette's colours (a fire in blues).
- After a whole chain of sources: one palette over everything, so mixed sources match.
- Bind shift or drift to energy or an lfo: the colour mood moves with the music.

## Pitfalls
- With Steps, fades jump band to band: smooth pulses become steps that pop on and off, which on large areas can trip
  the flash check. Use amount under 1 on pulsing sources; hard band edges alias on sparse LEDs.
- Brightness weighs green heavily: pure blue and red count as dark, green and yellow as bright, so a rainbow source
  does not map in rainbow order.
- Shade off lights up every opaque dark area, possibly the whole layer at full; watch brightness and power.
- On a flat colour-wash every LED has the same brightness, so all take one colour: it needs variation.
