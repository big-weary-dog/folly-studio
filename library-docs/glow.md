---
looks: A still round glow on the rose, bright at its heart, fading softly to its edge.
---
A still soft disc on the rose; bind edge-fade.position to a sine LFO to make it breathe. **heartbeat** pulses to the
tempo, **shockwave** bursts a ring, **ripple** rings at random points.

## Overrides
- edge-fade.position: size; 0.9 a small hub, 0.75 a disc, 0.3 floods the layer.
- edge-fade.width: 0.03 hard, 0.3 a haze.
- bars.colours: rim to heart (the bars run `in`).
- anchor.tag: where it sits; `tower` with which `nearest` puts one on each tower.

## Pairings
- Above spiral arms with `blend: "over"`: the core of **galaxy**.

## Pitfalls
- Width under ~0.05 stair-steps on sparse LEDs.
- Edge-fade fades everything above it: keep the glow on its own layer.
