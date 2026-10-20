---
looks: A forked, jagged bolt striking across the layer at random moments, then fading.
---
A thin bolt shoots in Direction across the layer in under a tenth of a second, forks below a random point toward
where it lands, flares and fades in about half a second, then strikes again somewhere else. Strikes come at random
moments, on average Speed a second and never above one, so it stays clear of the flash check. Its core is the last
colour; the thin glow round it walks back through the others. Reach for **streaks** for many falling lines,
**shockwave** for a burst from a point, the preset storm for bolts in clouds.

## Params
- colours: `"accent high"` gives a blue glow round a white core.
- speed: 0.2–0.4 for a distant storm, 0.7–0.8 for a close one; the fade stays the same.
- width: Half-width as a share of the layer. 0.04–0.08 reads on sparse LEDs; thinner can miss them.
- jag: 0.2 is natural, 0.4+ wild.
- glow: 0.02–0.06 is a halo; 0.15 lights a broad band round the bolt.

## Pairings
- After `clouds` as input with `mask` over a dim accent bed: bolts out of rolling cloud (storm).
- Bind speed to the `energy` global (0.2 to 0.7) so strikes come faster as the storm builds.
- On `spire` or `tower` for strikes down the towers; blend `add` over any bed.

## Pitfalls
- The bolt lands somewhere in the middle 70% of the layer's width; on a layer with gaps (both towers and nothing
  between) it can fall in the gap and show little.
- A strike can come while the last one fades: two bolts at once now and then.
