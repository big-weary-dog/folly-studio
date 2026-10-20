---
looks: White-headed cyan comets race along every strand over deep blue, each at its own pace.
---
Bright comets with white heads and short cyan tails shoot along every strand over a dark blue sky, then a pause
before the next pass; every strand starts and runs at its own pace, so they never line up: **single-strand**
(comet, lap, scatter) over a still **colour-wash**. Fixed colours, ignoring the palette. Space, falling stars, a
busy chase that still reads calm. **streaks** falls in space (straight down regardless of wiring); **marquee** is
a regular stepping chase.

## Overrides
- single-strand.speed: LEDs a second; 60 is fast, 20 leisurely; negative runs them the other way along the wire.
- single-strand.tail: tail length in LEDs; 3 for sparks, 30 for long trails.
- single-strand.lap: clear LEDs after each pass, the pause between meteors; 0 for a continuous stream.
- single-strand.size: spacing between comets on one strand; under the strand length puts several on it at once.
- single-strand.scatter: 1 for every strand on its own; 0 sends them all together as a wall.
- single-strand.colours: tail to head; set roles (`accent high`) to follow the palette.
- single-strand.mode: `bounce` sweeps back and forth (ignores lap); `in` or `out` from strands' middles.
- colour-wash.colours: the sky.

## Pairings
- On the arches and spire strands, the longest wires; with a **clouds** or **starfield** layer under it.
- Bind single-strand.lap to energy (`from` 200 `to` 0) so meteors come thicker as the show builds.

## Pitfalls
- Direction follows the wiring, not space: on strands wired top-down they fall, bottom-up they rise. Use a negative
  speed or `alternate` to fix the odd ones.
- On short fixtures (rose cells, spirelets) a pass lasts a blink, so they flicker rather than streak.
