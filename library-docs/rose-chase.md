---
looks: Two comets circling the rose window while rings move out from its centre.
---
A clock face, a spinning wheel; made for the `rose`. **rose-ripple** sends rings over the whole building;
**rose-bloom** opens and closes the window.

## Overrides
- bars.direction: `clockwise` or `counterclockwise` (as seen from the front); a negative speed reverses either.
- bars.bars: comets; 4, 8 or 16 line up with the petals.
- bars#2.speed: negative moves out, positive in, 0 parks the ring.
- bars#2.duty: ring thickness; lower if it hides the comets too much.
- anchor.tag: centre on another group (`window`).

## Pitfalls
- On a layer wider than the rose, comets and rings cover every group.
