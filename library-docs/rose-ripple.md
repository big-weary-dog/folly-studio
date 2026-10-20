---
looks: Rainbow rings spreading out from the rose window through the whole building.
---
Rings spread from the rose through the whole rig at about 4 m/s, making the rose the source of everything. **rose-chase**
stays inside the rose; **shockwave** is one burst.

## Overrides
- bars.speed: negative spreads out, positive draws in.
- bars.bars: rings within reach; 5 over 30 m is one per 6 m.
- bars.duty: 0.2 thin, 1 back to back.
- anchor.reach: smaller packs rings tighter.
- anchor.shape: `facade` ignores depth; `plan` rings round an upright axis.
- anchor.tag: `tower` with which `nearest` ripples from each tower.

## Pitfalls
- Each LED blinks at |speed| × bars Hz; over 3 on the whole rig is flashing.
- On the rose alone the 30 m reach is far too wide; lower it or use rose-chase.
