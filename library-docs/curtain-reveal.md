---
looks: A pleated stage curtain parts from the middle, holds open, closes and holds shut.
---
A pleated curtain in the palette's colours covers the layer, then parts from the middle, wider at the bottom like a
swagged stage drape, with its leading edges catching the last colour; it holds open on the first palette colour,
closes and holds again, every eight seconds: **curtain** with its open bound to a hold LFO, over a **colour-wash**.
Theatre, reveals, the start of a set. **edge-fade** wipes without cloth; **rose-bloom** opens from a centre.

## Overrides
- curtain.open: the motion. A hold LFO by default; bind to the clip envelope (`from` 0 `to` 1) to open once over a
  clip's fade; a number holds it part-open (1 fully open, 0 shut).
- curtain.colours: the cloth, walked across the pleats; the last colour lights the edges.
- curtain.pleats: folds per half; 3 broad drapes, 12 fine; 0 a flat cloth.
- curtain.swag: how much wider it opens at the bottom; 0 parts straight.
- curtain.direction: `up` parts top and bottom from the middle; `back` parts front from back.
- curtain.softness: edge width; raise on sparse groups.
- colour-wash.colours: what is revealed.

## Pairings
- To reveal another layer: drop the colour-wash, put the curtain alone on a layer above it with `blend: "over"`.
- On the arches and the portal, where it reads as a proscenium.

## Pitfalls
- Over 15 pleats aliases into flicker on sparse LEDs as the curtain moves.
- The revealed colour is the colour-wash's first colour; with speed above 0 it starts changing too.
