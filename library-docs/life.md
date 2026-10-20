---
looks: Cellular automaton cells blinking and drifting along every strand, generation by generation.
---
A one-dimensional cellular automaton lives on each strand: every generation each LED lives or dies by its neighbours,
crossfading over half a generation, and the strand starts afresh from random cells after each era. Each strand steps
on its own beat, so the rig never blinks as one. It reads as restless, generative texture: busy machinery, data, a
lit-window flicker. Live cells take the colour of their place along the wire. Reach for **sparkle** for random glints
without structure, **single-strand** for orderly motion along the wire.

## Params
- speed: Generations a second. 2–6 reads as evolving; 10+ is a seethe.
- era: In generations; short eras keep it lively, long ones let a rule settle.
- by: Age counts how many of a cell's last 3 generations it lived, so blinking chaos cells walk the colours too.
  Binary lights every LED: dead cells the pick's first colour, live ones its last (`low high`: magenta and cream).
- density: 0.1–0.2 for sparse gliders, 0.5 for full chaos.

## Pairings
- Blend `over` or `add` on a dim `colour-wash` bed; dead cells are clear.
- Then `blur` along each strand to soften single-LED cells into glowing clusters.
- On `window` or `rose` petals as a busy stained-glass flicker under a calmer layer.

## Pitfalls
- Odd rules (1, 51, …) bring empty runs alive: whole strands invert every generation. Above 6 a second that is
  large-area flashing and fails the flash check.
- The pattern is only ever the current generation: rule 90's triangles never appear as a picture.
- Binary keeps every LED lit, so a fast rule swaps large areas between the two colours: keep their brightness close
  or the speed under 4.
- Short strands (13–14 LEDs) wrap round and fall into short repeating loops; give them a short era.
