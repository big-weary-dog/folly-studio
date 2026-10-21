---
looks: A forked, jagged bolt striking down the layer at random moments, then fading.
---
A forking bolt strikes in under 0.1 s and fades in about 0.5 s, at random moments (never over one a second, so it
passes the flash check). **streaks** for many falling lines, **shockwave** for a burst from a point, **storm** for
bolts in clouds.

## Params
- colours: `"accent high"` gives a blue glow round a white core.
- speed: 0.2–0.4 a distant storm, 0.7–0.8 a close one.
- width: Half-width as a share of the layer; below 0.04 can miss sparse LEDs.
- jag: 0.2 natural, 0.4+ wild.

## Pairings
- Bind speed to `energy` (0.2 to 0.7) so strikes quicken.
- On `spire` or `tower`, blend `add` over any bed.
- Then **rotate**: Angle 0.5 strikes upward; ±0.25 strikes sideways.

## Pitfalls
- Bolts land in the middle 70% of the layer's width: on a layer with a gap (both towers) they can fall in it.
- Two bolts sometimes overlap.
