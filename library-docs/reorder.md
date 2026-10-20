---
looks: Rings along the wiring from the rose, the rig as one long row, or a sweep turned to a dissolve.
---
Gives the modules above it a new order, read as `out` and `in` (`clockwise` stays). By `wires`, how far each LED is
along the wiring from `from`: a ring from the rose runs out ring by ring, over the arches and up the spires instead of
through the air. By `strands` or `groups`, the layer as one row, strand after strand or group after group. By
`random`, a fixed shuffle, so a sweep or an **edge-fade** wipe becomes a dissolve. Put it below the sources and
filters it orders; **anchor** moves a centre instead.

## Params
- by: `wires` for ripples and growth along the rig; `strands` for a chase that runs the whole rig as one strand.
- from: a tag starts at each of its groups' hearts (the rose's centre, each tower's middle); `bottom` grows from each
  piece's feet, `top` falls from its tops. `rose` stands for the window and its rings too: they share its heart.
- reach: 0 makes the farthest wire the edge. Less packs the order near `from`; LEDs past it repeat or go dark.
- amount: 0.3–0.6 bends a straight-line ring toward the wiring without losing its shape.
- seed: A stepped LFO on it deals a new shuffle each step.

## Pairings
- **bars** `in` with `pulse`, reorder `wires` from `rose`: rings run out of the rose and along every arch.
- **edge-fade** `out` with a bound Position, reorder `random`: the layer sprinkles on and off.
- **bars** `out`, reorder `strands`: bands pass strand by strand round the rig.

## Pitfalls
- Only `out` and `in` follow the order; `up`, `along` and the rest read the place as before.
- Pieces the wiring never reaches from `from` start a little after their straight-line distance.
- A `from` tag with no groups on the rig (City of Gods has no `canopy`, `front` or `back`) leaves it as it was.
