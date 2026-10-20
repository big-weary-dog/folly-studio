---
looks: Whole strands light in turn, each filling along its wire behind a bright head, then fading.
---
Strands take turns: each fills along its wire from its start, a glint of the last colour at the moving head, holds,
then fades while the next one fills. On the arches it walks bay by bay, front to back; on each tower it steps round the
spire's strands; on the rose it turns petal by petal. The turn order is the rig's wiring order, wrapped by count. Reach
for **single-strand** for continuous chases along every strand at once, **climb** for colour rising up a group by
height, **bars** on `back` for a smooth wave front to back.

## Params
- colours: a ramp along each wire (first colour at its start, last at its end); the head glints in the last colour.
- speed: strands a second. 0.5–1 is stately, 2–3 a brisk procession. A full cycle takes count ÷ speed seconds.
- count: how many strands take turns; strands count apart in wiring order light together. 5 for the main arches, 8 for
  a tower's spire strands (both towers in step), 16 for the rose petals, 4 to fire rose quarters together.
- fade: how long a strand glows after its turn, in turns. 0.5 leaves only the current strand; 3+ leaves a long wake,
  and with a small count nothing ever goes dark.

## Pairings
- Blend `over` a dim `colour-wash` bed so the dark between turns is coloured.
- Place on `arch-main` for the procession down the nave; on `spire` or `rose` with count matched to their strands.
- Add `sparkle` above in `high` for glitter on the lit strand.

## Pitfalls
- count is not the number of strands in the layer: it wraps the rig's wiring index, so on a mixed layer unrelated
  strands share a turn. Keep each layer to one kind of strand.
- Each strand lights speed ÷ count times a second; small count with high speed (2 at 6) is whole arches flashing at
  3 Hz and fails the flash check.
