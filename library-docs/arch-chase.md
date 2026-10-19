---
looks: The arches light one after another, each filling along its wire, then fading.
---
groups-in-turn on the arches: each arch fills along its wire behind a bright head, holds, then fades while the next
one fills, bay by bay. Use it for a procession through the arches; copy its recipe into `modules` to change the tag
or the fill.

## Overrides
- groups-in-turn.speed: arches a second; 0.5–1 is stately, 2–3 a brisk procession.
- groups-in-turn.fade: 0.5 leaves only the current arch; 3+ leaves a long wake.
- groups-in-turn.fill: `flash` lights each arch whole at once.
- groups-in-turn.order: `back` reverses the procession; `bounce` goes to and fro.

## Pitfalls
- Few arches at high speed with `flash` flash whole arches fast enough to fail the flash check.
