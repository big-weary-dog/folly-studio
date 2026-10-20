---
looks: Soft flakes sway down the layer and a snow drift at the bottom builds up and melts away.
---
Round flakes in the `high` colour sway gently down over the `accent` colour, about eight seconds top to bottom, and
a drift of `high` along the ground rises slowly to a quarter of the layer and melts again over half a minute:
**streaks** in flake mode over a **colour-wash**, and a still **bars** whose duty rides a hold LFO for the drift.
Gentle, festive winter. **snowstorm** is a wind-driven blizzard; **rain** falls straight and fast.

## Overrides
- streaks.lanes: flake size; fewer lanes make bigger flakes (12 for big blobs), 40 fine ones.
- streaks.speed: fall rate; 0.12 gentle, 0.3 brisk.
- streaks.sway: side-to-side drift; 0 falls straight, 0.8 wide swings.
- streaks.density: share of lanes with flakes; bind to energy for a flurry.
- streaks.depth: flake depth slots front to back; 1 for a flat layer.
- streaks.colours: the flakes.
- bars.duty: the drift height; its LFO's `rate` (0.033 Hz ≈ 30 s) and `depth` set how fast and how much it
  builds. A number fixes a constant drift; 0.05 for none.
- bars.colours: the drift's colour.
- colour-wash.colours and colour-wash.brightness: the sky; lower brightness to 0.3 if flakes don't read.

## Pairings
- On the whole rig or the towers and arches; with **sparkle** (`high`, density 0.2) on the drift via **mask**.
- After a **snowstorm** section as the calm.

## Pitfalls
- A flake is about one lane wide: on sparse LEDs flakes smaller than the LED spacing blink as they pass between.
- Flakes fall through the drift (drawn under it) rather than landing on it.
- The bed is at full brightness, unlike most presets; dim it under bright palettes.
