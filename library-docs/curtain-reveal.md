---
looks: A pleated stage curtain parts from the middle, holds open, closes and holds shut.
---
A pleated curtain in the palette's colours covers the layer, then parts from the middle, holds open on the first
colour, closes and holds again, every eight seconds: smooth **bars** for the pleats, wiped from the middle by
**edge-fade** with its Position on a hold LFO, a **colour-wash** drawn `under` them (what is revealed), all folded by
**mirror** so both halves part together. Theatre, reveals, the start of a set. **edge-fade** alone wipes without
cloth; **rose-bloom** opens from a centre.

## Overrides
- edge-fade.position: the motion, 0.5 shut to 1 open. A hold LFO by default; bind to the clip envelope (`from` 0.5
  `to` 1) to open once over a clip's fade; a number holds it part-open.
- edge-fade.width: the curtain's edge; raise on sparse groups.
- bars.colours: the cloth, one colour a pleat.
- bars.bars: pleats across the layer; 6 broad drapes, 20 fine.
- colour-wash.colours: what is revealed.

## Pairings
- To reveal another layer: drop the colour-wash, and put the curtain on a layer above the one to reveal.
- On the arches and the portal, where it reads as a proscenium.

## Pitfalls
- Over 20 pleats aliases into flicker on sparse LEDs.
- No swag or bright edge: the cloth parts straight.
