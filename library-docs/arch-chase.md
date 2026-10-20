---
looks: The arches light one after another, each filling along its wire, then fading.
---
A procession through the arches, bay by bay. Copy the recipe into `modules` to change the tag.

## Overrides
- in-turn.every: seconds between arches; 0.5–1 stately, 0.3 brisk.
- in-turn.release: 0.5 leaves only the current arch lit; 3+ a long wake.
- in-turn.gate: `flash` lights each arch whole; `pass` sends a band up it.
- in-turn.start: `back` reverses; `random` shuffles the order.
- in-turn.attack: time for each arch to fill.

## Pitfalls
- `flash` with short attack and release can fail the flash check.
