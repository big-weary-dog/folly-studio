---
looks: One wide band of colour climbs the layer over a base colour, again and again.
---
A single band half the layer tall rises from the ground over a `low` bed every four seconds, crisp-edged: a
**bars** (step, one bar, half duty) over a still **colour-wash**. The plainest "lift" for builds and choruses, and a
good base for anything that should feel like rising. **nave-procession** marches comets front to back on the beat;
**wash-breathe** fills and drains instead of passing through; **water** holds a level rather than moving.

## Overrides
- bars.speed: bands a second; 0.25 is one every 4 s, 1 is energetic. Negative sends it down.
- bars.bars: how many bands are on the layer at once; 2–3 makes a stacked ladder.
- bars.duty: the band's share of its cycle; 0.2 is a thin line rising, 0.8 a big block with a short gap.
- bars.profile: `comet` gives a bright leading edge with a tail behind; `pulse` a soft glow; `smooth` no edges.
- bars.softness: edge width; raise to 0.3 for a softer band.
- bars.direction: `down`, `right`, `back`; `in` with a negative speed for rings outward from the centre.
- bars.colours: the band colour; `body/accent` alternates bands.
- colour-wash.colours and colour-wash.brightness: the bed underneath (0.3 brightness to make the band pop).

## Pairings
- Bind bars.speed to energy (`from` 0.15 `to` 0.8) for a sweep that quickens with the show.
- Put on the towers and spires alone for twin rising columns; on the arches for bands up the arch legs.
- Add **anchor** after it (tag `rose`, direction `in`, negative speed) for rings from the rose.

## Pitfalls
- More bars at high speed is a whole-rig on/off: each LED toggles at speed × bars Hz; keep that under 3.
- On a layer that includes low ground-level groups and tall spires, the band spends most of its time on the spires.
