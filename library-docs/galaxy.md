---
looks: Spiral arms slowly turning round a bright core over a base colour.
---
Two arms turning once every 20 s round a `high` core over a `low` bed. Cosmic and centred; best on the rose or whole
façade. **rose-chase** is comets on circles; **lighthouse** is straight beams.

## Overrides
- bars#2.bars: arms; keep it whole or a seam shows at 12 o'clock.
- bars#2.speed: 0.1 with 2 arms is one turn in 20 s; negative reverses.
- bars#2.duty: arm width; 0.3 thin, 0.9 nearly touching.
- twist.swirl: winding; 0 spokes, ±2 tight; sign is the hand.
- polar.repeats: multiplies the arms.
- edge-fade.position: core size; 0.98 all but removes it.
- bars.colours: the core's colour.

## Pairings
- **anchor** (`rose`) at the end to centre it on the rose when the layer is the whole façade.
- **sparkle** layer (`high`, density 0.1) for stars.

## Pitfalls
- Without anchor the centre is the middle of the layer's bounds.
- The core hides the arms' mush at the centre; keep it no smaller than the default.
