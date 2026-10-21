---
looks: High heads with accent tails race along every strand over a dim low bed, each at its own pace.
---
A busy chase that still reads calm: space, falling stars. **streaks** falls straight down in space; **marquee** is a
regular stepping chase.

## Overrides
- single-strand.speed: LEDs a second; 20 leisurely, 60 fast.
- single-strand.tail: 3 for sparks, 30 for long trails.
- single-strand.lap: the pause between meteors; 0 a continuous stream.
- single-strand.size: under the strand length puts several comets on it.
- single-strand.scatter: 0 sends all strands together as a wall.
- single-strand.colours: tail to head.
- single-strand.mode: `bounce` back and forth; `in`/`out` from strand middles.
- colour-wash.colours: the sky.

## Pairings
- Bind single-strand.lap to energy (`from` 200 `to` 0) so meteors thicken as the show builds.

## Pitfalls
- Direction follows the wiring, not space; fix odd strands with negative speed or `alternate`.
- On short fixtures (rose cells, spirelets) they flicker rather than streak.
