---
looks: Spiral arms slowly turning round a bright core over a base colour.
---
Two soft spiral arms in `accent` and `body` turn slowly round the layer's centre, about one turn every 20 seconds,
over a `low` bed, with a glowing `high` core in the middle. A core first (smooth **bars** cut by **edge-fade**, both
on `down`, which polar makes the distance from the centre), then pulse **bars** and a **colour-wash** drawn `under` it,
made into spokes by **polar** and wound into spirals by **twist**. Cosmic, hypnotic, centred:
best on the rose or the whole façade. **rose-chase** is comets on circles; **lighthouse** is straight beams.

## Overrides
- bars#2.bars: the number of arms; keep it whole, or a seam shows at 12 o'clock.
- bars#2.speed: how fast the arms turn (bars a second: 0.1 with 2 arms is one turn in 20 s); negative reverses.
- bars#2.duty: arm width; 0.3 thin arms, 0.9 nearly touching.
- bars#2.colours: the arms' colours, dealt in turn.
- twist.swirl: how tightly the arms wind; 0 straight spokes, ±2 (the stock −2) tight spirals; the sign is the hand.
- polar.repeats: copies of the pattern round the circle, multiplying the arms.
- edge-fade.position: the core's size; 0.88 a small core, 0.98 all but removes it. bars.colours its colour.
- colour-wash.colours: the space behind.

## Pairings
- Add **anchor** at the end (tag `rose`) to centre the galaxy on the rose window when the layer is the whole façade.
- Under a **sparkle** layer (`high`, density 0.1) for stars.
- Bind bars#2.speed to energy for a galaxy that spins up.

## Pitfalls
- The centre is the middle of the layer's bounds, not the rose, unless anchored.
- Near the core the arms crowd into mush on few LEDs; the core hides it, so keep it no smaller than the default.
