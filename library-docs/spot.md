---
looks: A still round disc or soft glow at the centre, or on each anchored group.
---
A single round spot sits at the middle of the layer's LEDs, the last of its colours at the heart, hard-edged or fading
softly out to its edge, and draws nothing beyond it. It does not move by itself: put `anchor` after it to place it on
the rose, a tower or each tower, and bind size to an LFO to make it breathe. Reach for **heartbeat** when the glow
should pulse to the tempo, **shockwave** for a ring bursting out, **circles** for several moving balls.

## Params
- size: A share of the layer (or of the anchor's reach). 0.1–0.2 is a hub; 0.5+ floods most of it.
- softness: 0.6 gives a soft-edged spot.

## Pairings
- Last in a chain with `blend: "over"`: a bright core over spiral arms (galaxy: high, size 0.13, softness 0.8).
- Then `anchor` (tag `rose`) to sit on the rose window; `anchor` tag `tower`, which `nearest`, for one on each tower.
- Bind size to a sine lfo for a slow breathing glow.

## Pitfalls
- Softness 0 leaves a stair-stepped edge on sparse LEDs; keep ≥ 0.3 unless the rings of the rose line it up.
- A multi-colour pick paints rings: the last colour at the heart, the first at the edge. `accent` is one family.
