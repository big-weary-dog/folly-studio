---
looks: Two comets circling the rose window while rings move out from its centre.
---
Two comets in `body` colours chase clockwise round the rose window, one lap every eight seconds, while a pulse ring
of `accent` moves out from its centre every two and a half seconds, all over a `low` bed: a **bars** on `round`
(comet) and a **bars** on `in` (pulse), centred by **anchor** on the rose. A clock face, a spinning wheel: made
for the `rose`. **rose-ripple** sends rings across the whole building; **rose-bloom** opens and closes the window.

## Overrides
- bars.speed: how fast the comets circle; negative runs counter-clockwise.
- bars.bars: number of comets (whole); 4, 8 or 16 lines up with the petals.
- bars.duty: below 1 leaves dark between comets; at 1 each tail runs back to the next comet's head.
- bars.colours: the comets' colours, dealt in turn.
- bars#2.speed: ring speed; negative moves out, positive moves in; 0 parks the ring.
- bars#2.bars and bars#2.duty: rings at once, and their thickness.
- bars#2.colours: the rings' colour.
- anchor.tag: centre on another group (`window`).

## Pairings
- On the `rose` with a slow bed on the rest of the rig, or **rose-ripple** on the whole rig behind it.
- Bind bars.speed to an LFO in beats for comets that lurch round on the beat.

## Pitfalls
- On a layer wider than the rose, comets spin round the rose across every group and rings cover the whole layer.
- The ring is drawn over the comets, hiding them as it passes; drop bars#2.duty if they vanish too much.
