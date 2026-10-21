---
looks: The arches light one after another, each filling along its wire, then fading.
---
A procession through the arches, bay by bay. Change in-turn.tag to target other groups.

## Overrides
- in-turn.every: seconds between arches; 0.5–1 stately, 0.3 brisk.
- in-turn.release: 0.5 a short overlapping wake; 3+ a long one. With every 1 s and attack 1 s, release 0
  leaves only the current arch lit.
- in-turn.gate: `flash` lights each arch whole; `pass` sends a band up it.
- in-turn.start: `back` reverses; `random` gives each arch a fixed random start within the cycle.
- in-turn.attack: time for each arch to fill.

## Pitfalls
- `flash` with short attack and release can fail the flash check.
