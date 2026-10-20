---
looks: Centres everything round a group: rings from the rose, spirals round each tower.
---
Moves the layer's centre (what `out`, `in` and `round` measure from, and the middle that other warps fold and turn
round) to the middle of a tagged group: the rose, a tower, each tower at once. Nothing moves on its own; it changes
what the modules above it treat as the centre. A warp, and the one that goes last among the warps: put it below the
sources and the other warps, so the warps above it (kaleidoscope, polar, mirror, twist) work round the group too.
Reach for it whenever a radial look should belong to a structure (presets rose-ripple, rose-chase, rose-bloom,
spire-helix); **polar** and **kaleidoscope** shape round the centre that anchor chooses.

## Params
- tag: the group to centre on. Tags with no group on the rig make it do nothing.
- which: `first` centres on one group with that tag; `nearest` gives each LED its nearest group, so every tower or
  every mini arch gets its own copy of the effect.
- shape: how distance is measured. `facade` in the front plane (rings on the portal); `plan` round an upright axis,
  as seen from above (for towers and spires: `round` then turns round each spire); `sphere` in 3D.
- reach: the distance in metres that counts as the rim (r = 1). 0 uses the layer's farthest corner (or, with
  `nearest`, half the gap between the two closest groups). Rose-ripple uses 30 to cover the portal smoothly.
- lineup: uses the whole rig's across, up and depth instead of the layer's, so layers on different groups line up
  (a sweep crossing tower and arch layers at the same moment).

## Pairings
- Bars on `in` (pulse, negative speed) then anchor `rose`, `sphere`: rings from the rose (preset rose-ripple).
- Lighthouse in `stripes` then anchor `tower`, `nearest`, `plan`: helices round each spire (preset spire-helix).
- Kaleidoscope or radial-repeat, then anchor `rose`: a kaleidoscope in the window.
- Edge-fade on `in` with a bound position, then anchor: the rose opens ring by ring (preset rose-bloom).

## Pitfalls
- A warp below anchor still works round the layer's own centre, not the group's: keep anchor the lowest warp.
- `first` on a tag with several groups (tower, arch-mini) picks just one; use `nearest` for all of them.
- Small reach makes everything beyond it r > 1, where many sources go dark or repeat.
- With lineup on, warps above that move (mirror, rotate, scroll across) still move in the layer's own box, so they
  land off target.
