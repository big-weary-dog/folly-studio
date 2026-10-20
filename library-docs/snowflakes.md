---
looks: Soft flakes sway down the layer and a snow drift at the bottom builds up and melts away.
---
Flakes sway down over a full-brightness bed while a drift rises to a quarter of the layer and melts over half a
minute. Gentle, festive winter. **snowstorm** is a blizzard; **rain** falls straight and fast.

## Overrides
- streaks.lanes: fewer make bigger flakes; 12 blobs, 40 fine.
- streaks.speed: 0.12 gentle, 0.3 brisk.
- streaks.sway: 0 straight, 0.8 wide swings.
- streaks.density: bind to energy for a flurry.
- bars.duty: the drift height; a number fixes it, 0.05 for none.
- colour-wash.brightness: lower to 0.3 if flakes don't read or the palette is bright.

## Pairings
- **sparkle** (`high`, density 0.2) on the drift via **mask**.
- After a **snowstorm** section as the calm.

## Pitfalls
- Flakes smaller than the LED spacing blink as they pass.
- Flakes fall through the drift rather than landing on it.
