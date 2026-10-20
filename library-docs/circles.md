---
looks: Coloured balls drifting and bouncing round the layer, merging like a lava lamp.
---
Up to eight balls drift on their own paths across the façade, bouncing off the layer's edges, each its own colour from
the pick; where two come close they swell and melt into one blob, split by a clean line between their colours. Nothing
is drawn between balls, so it wants a bed below. Reach for it for lava-lamp, playful or bubbly looks. **spot** is one
still disc; **tendril** draws wandering trails rather than blobs; **ripple** spreads rings from random drops.

## Params
- colours: Ball i takes the pick's i-th colour, so `all` gives the first balls its lowest; prefer `body accent` or
  `rainbow`. Touching balls blend their colours.
- speed: Crossings a second, each ball ±40%. 0.1–0.3 is a lava lamp; 0.6+ is a busy bounce.
- count: 1–8. 3–5 reads clearly; 8 with a large size merges into one big blob.
- size: A share of the layer. 0.08–0.15 for distinct balls; 0.25+ and they are always merged.

## Pairings
- Over a dim `colour-wash` with `blend: "over"`.
- Then `mirror` across for a symmetrical lava lamp; then `polar` to bend their paths round the rose.
- Under `trails` for streaking afterglow behind fast balls.

## Pitfalls
- Balls move only across and up (the façade); depth is ignored, so the towers' front and back show the same.
- Small size on the sparse spires: balls slip between LEDs and blink in and out; keep size ≥ 0.08 on big layers.
