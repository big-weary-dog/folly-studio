---
looks: A forked, jagged bolt striking across the layer every few seconds, then fading.
---
A bolt shoots in Direction from one edge of the layer to the other in a few hundredths of a second, forks partway,
flares and fades, then strikes again somewhere else. Strikes come on a steady beat at Speed, never above one a second,
so it stays clear of the flash check. Its core is the last colour; the glow round it walks back through the others.
Reach for **streaks** for many falling lines, **shockwave** for a burst from a point, the preset storm for bolts in
clouds.

## Params
- colours: glow (first) to core (last); `"accent high"` gives blue glow round a white core.
- direction: which way the bolt strikes: `down` from the top, `up`, `right` or `left` across.
- speed: strikes a second, evenly spaced. 0.2–0.4 for a distant storm, 0.7–0.8 for a close one.
- width: core half-width as a share of the layer. 0.02–0.05; wider looks like a beam.
- jag: how much it zigzags. 0 is a straight line, 0.2 natural, 0.4+ wild.
- glow: halo around the core. 0 is a bare line; 0.3–0.4 lights most of the layer with each strike.

## Pairings
- After `clouds` as input with `mask` over a dim accent bed: bolts out of rolling cloud (storm).
- Bind speed to the `energy` global (0.2 to 0.7) so strikes come faster as the storm builds.
- On `spire` or `tower` for strikes down the towers; blend `add` over any bed.

## Pitfalls
- Strikes are evenly timed, not random; for an irregular storm put two lightning layers at different speeds.
- The bolt lands somewhere in the middle 70% of the layer's width; on a layer with gaps (both towers and nothing
  between) it can fall in the gap and show only glow.
- Wide glow on the whole rig is a big bright flash each strike; under 1 a second it passes, but keep level moderate.
