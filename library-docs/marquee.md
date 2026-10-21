---
looks: Theatre-sign bulbs: short groups chasing along every strand, every other strand backwards.
---
Openings, fairground, applause. **meteors** is scattered comets; **bars** `along` gives smooth bands without gaps.

## Overrides
- single-strand.speed: LEDs a second; 6 a stroll. Bind to an LFO `hold` in beats to alternate motion and pauses.
- single-strand.size: 3 tight bulbs, 12 long dashes.
- single-strand.gap: 0 a continuous chase.
- single-strand.softness: 0 hard bulbs, 3 glides.
- single-strand.mode: `out` from each strand's middle; `bounce`.

## Pairings
- On the arches (arch-main, arch-quad); dim the bed (colour-wash.brightness 0.3).

## Pitfalls
- Each LED blinks at speed ÷ size Hz: over 3 on the whole rig fails the flash check.
- `alternate` flips by strand number, not side, so pairs may not mirror.
