---
looks: A full field of flowing, interfering sine ripples in shifting colour; retro, trippy.
---
Four sine waves at different angles (one curling round a wandering centre) add up to a moving, marbled field that
covers every LED: the colour walks up through the pick and back again, so the first colour sits in the troughs and
peaks and the last in between. Reach for it for trippy, busy beds and 70s/90s energy. **clouds** is the calm, soft
relative with clear gaps; **colour-wash** with `hue-shift` and `turbulence` (palette-drift) is a gentler drifting
field; the butterfly preset is plasma mirrored.

## Params
- colours: the ramp the field walks; two or three contrasting colours read best, a long pick turns to mush.
- speed: how fast the waves flow. 0 freezes the marbling; 0.3–0.8 is a lazy swirl; above 2 it boils. The units are
  closer to radians than waves, so 1 is about a sixth of a wave a second.
- size: the scale of the ripples. Small (0.05–0.1) is many tight bands, busy on the arches; 0.25–0.5 is a few broad
  blobs; 1 is nearly one slow gradient.

## Pairings
- Then `mirror` across: symmetrical wings (the butterfly preset).
- Then `kaleidoscope` or `polar` and `twist` round the rose for a mandala.
- Under a `posterize` filter for flat poster bands of colour, or as the input of `mask` for a mottled reveal.

## Pitfalls
- Size below ~0.08 on the sparse spires and towers aliases into random-looking speckle.
- It covers the whole layer opaquely, so a bed under it is wasted; it is the bed.
