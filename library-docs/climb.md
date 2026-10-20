---
looks: A column of colour rising up the layer behind a bright head, crowning the top, lifting off.
---
Colour climbs the layer from the ground behind a bright head of the last colour, flares as a crown when it reaches the
top, then its foot rises after it and the column lifts away off the top, again and again. Groups wired as separate
zones start at staggered times, so towers climb one after the other. Made for towers and spires; a rising tide on any
tall group. Reach for **bars** with one bar on `up` for a continuous upward sweep, **arch-chase** for strands
lighting in turn along their wires, **shockwave** for a single burst.

## Params
- colours: a ramp up the height (first at the foot, last at the top); the head and crown are the last colour.
- direction: `up` climbs from the ground; `down` pours from the top.
- speed: rises a second. 0.15–0.3 is a slow ascent; 1 is a rush each second.
- stagger: how far apart the zones start, as a share of a rise (each zone a random offset up to it). 0 climbs as one.
- head: length of the bright head. 0.04–0.1; larger washes the column toward the last colour.

## Pairings
- Place on `tower` or `spire` (and `spirelet`) with a dim `colour-wash` bed below.
- Add `sparkle` in `high` above for glitter on the rising column.
- Bind speed to the `energy` global for a quickening ascent at a build.

## Pitfalls
- Height is the layer's, not each group's: on a layer of towers and arches the arches only light as the column passes
  their height. Give low and tall groups separate layers.
- Stagger follows wiring zones, not tags: groups that share a zone (the five main arches do) always climb together.
- The crown flashes the top third of the layer once a rise; at speed 1 on big groups keep level moderate.
