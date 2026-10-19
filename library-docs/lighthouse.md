---
looks: Beams of colour sweeping round like a lighthouse, trailing a glow; or turning stripes.
---
Narrow beams turn round the layer's centre, one colour each from the pick, every beam leaving a fading afterglow behind
it; with profile `stripes` the gaps fill instead, so coloured wedges or (with twist, round the towers) barber-pole
helices turn. Plane sets the axis: `plan` turns round an upright axis like a real lighthouse, `facade` spins like a
clock in the front plane, `side` turns seen from the side. Reach for **bars** on `round` for comets chasing a circle,
**kaleidoscope** to make mirrored wedges of another pattern, **twist** to wind an existing pattern into a spiral.

## Params
- plane: With `plan` the beams sweep across the front and round the back; a layer with no depth falls back to `facade`.
- spin: Turns a second; positive is clockwise. 0.1–0.3 is stately.
- width: For beams, a share of the gap between beams: 0.05 a needle, 0.5 half lit. For stripes, 0.5 is smooth, 0.05 hard
  edges.
- edge: Raise to 0.05–0.1 on sparse groups. Unused by stripes.
- glow: Unused by stripes.
- twist: In `plan` it winds with height, making helices up a tower; in `side` across. In `facade` the axis is depth, so
  on a flat façade twist does nearly nothing.

## Pairings
- Then `anchor` (tag `tower`, which `nearest`, shape `plan`): stripes spiral round each tower on its own axis
  (spire-helix: stripes, 2 beams, width 0.5, twist 4, spin 0.3).
- Then `anchor` (tag `rose`) with plane `facade`: beams sweeping round the rose window like a clock hand.
- Over a dim `colour-wash` with `blend: "over"` so the dark between beams keeps a colour.

## Pitfalls
- Narrow beams with a small edge on sparse LEDs flicker as they pass between them; widen width or edge.
- Each LED is passed spin × beams times a second; hard-edged stripes over 3 a second on the whole rig is flashing.
- `plan` on a group seen only from the front (an arch) reads as a band sliding sideways and back, not a turning beam.
