---
looks: Beams sweeping round an upright axis like a lighthouse, each trailing a fading glow.
---
Two beams turn round the layer's upright axis, across the front and round the back, each leaving a fading wake:
**bars** on `orbit` with two comet bars, cream and magenta. On a tall layer the beams are upright lines sweeping side
to side; on a flat one they turn in its face like clock hands. Reach for **spire-helix** for stripes winding round the
towers, **galaxy** for spiral arms, **bars** on `round` for comets chasing a circle in the façade.

## Overrides
- bars.speed: bars a second, so with 2 beams 0.4 is one turn every 5 s; negative turns the other way.
- bars.bars: how many beams share the circle; 1–4.
- bars.duty: the beam and its wake together; 0.3 a short tail, 0.9 a long one.
- bars.colours: the beams' colours in turn; `high` for one warm white.
- bars.twist: winds the beams with height into a spiral.

## Pairings
- Then `anchor` (tag `tower`, which `nearest`, shape `plan`): a beam turning round each tower on its own axis.
- Over a dim `colour-wash` with `blend: "over"` so the dark between beams keeps a colour.
- Then `trails`: light-painted circles.

## Pitfalls
- On a group seen only from the front (an arch) orbit reads as a band sliding sideways and back, not a turning beam.
- Each LED is passed speed times a second; over 3 a second on the whole rig is flashing.
