---
looks: Candy-cane stripes spiralling up round each tower and turning.
---
Two-colour stripes (`body` and `accent`) wind four times round each tower from bottom to top and turn, so they
appear to climb like a barber's pole: **bars** on `orbit` with a smooth profile and Twist, moved by **anchor** to
the nearest tower so each tower turns on its own axis. Made for the towers and their spires (the eight globe
strands make a true cylinder). **rising-sweep** climbs without turning; **lighthouse** sweeps beams round instead.

## Overrides
- bars.twist: turns of the helix over the layer's height; 0 for upright stripes, 6 for a tight coil;
  negative for the other hand.
- bars.speed: stripes a second; 0.6 climbs steadily; negative descends; 0 holds still.
- bars.bars: number of stripes round; 1–4.
- bars.profile: `step` (with softness) for crisp stripes; `comet` for beams with a wake.
- bars.colours: stripe colours, dealt in turn; `body accent` or `rainbow`.
- anchor.tag: `spire` for the spire strands only, `spirelet` for the spirelets; anchor.which `first` turns
  everything round one axis.

## Pairings
- On the `tower` and `spire` groups, with a separate layer on the arches.
- Bind bars.speed to energy so the helix spins up as the music builds.

## Pitfalls
- Place it on round groups: a flat group (the rose, an arch) has no "round" and shows sliding diagonal stripes.
- On the whole rig every LED turns round its nearest tower, including the arches; place it on tower groups.
- Twist counts turns over the layer's whole height, so adding low groups stretches the coil on the towers.
