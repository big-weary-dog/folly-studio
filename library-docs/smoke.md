---
looks: A trail that drifts, spreads and fades as it goes: rising smoke, embers, dripping paint.
---
Light leaves a trail that drifts along each strand in Direction, widens, wobbles and fades, then whatever is drawn now
shows over it. A **single-strand** chase leaves plumes climbing the arches, **sparkle** turns to rising embers,
**heartbeat** rises in rings. **trails** fades in place without moving; **delay** replays exactly, later.

## Params
- direction: `up` for smoke and embers; `down` drips; `out` and `in` along the rose's petals.
- drift: 0.2–0.4 drips slowly; 1–2 rises like smoke.
- spread: 0.5–1 blooms soft plumes; 0 keeps thin streaks.
- fade: 0.2 lingers and stacks up; 0.7 leaves short wisps.
- curl: 0.5–1 puffs and stalls in billows.

## Pairings
- sparkle → smoke `up`, drift 1, fade 0.5: embers rising off the arches.
- Dripping paint: colour bars → smoke `down`, drift 0.3, spread 0.2, fade 0.15, curl 0.6.

## Pitfalls
- It ends a stage: warps below it don't bend what is above; put warps above it.
- It drifts along the wire, by each LED's place in space (`up` climbs both legs of an arch to the apex): a strand
  that runs level barely moves, and the trail never jumps between strands (the neighbour map's links() could, later).
- A bed above it covers the trail; put beds below with blend `under`.
- Seeking back or jumping half a second clears it.
