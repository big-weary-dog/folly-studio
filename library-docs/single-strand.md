---
looks: Bands or comets of colour chasing along every wire, each strand on its own.
---
Bands of colour, or comets with fading tails, run along each strand from its start, every strand at once. Distances
are in LEDs, not layer shares, so the same setting crawls along a long main arch and races up a short spire strand.
The classic xLights chase: marquee bulbs, meteors, a strand filling and emptying, colour running out from the middle of
each arch. Reach for **bars** on `along` when the bands should be sized to each wire rather than in LEDs, **arch-chase**
when whole strands should take turns, **streaks** on `along` for sparse random drips with tails.

## Params
- colours: the bands' colours in turn (bands), or a comet's tail to head (comet: the last colour is the head). A pick
  like `"#00c8ff #ffffff"` gives a blue comet with a white head.
- speed: LEDs a second; negative runs backward. 20 is a walk, 60–100 a race on long strands. A 13-LED strand is
  crossed in under a second at 20.
- size: LEDs per band, or the room each comet gets. 3–6 for marquee bulbs, 10–30 for runs, 100+ for one comet a strand.
- gap: share of each band left clear (bands only). 0 is back-to-back colour; 0.5–0.7 reads as spaced bulbs.
- mode: `along` from each strand's start, `bounce` slides the pattern a strand's length and back, `out` runs from each
  strand's middle to both ends (the middle of an arch's top), `in` from both ends to the middle.
- profile: `bands` (flat bands with soft edges) or `comet` (a bright head and an exponential tail behind it).
- tail: comet tail length in LEDs. Keep it below size or tails run into the comet behind.
- lap: clear LEDs after each pass, so comets come in volleys instead of an endless train; 50–100 for meteors.
- scatter: 0 keeps every strand in step; 1 gives each its own start and up to ±30% pace, so nothing marches together.
- alternate: every other strand runs the other way: the marquee look on parallel strands.
- softness: band edge width in LEDs. 1–2 is crisp but smooth; 0 steps hard from LED to LED.

## Pairings
- Blend `over` a dim `colour-wash` bed: comets over a dark sky (meteors), bulbs over the first colour (marquee).
- Then `trails` for longer, ragged afterglow than tail gives; `mirror` along to make each strand chase both ways.
- Bind speed to the `energy` global so the chase quickens as the night builds.

## Pitfalls
- Size above a strand's length (spire strands have 13 LEDs, rose petals 14) makes a whole strand change colour at
  once; at speed that is large-area flashing.
- gap does nothing on comet; tail does nothing on bands; lap does nothing on bounce; alternate does nothing on out/in.
- The same speed looks very different on long and short strands; give short-strand groups their own layer and speed.
