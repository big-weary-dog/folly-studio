---
looks: Soft green-to-violet curtains of light drifting across a dark blue sky.
---
Northern lights: a still **bars** gradient seen through drifting **clouds** (mask input) over a dim sky wash. Calm,
night-time. **clouds** alone billows in palette colours; **starfield** is points, not curtains.

## Overrides
- bars.colours: curtain colours, ground to top.
- bars.speed: 0.1 makes colours climb through the curtains.
- clouds.cover: 0.3 wisps, 0.8 nearly all the sky.
- clouds.direction: `up` for rising veils.
- mask.softness: 0.24 soft edges, 0.05 crisp.
- colour-wash.colours: the sky.

## Pairings
- A sparse **sparkle** layer above (`high`, density 0.15) for stars.
- Bind clouds.cover to energy so it spreads as the music builds.

## Pitfalls
- The mask reads the clouds' palette-coloured brightness: a dark palette thins the curtains. Set clouds.colours to
  `#ffffff` so only cover decides.
