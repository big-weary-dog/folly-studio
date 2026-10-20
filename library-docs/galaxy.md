---
looks: Spiral arms slowly turning round a bright core over a base colour.
---
Two soft spiral arms in `accent` and `body` turn slowly round the layer's centre, about one turn every 20 seconds,
over a `low` bed, with a glowing `high` core in the middle. Pulse **bars** made into spokes by **polar**, wound into
spirals by **twist**, then a **spot** for the core (after the warps, so it stays round). Cosmic, hypnotic, centred:
best on the rose or the whole façade. **rose-chase** is comets on circles; **lighthouse** is straight beams.

## Overrides
- bars.bars: the number of arms; keep it whole, or a seam shows at 12 o'clock.
- bars.speed: how fast the arms turn (bars a second: 0.1 with 2 arms is one turn in 20 s); negative reverses.
- bars.duty: arm width; 0.3 thin arms, 0.9 nearly touching.
- bars.colours: the arms' colours, dealt in turn.
- twist.swirl: how tightly the arms wind; 0 straight spokes, ±2 (the stock −2) tight spirals; the sign is the hand.
- twist.spin: turns the whole spiral as well; usually leave 0 and use bars.speed.
- polar.repeats: copies of the pattern round the circle, multiplying the arms.
- spot.size: the core's radius as a share of the layer; spot.colours its colour; 0.01 all but removes it.
- colour-wash.colours: the space behind.

## Pairings
- Add **anchor** at the end (tag `rose`) to centre the galaxy on the rose window when the layer is the whole façade.
- Under a **sparkle** layer (`high`, density 0.1) for stars.
- Bind bars.speed to energy for a galaxy that spins up.

## Pitfalls
- The centre is the middle of the layer's bounds, not the rose, unless anchored.
- Near the core the arms crowd into mush on few LEDs; the spot hides it, so keep size above ~0.08.
