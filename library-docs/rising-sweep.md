---
looks: One wide band of colour climbs the layer over a base colour, again and again.
---
The plainest "lift" for builds and choruses. **wash-breathe** fills and drains instead; **nave-procession** marches
comets front to back on the beat.

## Overrides
- bars.speed: 0.25 is one band every 4 s, 1 energetic; negative goes down.
- bars.bars: 2–3 makes a stacked ladder.
- bars.duty: 0.2 a thin line, 0.8 a big block.
- bars.profile: `comet` a bright leading edge; `pulse` a soft glow.
- bars.softness: 0.3 for a softer band.
- bars.direction: `down`, `right`, `back`; `in` with negative speed for rings outward.
- bars.colours: `body/accent` alternates bands.
- colour-wash.colours: the bed.

## Pairings
- Bind bars.speed to energy (`from` 0.15 `to` 0.8).
- Set bars.direction to `in` and bars.speed negative, then **anchor** (tag `rose`) for rings from the rose.

## Pitfalls
- Keep speed × bars under 3: each LED toggles that often.
- On a layer with tall spires, the band spends most of its time on them.
