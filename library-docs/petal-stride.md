---
looks: The rose window's petals reordered, every third or fifth, so neighbouring colours make spokes.
---
Reorders the rose's petals: petal p shows petal p × Stride, each cell in place, so one sweep of colour becomes repeating
spokes while every petal still shows once. Goes after the source; only the rose changes. **petal-repeat** repeats
petals for symmetry; **ring-turn** turns the rings.

## Params
- stride: odd only, so every petal shows once; 3 or 5 split the most; 1 changes nothing; 15 reverses the order.
- offset: turns the whole result by petals.

## Pairings
- After **bars** `right` or `clockwise`, or **clouds**: neighbouring colours alternate round the rose.

## Pitfalls
- 15 reverses which petal goes where, not the cells inside each: it is no mirror.
- A source the same in every petal shows no change; random sparkle stays random.
