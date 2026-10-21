---
looks: Comet-tailed bands surge from front to back once a beat, over a base colour.
---
Beat-locked motion front to back on the whole rig, alternating between moving and pausing. **depth-wave** rolls
smoothly with no beat; **marquee** chases along wires.

## Overrides
- bars.speed: the hold LFO's `rate` is surges a beat; `center` 0.5 and `depth` 0.5 alternate between 0 and 1
  bar a second. At 120 bpm the average advance is a quarter of a bar per beat. A plain number glides steadily.
  If `depth` > `center`, motion reverses for part of each beat.
- bars.bars: 2 bold, 5 busy.
- bars.direction: `front` toward the audience.
- bars.colours: the bands. colour-wash.colours: the bed.

## Pitfalls
- A flat group (the rose alone) has no depth: it pulses as one, and above 3 Hz that is flashing.
