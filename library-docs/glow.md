---
looks: A still round glow on the rose, bright at its heart, fading softly to its edge.
---
A round glow sits on the rose: **bars** on `in` with one smooth bar run the pick's colours from the heart out to the
rim, and **edge-fade** on `in` cuts it into a disc with a soft edge; **anchor** puts it on the rose. It does not move
by itself: bind edge-fade's Position to an LFO to make it breathe. Reach for **heartbeat** when the glow should pulse
to the tempo, **shockwave** for a ring bursting out, **ripple** for rings at random points.

## Overrides
- edge-fade.position: the size. 0.9 is a small hub, 0.75 a disc, 0.3 floods most of the layer.
- edge-fade.width: the soft edge; 0.03 is hard, 0.3 a haze.
- bars.colours: the heart's and the rim's colours; one role (`accent`) keeps it one family.
- anchor.tag: where it sits; `tower` with which `nearest` puts one on each tower.

## Pairings
- As a layer above spiral arms with `blend: "over"`: the bright core of **galaxy**.
- Bind edge-fade.position to a sine LFO for a slow breathing glow.

## Pitfalls
- A hard edge (width under ~0.05) stair-steps on sparse LEDs, unless the rose's rings line it up.
- Edge-fade fades everything above it: keep the glow on its own layer, not after another source.
