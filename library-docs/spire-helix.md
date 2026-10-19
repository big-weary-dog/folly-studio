---
looks: Candy-cane stripes spiralling up round each tower and turning.
---
Two-colour stripes (`body` and `accent`) wind four times round each tower from bottom to top and turn, so they
appear to climb like a barber's pole: **lighthouse** in stripes mode, round an upright axis, moved by **anchor** to
the nearest tower so each tower turns on its own axis. Made for the towers and their spires (the eight globe
strands make a true cylinder). **rising-sweep** climbs without turning; **lighthouse** with beams sweeps a
searchlight round instead.

## Overrides
- lighthouse.twist: turns of the helix over the layer's height; 0 for upright stripes, 8 for a tight coil;
  negative for the other hand.
- lighthouse.spin: turns a second; 0.3 climbs steadily; negative descends; 0 holds still.
- lighthouse.beams: number of stripes round; 1–4.
- lighthouse.width: share of each stripe spent blending into the next; 0.05 crisp, 0.5 soft.
- lighthouse.colours: stripe colours, dealt in turn; `body/accent` or `rainbow`.
- lighthouse.profile: `beams` turns it into narrow beams with an afterglow (then glow and edge matter).
- anchor.tag: `spire` for the spire strands only, `spirelet` for the spirelets; anchor.which `first` turns
  everything round one axis.

## Pairings
- On the `tower` and `spire` groups, with a separate layer on the arches.
- Bind lighthouse.spin to energy so the helix spins up as the music builds.

## Pitfalls
- Place it on round groups: a flat group (the rose, an arch) has no "round" and shows sliding diagonal stripes.
- On the whole rig every LED turns round its nearest tower, including the arches; place it on tower groups.
- Twist counts turns over the layer's whole height, so adding low groups stretches the coil on the towers.
