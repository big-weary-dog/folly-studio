---
looks: Single LEDs glinting at random, each in its own colour: stars, glitter, sequins.
---
A random share of LEDs glint, each at its own time and pace and in its own colour from the pick, on transparent. Pulse
mode flashes each chosen LED briefly then leaves it dark: twinkling stars. Smooth mode glitters every chosen LED up and
down between random levels: sequins or a shimmering surface. The cheapest texture in the library and the usual top
layer. Reach for **life** for structured flicker along strands, **streaks** when the glints should move.

## Params
- colours: `high` gives white stars, a few hexes warm and cool.
- density: 0.1–0.3 for stars, 1 for an all-over shimmer.
- rate: Glints a second per LED, each LED ±50% of it. 0.2–0.6 for stars, 4–10 for glitter in smooth mode.
- length: A share of each LED's cycle. 0.05 is a sharp twinkle; 0.5 never goes dark, a slow breathing.

## Pairings
- Last in a chain with blend `over` or `add` on any bed: stars over a dark sky (starfield), glitter over a walk of body
  colours (shimmer).
- After `clouds` as input with `mask` to glint only in patches.
- Bind density to the `energy` global so the sky fills with stars as the night builds.

## Pitfalls
- Pulse mode at high rate with density near 1 reads as static, not sparkle; keep rate ≤ 2 in pulse mode.
- On sparse strands a low density can leave a group nearly dark; raise density for small groups.
