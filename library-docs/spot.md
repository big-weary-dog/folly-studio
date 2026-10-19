---
looks: A still round disc or soft glow of one colour at the centre, or on each anchored group.
---
A single round spot of one colour sits at the layer's centre, hard-edged or fading softly out from its middle, and
draws nothing beyond it. It does not move by itself: put `anchor` after it to place it on the rose, a tower or each
tower, and bind size to an LFO to make it breathe. Reach for **heartbeat** when the glow should pulse to the tempo,
**shockwave** for a ring bursting out, **circles** for several moving balls.

## Params
- colours: the spot's one colour: the first of the pick. The default `all` gives the palette's lowest colour, often
  dark; set `high` or a hex for a bright core.
- size: its radius, as a share of the layer (or of the anchor's reach). 0.1–0.2 is a hub; 0.5+ floods most of it.
- softness: the share of the radius that fades. 0 is a hard disc; 0.6 a soft-edged spot; 1 a glow brightest at the
  middle.

## Pairings
- Last in a chain with `blend: "over"`: a bright core over spiral arms (galaxy: high, size 0.13, softness 0.8).
- Then `anchor` (tag `rose`) to sit on the rose window; `anchor` tag `tower`, which `nearest`, for one on each tower.
- Bind size to a sine lfo for a slow breathing glow.

## Pitfalls
- Softness 0 leaves a stair-stepped edge on sparse LEDs; keep ≥ 0.3 unless the rings of the rose line it up.
- Only the first colour of the pick is used; a multi-colour pick does nothing more.
