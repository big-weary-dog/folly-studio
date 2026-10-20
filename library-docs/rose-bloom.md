---
looks: The rose window opens from its heart outward, holds open, closes back to dark and waits.
---
The rose window lights ring by ring from its heart until the whole window glows in rings of the palette, holds, then
closes back in to dark, about once every six seconds: still **bars** (smooth, on `in`) revealed by an **edge-fade**
whose position rides a hold LFO, centred by **anchor** on the rose. A flower opening, a reveal on a downbeat.
**rose-chase** keeps moving; **wash-breathe** swells up a whole layer from the ground.

## Overrides
- edge-fade.position: the bloom. Its LFO's `rate` sets the cycle (0.17 Hz ≈ 6 s; `"unit": "beats"` rate 0.25 for
  one per bar); `hold` the share spent fully open or shut. A plain number (0 open, 1 shut) freezes it.
- edge-fade.width: 0.08 opens crisply ring by ring; 0.3 glows open softly.
- edge-fade.direction: `out` opens from the rim inward instead.
- bars.colours: colours from rim to heart; bars.bars how many colour steps across the radius.
- bars.speed: non-zero lets the colour rings flow while it blooms.
- anchor.tag: bloom another group (`window`, `tower` with which `nearest`).

## Pairings
- On the `rose` over a dim bed layer, or add a **colour-wash** with `blend: "under"` at the end of the chain so the
  shut window keeps a colour.
- Bind edge-fade.position to the clip envelope (`from` 1 `to` 0) to open once over a clip.

## Pitfalls
- Shut is dark: without a bed the rose goes black for a third of each cycle.
- On a layer wider than the rose, the bloom opens across every group, measured from the rose.
