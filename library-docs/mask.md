---
looks: The chain shown only through a shape: inside clouds, a moving bar or its own bright parts.
---
Everything above it shows only where its input source is bright (or with `self`, where it is itself bright), and is
transparent elsewhere, so what is below, the next modules or layers, shows through. A filter: it reworks what is
above it in its chain; the shape usually comes from a source set `as: "input"` (drawn nowhere itself) and named by
the mask's `input`. So colour bars masked by clouds become aurora curtains (preset aurora) and a dark wash masked by
clouds becomes storm cover (preset storm). **edge-fade** fades toward an edge instead of through a shape;
**posterize** bands colours rather than cutting them.

## Params
- by: `input` reads the source named by `input`. `self` keys on luminance: dark blues go before yellows.
- amount: 0.6–0.8 leaves a dim ghost (preset storm uses 0.8).
- cutoff: 0.2 shows nearly everywhere the input is lit.
- softness: A share of brightness. 0.05 is a hard cut-out; 0.3–0.5 gives soft, cloud-like edges.
- invert: Use it to cut holes in the shape.

## Pairings
- Smooth bars, then clouds `as: input`, then mask with input = the clouds' id, then a dark colour-wash with blend
  `under`: aurora (preset aurora).
- A lightning or sparkle below the mask stays unmasked: elements over a masked bed (preset storm).
- A bars or glow as input (moving): a window that sweeps across a texture.

## Pitfalls
- By `input` with no input named does nothing. The input must come before the mask in the chain and have an id.
- It hides everything above it in the chain, beds included; put a bed below it with blend `under` to fill the holes.
- An input that flickers fast (strobe, fast sparkle) makes the masked area flash with it.
