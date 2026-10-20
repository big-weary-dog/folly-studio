---
looks: Theatre-sign bulbs: short groups chasing along every strand, every other strand backwards.
---
Groups of seven lit LEDs and one dark run along every strand like the bulbs of a theatre marquee, alternating
`body` and `accent`, every other strand running the other way, over a `low` bed: **single-strand** (8 LEDs a band,
one dark, alternate) over a **colour-wash**. Bright, rhythmic and cheerful: openings, fairground, applause.
**meteors** is scattered comets; **bars** with `along` gives smooth bands on the wires without the gaps.

## Overrides
- single-strand.speed: LEDs a second; 6 is a stroll. Bind to an LFO `hold` in beats for a step per beat.
- single-strand.size: LEDs per bulb group; 3 for tight bulbs, 12 for long dashes.
- single-strand.gap: dark share of each group; 0.12 leaves one dark in eight, 0.6 two lit in five, 0 a continuous chase.
- single-strand.softness: 0 hard bulbs that pop on and off; 3 glides smoothly.
- single-strand.alternate: off sends every strand the same way.
- single-strand.mode: `out` runs from each strand's middle to its ends; `bounce` back and forth.
- single-strand.colours: the bulbs, dealt in turn; colour-wash.colours: the bed.

## Pairings
- On the arches (arch-main, arch-quad) for the sign effect; leave the rose to something radial.
- With the bed dimmed (colour-wash.brightness 0.3) so the bulbs carry.

## Pitfalls
- Each LED blinks at speed ÷ size Hz: speed 48 with size 8 is 6 Hz over the whole rig and fails the flash check.
- Direction follows the wiring; `alternate` flips by strand number, not by side, so pairs may not mirror.
