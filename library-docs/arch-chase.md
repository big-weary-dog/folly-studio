---
looks: The arches light one after another, each filling along its wire, then fading.
---
**bars** along each wire, timed by **in-turn** on the arches: each arch fills along its wire, then fades while the
next one fills, bay by bay. Use it for a procession through the arches; copy its recipe into `modules` to change the
tag or the gate.

## Overrides
- in-turn.every: seconds from one arch to the next; 0.5–1 is stately, 0.3 a brisk procession.
- in-turn.release: 0.5 leaves only the current arch; 3+ leaves a long wake.
- in-turn.gate: `flash` lights each arch whole at once; `pass` sends a band up each arch.
- in-turn.start: `back` reverses the procession; `random` lights arches out of order.
- in-turn.attack: how long each arch takes to fill.

## Pitfalls
- Few arches with `flash` and short attack and release flash whole arches fast enough to fail the flash check.
