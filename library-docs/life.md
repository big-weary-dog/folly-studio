---
looks: Cellular automaton cells blinking and drifting along every strand, generation by generation.
---
A 1-D automaton on each strand, reseeded each era; strands step out of sync, so the rig never blinks as one.
Restless, generative texture: machinery, data, window flicker. **sparkle** is unstructured glints; **single-strand**
orderly motion along the wire.

## Params
- speed: 2–6 evolves; 10+ seethes.
- by: Binary lights every LED: dead cells the first colour, live the last; other modes leave dead cells clear.
- density: 0.1–0.2 for sparse gliders, 0.5 for chaos.

## Pairings
- Over a dim **colour-wash** bed; **blur** along strands softens cells into clusters.

## Pitfalls
- Binary or a rule that flips whole strands swaps large areas each generation: above ~4–6 a second it fails the flash
  check unless the two colours are close in brightness.
- Short strands (13–14 LEDs) loop quickly; give them a short era.
