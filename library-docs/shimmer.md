---
looks: Every LED glitters on its own in light colours over a slow gradient of body colours.
---
A soft gradient of the `low` colours creeps up the layer (**bars**, smooth, one bar, in a layer at level 0.6), and
over it every LED glitters independently in the `high` colours (**sparkle** in smooth mode at full density, in a
second layer on `add`): the bed always shows, and many LEDs at a time flare bright and fade. Sequins, frost, heat
haze. Reach for it as a textured bed that is alive without moving anywhere. **starfield** is sparse pulse glints on
a dark sky; plain **sparkle** in pulse mode gives discrete twinkles rather than a seething surface.

## Overrides
- sparkle.rate: how fast each LED glitters. 8 shimmers; 1–2 is a slow twinkle; above 12 it reads as static.
- sparkle.sharp: how rare the bright moments are. 3 is lively; 1–2 floods the layer with the high
  colour; 6–8 leaves only the odd spark.
- sparkle.density: share of LEDs that glitter; 0.3 leaves most of the bed still.
- sparkle.colours: the glitter colours.
- The bed layer's level: 0.6 keeps the glitter on top; 1 for a brighter bed.
- bars.colours and bars.speed: the bed's colours and how fast its gradient climbs (0 to hold it).
- bars.direction: which way the bed's gradient runs (`round`, `out` …).

## Pairings
- On the whole rig as a bed, with a slow sweep layer above on `add`.
- Bind sparkle.rate or sparkle.density to energy for a surface that boils up as the music builds.
- Put **mask** with an input of **clouds** after it to glitter only in drifting patches.

## Pitfalls
- High rate with low sharp makes most of the rig flicker at once; keep sharp ≥ 3 when rate is above 6.
- On sparse groups (spirelets) one LED per fixture glitters as a whole fixture blinking.
