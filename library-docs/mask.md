---
looks: The chain shown only through a shape: inside clouds, its own bright parts, or chosen rose panes.
---
Everything above it shows only where its input source is bright (or with `self`, where it is itself bright), and is
transparent elsewhere, so what is below, the next modules or layers, shows through. A filter: it reworks what is
above it in its chain; the shape usually comes from a source set `as: "input"` (drawn nowhere itself) and named by
the mask's `input`. So colour bars masked by clouds become aurora curtains (preset aurora) and a dark wash masked by
clouds becomes storm cover (preset storm). By `region` it needs no input: it shows the rose's panes Pick chooses of
a Rule's regions (odd petals, one spiral arm, every third ring). **edge-fade** fades toward an edge instead of through a shape;
**recolour** with Steps bands colours rather than cutting them.

## Params
- by: `input` reads the source named by `input`. `self` keys on luminance: dark blues go before yellows. `region`
  picks rose panes.
- amount: 0.6–0.8 leaves a dim ghost (preset storm uses 0.8).
- cutoff: 0.2 shows nearly everywhere the input is lit.
- softness: A share of brightness. 0.05 is a hard cut-out; 0.3–0.5 gives soft, cloud-like edges. By region, a share
  of a pane: 0.01 cuts at the lead lines, 1 blends each pane halfway into the next petal's.
- invert: Use it to cut holes in the shape.
- rule: By region, which panes make one region: `petal`, `alternate` (two), `ring`, `rings` (two), `centre` (heart,
  middle, rim), `spiral` arms, `wedges`, `checker` or `random`.
- size: Petals a region for spiral, wedges and checker: 2 gives eight spiral arms, 4 four wedges.
- pick: `all`, `even`, `odd`, `one` (Index) or `every` (each Index-th, from the first): odd petals, one arm.
- index: Bind it to a step or a beat to move the one region shown round the rose.
- seed: For `random`, which scatter of panes.

## Pairings
- Smooth bars, then clouds `as: input`, then mask with input = the clouds' id, then a dark colour-wash with blend
  `under`: aurora (preset aurora).
- A lightning or sparkle below the mask stays unmasked: elements over a masked bed (preset storm).
- A bars or glow as input (moving): a window that sweeps across a texture.
- By region with **stained-glass** or a sparkle above it on the rose: alternate petals lit, the rest left to the
  layer below; with **scroll** `petal` below it the picked petals turn round the rose.

## Pitfalls
- By `input` with no input named does nothing. The input must come before the mask in the chain and have an id.
- It hides everything above it in the chain, beds included; put a bed below it with blend `under` to fill the holes.
- By region off the rose, petals and rings come from the angle and distance about the layer's centre: rough wedges
  and rings, not panes.
- An input that flickers fast (strobe, fast sparkle) makes the masked area flash with it.
