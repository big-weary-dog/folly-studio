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
- direction: Down fades in from the top; out from the centre, in from the rim, along from each wire's start.
- position: 0 shows everything, 1 hides it; the default 0.25 fades in over the first third. Bind it for a wipe.
- width: 0.05–0.1 a crisp edge (a wipe); 0.3–0.6 a soft gradient.
- both: The far edge moves in with the near one, narrowing the band between them.
- invert: With a moving Position it is a fill level.

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
