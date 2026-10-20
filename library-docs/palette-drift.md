---
looks: A slow rainbow gradient rising up the layer, swirled by noise, its hues drifting round.
---
The whole layer drifts through the palette: **colour-wash** moves smoothly through `all` the palette's colours (one
every eight seconds, never holding), **hue-shift** spreads a quarter turn of hue from the ground to the top so it
reads as a gradient, and **turbulence** swirls the gradient's lines slowly. The calmest full-coverage bed in the
library, for openings, ambient stretches and under sparse elements. **butterfly** is busier and symmetrical; a plain
**colour-wash** changes the layer all at once with no gradient.

## Overrides
- colour-wash.colours: the colours it drifts through; a role (`body`) keeps it within the palette, `rainbow`
  ignores the palette.
- colour-wash.speed: colours a second; 0.05 for a near-still bed, 0.3 for visible change. 0 holds the first colour.
- colour-wash.hold: share of each colour spent still before blending on; 0 is constant drift.
- colour-wash.brightness: 0.2–0.4 to sit it under an element.
- hue-shift.spread: turns of hue from bottom to top. 0 is one colour over the whole layer; 0.5–1 a full rainbow
  stacked up the layer; negative reverses the order.
- hue-shift.direction: which way the gradient runs; `out` makes rings from the centre, `round` a colour wheel.
- hue-shift.speed: makes the gradient climb on its own (0.05 is a slow rise; negative sinks).
- turbulence.amount: how far the gradient's lines are pushed; 0 for straight bands, 0.3 for marbling.
- turbulence.size and turbulence.speed: the swirls' size and how fast they change.

## Pairings
- Under an element in a separate layer, or as the bed of a chain with the element after it on `over`.
- With **sparkle** in `high` over it for a glittering calm.
- Bind colour-wash.brightness to energy (`from` 0.2 `to` 1) so the bed lifts as the show builds.

## Pitfalls
- A large hue-shift spread leaves the look's palette; keep it small if the palette matters.
- hue-shift rotates the colour, so a palette of whites and greys barely changes.
