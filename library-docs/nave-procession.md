---
looks: Comet-tailed bands step from front to back, a step every beat, over a base colour.
---
Three comet bands in `body` colours process from the front of the layer to the back over a still `low` bed, moving
in a step on each beat and pausing between: **bars** (direction `back`, comet, duty 0.3) whose speed rides a beat-
locked hold LFO, over a **colour-wash**. Stately and rhythmic, for marches, builds and any tempo-led section on the
whole rig. **depth-wave** rolls the same way smoothly with no beat; **marquee** steps along wires rather than space.

## Overrides
- bars.speed: the beat step. Its LFO's `rate` is steps a beat (0.5 for every other beat); `center` and `depth`
  equal set how far each step goes (0.5 each ≈ half a bar per beat; 1 each for a full bar). A plain number gives a
  steady glide with no beat.
- bars.bars: bands front to back; 2 for bold, 5 for busy.
- bars.duty: band length; lower for short comets with clear space between.
- bars.profile: `step` for blocky bands, `pulse` for soft ones.
- bars.direction: `front` to process toward the audience; `up` or `right` for other axes.
- bars.colours and colour-wash.colours: the bands and the bed.

## Pairings
- Set the look's `bpm` to the music: the steps follow it.
- On the arches and the towers together, where depth runs from the front towers back through the portal.
- With **wash-breathe** on a layer below for a living bed.

## Pitfalls
- If `depth` exceeds `center` the speed dips negative each beat, and comet tails flip back and forth.
- On a flat group (the rose alone) there is no depth: the whole group pulses on the beat. Over 3 Hz (fast tempo,
  rate > 1) that becomes large-area flashing.
