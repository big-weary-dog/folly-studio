---
looks: Centres everything round a group: rings from the rose, spirals round each tower.
---
Moves the layer's centre (what `out`, `in`, `clockwise`, `counterclockwise` and the other warps measure from) to a
tagged group: the rose, a tower, or each tower at once. Draws nothing; use it whenever a radial look should belong
to a structure (presets **rose-ripple**, **spire-helix**). Put it last among the warps.

## Params
- tag: City of Gods has no `canopy`, `front` or `back`. `arch` is all arches as one group; use `arch-mini` or
  `arch-quad` with `nearest` for each.
- which: `first` on a tag with several groups picks just one; `nearest` gives each its own copy.
- shape: `facade` for the portal; `plan` for towers and spires (`clockwise` and `counterclockwise` then turn
  round each spire).
- reach: 0 uses the farthest corner (with `nearest`, half the gap between the two closest groups). Too small leaves
  most LEDs past the edge, dark or repeating.
- lineup: For a sweep crossing tower and arch layers in step.

## Pairings
- Bars `orbit-clockwise` or `orbit-counterclockwise` with **twist**, then anchor `tower`, `nearest`, `plan`:
  helices round each spire.
- **mirror** Wedges or Rings, then anchor `rose`: a kaleidoscope or tunnel in the window.

## Pitfalls
- A warp below anchor still turns round the layer's centre: keep anchor the lowest warp.
- With lineup on, warps above it move in the whole rig's box, not the group's.
- With `plan`, a turning warp above it (mirror Wedges, twist) turns in the façade, not round the spire.
