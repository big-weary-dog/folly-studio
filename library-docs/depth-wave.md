---
looks: Smooth bands of colour rolling from the front of the layer to the back, leaning up.
---
Colours roll front to back through the layer, alternating `accent` and `low` in a smooth gradient, the bands tilted
so their tops lead: **bars** (direction `back`, smooth) tipped by **rotate** in the side plane. It uses the rig's
depth, so the front towers, the portal and the arches behind light in turn: a wave washing through the building.
**nave-procession** steps comets the same way on the beat; **rising-sweep** goes up rather than back.

## Overrides
- bars.speed: how fast the waves roll; 0.2 is slow; negative rolls them toward the front.
- bars.bars: how many waves fit front to back; 1.5 gives one and a half; 3–4 stripes.
- bars.colours: the wave's colours; `accent/low` alternates bright and dark, `all` walks the palette.
- bars.direction: `front` to come toward the audience; `right` for a wave across.
- rotate.angle: the lean; 0 is upright fronts, −0.1 leans hard, positive leans the other way.

## Pairings
- On the whole rig, where depth separates towers, portal and arches; under a sparse **sparkle** layer.
- Bind bars.speed to energy for a swell that quickens.
- Put **edge-fade** (direction `back`) after it to fade it out toward the back of the rig.

## Pitfalls
- Needs depth: on a flat group (the rose, a single arch) the whole group changes colour at once, not a wave.
- rotate.spin tumbles the wave round; usually unwanted, leave it at 0.
