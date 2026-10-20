---
looks: Flickering flames licking up from one edge, hot at the roots, fading clear at the tips.
---
Noise flames rise from the layer's edge in Direction, the last colour of the pick at their roots and cooling through
the earlier colours to clear at the ragged tips, flickering and boiling as they go. Use it for fire, heat and burning
moments; target it at the groups that should burn (each tower, the ground-level arches). **clouds** is the same noise
drifting rather than rising; **streaks** with a falling direction is rain; **climb** is a clean, staged rise up each
group rather than a flicker.

## Params
- colours: cool tip to hot root; give it a warm pick in order, e.g. `#300000 #ff2000 #ff9000 #fff0a0`. The default
  `all` puts the palette's lowest colour at the tips.
- direction: which way the flames rise, from the opposite edge: up (from the ground), down, right or left.
- speed: how fast the flames lick upward and boil. 0.6–1.5 is a hearth; 3–4 a blaze; 0 frozen.
- height: how far they reach; about this share of the layer, raggedly. 0.4 hugs the base; 1–1.5 fills it.
- size: a flame's width and length as a share of the layer. 0.2–0.4 for distinct tongues; above 1 one slow sheet.

## Pairings
- Over a dim warm `colour-wash` (`blend: "over"`) so the space above the flames glows rather than goes dark.
- Then `mirror` up-down: flames from top and bottom meeting in the middle.
- Bind speed (and height) to the `energy` global so the fire roars as the show builds.
- With a warm `sparkle` after it (`blend: "over"`, low density) for glinting embers.

## Pitfalls
- The flames start from the edge of the whole layer: on a layer spanning the rig, `up` burns from the ground only, and
  the spires stay dark unless height is near 1.5 or the layer targets them alone.
- Small size on the sparse spires reads as speckle, not flame.
