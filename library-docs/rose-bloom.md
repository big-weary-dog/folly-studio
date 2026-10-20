---
looks: The rose window opens from its heart outward, holds open, closes back to dark and waits.
---
The rose lights ring by ring from its heart, holds, then closes to dark, about every six seconds. A flower opening, a
reveal on a downbeat. **rose-chase** keeps moving; **wash-breathe** swells a whole layer from the ground.

## Overrides
- edge-fade.position: the LFO's `rate` sets the cycle (`"unit": "beats"` rate 0.25 for one per bar), `hold` the
  share fully open or shut; a number (0 open, 1 shut) freezes it.
- edge-fade.width: 0.08 crisp ring by ring; 0.3 soft.
- edge-fade.direction: `out` opens from the rim inward.
- bars.speed: non-zero lets the rings flow.
- anchor.tag: bloom another group.

## Pairings
- A slower LFO `rate` (`"unit": "beats"` 0.0625, once in 4 bars) with `hold` 0.7 opens and waits a phrase.

## Pitfalls
- Shut is black: add a bed, or a **colour-wash** with `blend: "under"` at the end.
- On a layer wider than the rose it opens across every group.
