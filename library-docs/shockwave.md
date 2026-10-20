---
looks: A ring bursting out of the rose through the whole rig, fading as it grows.
---
Again and again a ring bursts out of the rose and spreads through the rig, brightest at its front and dimming as it
grows: one **bars** comet heading out (`in` with a negative speed), dimmed toward the edge by **edge-fade**, centred
on the rose in 3D by **anchor** (shape `sphere`). Reach for it for impacts, drops and booms. **ripple** spreads many
thin rings from random points; **heartbeat** swells in place to the tempo; **rose-ripple** keeps several rings going.

## Overrides
- bars.speed: bursts a second, negative to head out; −0.4 is one every 2.5 seconds. For one a beat, the tempo ÷ 60.
- bars.duty: the ring's thickness with its glow; 0.15 crisp, 0.6 a broad surge.
- bars.colours: each burst takes the next colour.
- bars.direction: `up` (with a positive speed) for a wall sweeping up instead of a ring; then drop the anchor.
- edge-fade.width: how early the ring dims; 1 fades it all the way out, 0.3 keeps it bright to the edge.
- anchor.tag: where it bursts from.

## Pairings
- On a layer over a **colour-wash** bed.
- Bind bars.speed to the `energy` global for bursts that come faster as the show builds.

## Pitfalls
- It moves at a steady speed: no fast-then-slowing ease. Binding bars.speed to a saw LFO comes close.
- It runs on its own clock, not locked to the beat; heartbeat is the one tied to the tempo.
