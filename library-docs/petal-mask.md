---
looks: The chain shown only on the rose petals picked, and in each only the cells picked; or the rest.
---
Shows what is above it only on the rose petals Petals names, petal 1 the top one and on clockwise (`1-4 9-12` two
opposite quarters, `1 5 9 13` a cross, `15-2` the four round the top), and in each of those only the cells Cells
names: the same cells in every petal, 1 at the heart, ring by ring out (rings of 1, 2, 1, 2, 3, 2, 3 cells; `1-3` the
heart, `12-14` the tips). No input. **mask** by `region` picks by a rule (odd petals, a spiral arm, rings); this
picks exact petals and cells.

## Params
- petals: spaces or commas between; empty shows none (Invert: all). A bad word is skipped.
- cells: `1-14` the whole petal; `12-14` a ring of tips; `2 3 5 6 10 11` the petal's two edges.
- amount: 0.6–0.8 leaves the rest as a dim ghost.
- softness: 0.01–0.05 cuts at the lead lines; 0.5–1 fades each petal into its neighbours. Cells always cut hard.
- invert: hides the petals and cells named and shows the rest.

## Pairings
- Over **bars** `clockwise` or **clouds**: colour moves through only the picked petals.
- With **scroll** `petal` below it, the picked petals turn round the rose.
- Two layers, each with its own petal-mask and source, give the rose two looks split by petal or by cell.

## Pitfalls
- Off the rose, a petal is a sixteenth of a turn round the layer's centre and a ring a seventh of the way out: rough
  wedges, not cells.
- It hides beds above it too; put a bed below with blend `under`.
