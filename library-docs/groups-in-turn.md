---
looks: Groups light in turn by tag, each filling along its wire (or flashing) and then fading.
---
The rig's groups take turns. Each group with the tag (or, when one group has it, each of that group's smallest
parts: each arch of the arches) lights in turn, filling along its wire from its start with a glint of the last colour
at the moving head, or all at once with `flash`, then fades while the next one goes. On `arch` it walks bay by bay;
on `spire` it steps round the spires; on `rose` it turns petal by petal. LEDs in no such group stay clear. Reach for
**single-strand** for continuous chases along every strand at once, **climb** for colour rising up each group by
height, **bars** on `back` for a smooth wave front to back.

## Params
- tag: Use a tag the layer's groups carry; otherwise nothing lights.
- speed: 0.5–1 is stately, 2–3 a brisk procession. A full cycle takes (number of groups) ÷ speed seconds.
- fade: 0.5 leaves only the current group lit; 3+ leaves a long wake, and with few groups nothing ever goes dark.

## Pairings
- Blend `over` a dim `colour-wash` bed so the dark between turns is coloured.
- `tag: "arch-main"` for the procession down the nave; `spire` or `rose` to step round those.
- `order: "bounce"` with `fill: "flash"` for a call-and-response between the ends of a row.
- Add `sparkle` above in `high` for glitter on the lit group.

## Pitfalls
- Each group lights speed ÷ (number of groups) times a second; few groups at high speed with `flash` (2 groups at
  6) is whole arches flashing at 3 Hz and fails the flash check.
- With a tag on many unrelated groups (`all`, `left`), the turn order is the rig's order, not a path you would walk.
