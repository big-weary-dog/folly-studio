---
looks: The chain shown only on the rose petals picked by number; the others hidden, or the other way round.
---
Shows what is above it only on the rose petals Petals names, petal 1 the top one and on clockwise: `1-4 9-12` two
opposite quarters, `1 5 9 13` a cross, `15-2` the four round the top. No input. **mask** by `region` picks by a rule
(odd petals, a spiral arm, rings); this picks exact petals.

## Params
- petals: spaces or commas between; empty shows none (Invert: all). A bad word is skipped.
- amount: 0.6–0.8 leaves the other petals as a dim ghost.
- softness: 0.01–0.05 cuts at the lead lines; 0.5–1 fades each petal into its neighbours.
- invert: hides the petals named and shows the rest.

## Pairings
- Over **bars** `clockwise` or **clouds**: colour moves through only the picked petals.
- With **scroll** `petal` below it, the picked petals turn round the rose.
- Two layers, each with its own petal-mask and source, give the rose two looks split by petal.

## Pitfalls
- Off the rose, a petal is a sixteenth of a turn round the layer's centre: rough wedges, not panes.
- It hides beds above it too; put a bed below with blend `under`.
