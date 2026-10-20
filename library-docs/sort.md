---
looks: Pixel sorting along every strand: the bright light slides to one end in crisp, fizzing gradients.
---
Along each strand, every run of LEDs at least Cutoff bright has its colours sorted, the brightest toward Direction, so
light stacks up at one end and the pattern underneath reshuffles it every frame. Over **clouds** it makes calm sorted
ramps; over **sparkle** stacks of light pile up at the arch tops; over **fire** the flames gather in bands.

## Params
- by: `colour` lines the hues up in order instead of by brightness.
- direction: `up` piles the light at the tops of arches and spires; `start` and `end` follow each wire.
- cutoff: 0 sorts whole strands; 0.3–0.5 leaves short stacks between dark gaps.
- amount: 0.5 ghosts the sorted light over the original.

## Pairings
- sparkle → sort `up`, cutoff 0: light piling up at the arch tops.
- clouds → sort by `colour`, `end`: slow sorted rainbows along the wires.

## Pitfalls
- It ends a stage: warps below it don't bend what is above; put warps above it.
- On short strands (spirelets, petals) it does little; it reads on the long arch runs.
- A full bed (colour-wash) sorts to itself and shows no change: sort the element, then add the bed `under`.
