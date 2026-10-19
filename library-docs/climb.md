---
looks: A column of colour rising up the layer behind a bright head, crowning the top, lifting off.
---
Colour climbs the layer from the ground behind a bright head of the last colour, flares as a crown when it reaches the
top, then its foot rises after it and the column lifts away off the top, again and again. Each group with the tag
starts at a staggered time, so towers climb one after the other. Made for towers and spires; a rising tide on any
tall group. Reach for **bars** with one bar on `up` for a continuous upward sweep, **groups-in-turn** for strands
lighting in turn along their wires, **shockwave** for a single burst.

## Params
- tag: With a tag on one group, each of its smallest parts climbs apart. `all` sets each spire, arch and petal on its
  own.
- speed: Rises a second. 0.15–0.3 is a slow ascent; 1 is a rush each second.
- stagger: A share of a rise; each group gets a random offset up to it.
- head: 0.04–0.1; larger washes the column toward the last colour.

## Pairings
- Place on `tower` or `spire` (and `spirelet`) with a dim `colour-wash` bed below.
- Add `sparkle` in `high` above for glitter on the rising column.
- Bind speed to the `energy` global for a quickening ascent at a build.

## Pitfalls
- Height is the layer's, not each group's: on a layer of towers and arches the arches only light as the column passes
  their height. Give low and tall groups separate layers.
- LEDs in no group with the tag climb together; pick a tag the layer's groups carry (`all` always works).
- The crown flashes the top third of the layer once a rise; at speed 1 on big groups keep level moderate.
