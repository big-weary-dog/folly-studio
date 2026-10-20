---
looks: A pleated theatre curtain parting from the middle to reveal what is behind.
---
A pleated curtain, its folds shaded through the pick and its drawn edge catching the last colour, covers the layer and
parts from the middle by Open: 0 shut, 1 fully open, with the opening clear so the layers beneath show through. Swag
draws it back further at the bottom, like tied-back drapes. It does not move by itself: bind Open to an LFO (hold
shape) or to the clip's envelope to draw it for an opening reveal. **edge-fade** wipes in from one edge without cloth;
**bars** with duty bound makes a plain sliding block.

## Params
- colours: the cloth's shades across each pleat walk the first three quarters of the pick; the drawn edge glows in the
  last colour. `low body` for a dark velvet with a lit hem.
- open: how far it has parted: 0 shut (no seam), 0.5 half, 1 open. Bind it; a fixed value is a still curtain.
- direction: only the axis it parts along: right or left (the halves draw to the sides; both look the same), up or
  down (to top and bottom), back or front (in depth).
- pleats: folds across each half; 4–8 read on the arches, 0 is flat cloth. More fold together as it opens.
- swag: how much wider the opening is at the bottom; 0 straight edges, 0.35 classic tie-backs. Made for right/left.
- softness: the cloth's edge width as a share of the layer; 0.02–0.05 crisp, 0.2 a soft fade. 0 aliases on sparse LEDs.

## Pairings
- Over a `colour-wash` or the look's main element, `blend: "over"`, with Open on a hold lfo (curtain-reveal: open,
  hold, close, hold every 8 s).
- Open bound to the clip's envelope for a one-time opening at the start of a clip.
- Layers beneath it: the reveal is only as good as what is under; put the show's main look below.

## Pitfalls
- Swag uses height whatever the direction, so with up/down it skews the opening rather than tying back.
- On sparse LEDs, many pleats alias into noise; keep pleats ≤ 8 on spires and globes.
