---
looks: Centres everything round a group: rings from the rose, spirals round each tower.
---
Moves the layer's centre (what `out`, `in` and `round` measure from, and the middle that other warps fold and turn
round) to the middle of a tagged group: the rose, a tower, each tower at once. Nothing moves on its own; it changes
what the modules above it treat as the centre. A warp, and the one that goes last among the warps: put it below the
sources and the other warps, so the warps above it (polar, mirror, twist) work round the group too.
Reach for it whenever a radial look should belong to a structure (presets rose-ripple, rose-chase, rose-bloom,
spire-helix); **polar** and **mirror**'s Wedges and Rings shape round the centre that anchor chooses.

## Params
- tag: City of Gods has no `canopy`, `front` or `back` groups; a tag with no group on the rig does nothing (the
  checker warns). `arch` is all the arches as one group: use `arch-mini` or `arch-quad` with `nearest` for each.
- which: `nearest` gives every tower or every mini arch its own copy of the effect.
- shape: `facade` puts rings on the portal; use `plan` for towers and spires, where `round` then turns round each spire.
- reach: In metres; the edge is r = 1. 0 uses the layer's farthest corner (or, with `nearest`, half the gap between the
  two closest groups, ignoring nested ones under 0.5 m apart). Rose-ripple uses 30 to cover the portal smoothly.
- lineup: Use it for a sweep crossing tower and arch layers at the same moment.

## Pairings
- Bars on `in` (pulse, negative speed) then anchor `rose`, `sphere`: rings from the rose (preset rose-ripple).
- Bars `orbit` with Twist, then anchor `tower`, `nearest`, `plan`: helices round each spire (preset spire-helix).
- Mirror with Wedges or Rings, then anchor `rose`: a kaleidoscope or a tunnel in the window (presets kaleidoscope,
  tunnel).
- Edge-fade on `in` with a bound position, then anchor: the rose opens ring by ring (preset rose-bloom).

## Pitfalls
- A warp below anchor still works round the layer's own centre, not the group's: keep anchor the lowest warp.
- `first` on a tag with several groups (tower, arch-mini) picks just one; use `nearest` for all of them.
- Small reach makes everything beyond it r > 1, where many sources go dark or repeat.
- With lineup on, warps above it (mirror, rotate, scroll) move in the whole rig's box, not the group's.
- With `plan`, `a` is a plan angle: a turning warp above anchor (mirror's Wedges, twist) turns it in the façade instead.
