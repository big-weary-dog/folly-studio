---
looks: The layer fading out toward one edge, or a soft wipe that grows across the layer.
---
What is above it fades to transparent toward one edge of the layer, Direction naming where it fades in from (`up`:
clear at the ground, full higher up), so it melts into what is below. Move Position and the edge travels: bound to an
lfo it is a wipe, and with Invert it is a fill level (a colour swelling up from the ground, preset wash-breathe). A
filter: it reworks what is above it in its chain, by transparency; sources below it are not faded. With `in` after
**anchor** it opens the rose ring by ring (preset rose-bloom). **mask** cuts by a source's shape instead of a
direction; **bars** with one bar draws a moving edge itself.

## Params
- direction: where it fades in from: up (from the ground), down (from the top), right, left, back, front, out (from
  the centre), in (from the rim), round, along (from each wire's start).
- position: where the edge starts, 0..1 along Direction. 0 starts the fade at the near edge; 1 hides everything.
  Bind it to an lfo or a cue for a wipe.
- width: how long the ramp from clear to full is. 0.05–0.1 a crisp edge (a wipe); 0.3–0.6 a soft gradient.
- both: also fades toward the far edge; that edge stays at the layer's end while Position moves the near one.
- invert: shows the near side instead: visible up to the edge, clear beyond. With a moving Position it is a fill
  level.

## Pairings
- Colour-wash, then edge-fade `up` inverted with position on a sine lfo, then a dim wash blend `under`: a breathing
  fill (preset wash-breathe).
- Bars on `in`, edge-fade `in` (width 0.08) with a hold lfo on position, then **anchor**: the rose blooms.
- Fire or clouds with edge-fade `down` (width 0.5): flames that fade before the top of the arches.

## Pitfalls
- It only makes things transparent: on the top layer over nothing it is a fade to black, under other layers they
  show through.
- A narrow width with a fast position wipe over the whole rig flips large areas fast; over 3 Hz fails the flash check.
- Width under ~0.05 aliases on sparse LEDs into a ragged edge.
