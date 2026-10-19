---
looks: A pleated theatre curtain parting from the middle to reveal what is behind.
---
A pleated curtain, its folds shaded through the pick and its drawn edge catching the last colour, covers the layer and
parts from the middle by Open: 0 shut, 1 fully open, with the opening clear so the layers beneath show through. Swag
draws it back further at the bottom, like tied-back drapes. It does not move by itself: bind Open to an LFO (hold
shape) or to the clip's envelope to draw it for an opening reveal. **edge-fade** wipes in from one edge without cloth;
**bars** with duty bound makes a plain sliding block.

## Params
- colours: The cloth's shades walk the first three quarters of the pick. `low body` gives a dark velvet with a lit hem.
- open: 0.5 is half open. Bind it; a fixed value is a still curtain.
- direction: Only the axis matters: right and left look the same, as do up and down. Back or front parts it in depth.
- pleats: 4–8 read on the arches. More fold together as it opens.
- swag: 0.35 gives classic tie-backs. Made for right/left.
- softness: A share of the layer; 0.02–0.05 crisp, 0.2 a soft fade. 0 aliases on sparse LEDs.

## Pairings
- Over a `colour-wash` or the look's main element, `blend: "over"`, with Open on a hold lfo (curtain-reveal: open,
  hold, close, hold every 8 s).
- Open bound to the clip's envelope for a one-time opening at the start of a clip.
- Layers beneath it: the reveal is only as good as what is under; put the show's main look below.

## Pitfalls
- Swag uses height whatever the direction, so with up/down it skews the opening rather than tying back.
- On sparse LEDs, many pleats alias into noise; keep pleats ≤ 8 on spires and globes.
