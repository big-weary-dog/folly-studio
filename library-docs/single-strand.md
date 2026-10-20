---
looks: Bands or comets of colour chasing along every wire, each strand on its own.
---
Bands of colour, or comets with fading tails, run along each strand from its start, every strand at once. Distances
are in LEDs, not layer shares, so the same setting crawls along a long main arch and races up a short spire strand.
The classic xLights chase: marquee bulbs, meteors, a strand filling and emptying, colour running out from the middle of
each arch. Reach for **bars** on `along` when the bands should be sized to each wire rather than in LEDs,
**in-turn** when whole groups should take turns, **streaks** on `along` for sparse random drips with tails.

## Params
- colours: A pick like `"#00c8ff #ffffff"` gives a blue comet with a white head.
- speed: LEDs a second. 20 is a walk, 60–100 a race on long strands; a 13-LED strand is crossed in under a second at 20.
- size: In LEDs, or the room each comet gets. 3–6 for marquee bulbs, 10–30 for runs, 100+ for one comet a strand.
- gap: Bands only. 0.5–0.7 reads as spaced bulbs.
- mode: `out` starts at the middle of an arch's top; `bounce` slides the pattern a strand's length and back, comets
  turning head first each way.
- tail: In LEDs. Keep it below size or tails run into the comet behind.
- lap: In LEDs; 50–100 for meteors.
- scatter: Pace varies by up to ±30%.
- alternate: The marquee look on parallel strands.
- softness: In LEDs. 1–2 is crisp but smooth; 0 steps hard from LED to LED.

## Pairings
- Blend `over` a dim `colour-wash` bed: comets over a dark sky (meteors), bulbs over the first colour (marquee).
- Then `trails` for longer, ragged afterglow than tail gives; `mirror` along to make each strand chase both ways.
- Bind speed to the `energy` global so the chase quickens as the night builds.

## Pitfalls
- Size above a strand's length (spire strands have 13 LEDs, rose petals 14) makes a whole strand change colour at
  once; at speed that is large-area flashing.
- gap does nothing on comet; tail does nothing on bands; lap does nothing on bounce; alternate does nothing on out/in.
- The same speed looks very different on long and short strands; give short-strand groups their own layer and speed.
