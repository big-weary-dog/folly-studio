---
looks: The chain shown only through a shape: inside clouds, its own bright parts, or chosen rose panes.
---
Shows what is above it only where a shape is bright: an `as: "input"` source named by `input` (bars masked by clouds
give preset **aurora**), its own brightness (`self`), or rose panes (`region`, no input). **edge-fade** fades toward
an edge instead; **recolour** bands colours rather than cutting.

## Params
- by: `self` keys on luminance: dark blues go before yellows.
- amount: 0.6–0.8 leaves a dim ghost (preset **storm**).
- softness: 0.05 hard; 0.3–0.5 cloud-like. By region: 0.01 cuts at the lead lines.
- index: Bind to a step or beat to walk one region round the rose.

## Pairings
- With **scroll** `petal` below it, the picked petals turn round the rose.

## Pitfalls
- The input must be above the mask in the chain and have an id; with no input, by `input` does nothing.
- It hides beds above it too; put a bed below with blend `under`.
- By region off the rose gives rough wedges and rings, not panes.
