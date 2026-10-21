---
looks: Candy-cane stripes spiralling up round each tower and turning.
---
A barber's pole on each tower, each turning on its own axis. Made for the towers and spires. **rising-sweep** climbs
without turning; **lighthouse** sweeps beams.

## Overrides
- twist.wind: turns over the layer's height; 0 upright, 4 a tight coil; negative the other hand.
- bars.direction: `orbit-counterclockwise` or `orbit-clockwise` (as seen from above).
- bars.speed: negative reverses the turn.
- bars.bars: stripes round; 1–4.
- bars.profile: `step` for crisp stripes; `comet` for beams with a wake.
- anchor.tag: `tower` by default; `spire` or `spirelet` centres the bars on those groups instead.
- anchor.which: `first` centres the bars on one group; Twist still winds round the nearest tower.

## Pairings
- Bind bars.speed to energy so it spins up.

## Pitfalls
- Place it on tower groups: flat groups show sliding diagonals, and on the whole rig every LED turns round its
  nearest tower.
- Adding low groups stretches the coil, since the wind spans the layer's whole height.
