---
looks: Cellular automaton cells blinking and drifting along every strand, generation by generation.
---
A one-dimensional cellular automaton lives on each strand: every generation each LED lives or dies by its neighbours,
crossfading over half a generation, and the strand starts afresh from random cells after each era. Each strand steps
on its own beat, so the rig never blinks as one. It reads as restless, generative texture: busy machinery, data, a
lit-window flicker. Live cells take the colour of their place along the wire. Reach for **sparkle** for random glints
without structure, **single-strand** for orderly motion along the wire.

## Params
- colours: a ramp along each wire (first colour at its start, last at its end) painted onto the live cells.
- speed: generations a second. 2–6 reads as evolving; 10+ is a seethe.
- rule: the Wolfram rule. 30 chaos, 110 gliders, 90 and 150 dense chequers, 184 cells drifting one way like traffic,
  170 and 240 slide the random cells one LED a generation (a chase of random bits), 204 freezes.
- era: generations before a new random start; short eras keep it lively, long ones let a rule settle.
- density: share of cells alive at the start. 0.1–0.2 for sparse gliders, 0.5 for full chaos.

## Pairings
- Blend `over` or `add` on a dim `colour-wash` bed; dead cells are clear.
- Then `blur` along each strand to soften single-LED cells into glowing clusters.
- On `window` or `rose` petals as a busy stained-glass flicker under a calmer layer.

## Pitfalls
- Odd rules (1, 51, …) bring empty runs alive: whole strands invert every generation. Above 6 a second that is
  large-area flashing and fails the flash check.
- The pattern is only ever the current generation: rule 90's triangles never appear as a picture.
- Short strands (13–14 LEDs) wrap round and fall into short repeating loops; give them a short era.
