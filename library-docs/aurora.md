---
looks: Soft green-to-violet curtains of light drifting across a dark blue sky.
---
Soft patches of colour drift sideways across a deep blue sky, green at the bottom fading through cyan to violet at
the top, like the northern lights: a still smooth **bars** gradient seen only through drifting **clouds** (as an
input to **mask**), over a **colour-wash** drawn `under`. Calm, slow and night-time. **clouds** alone gives billows
in palette colours; **starfield** is points not curtains; **palette-drift** fills the layer with no sky.

## Overrides
- bars.colours: the curtain colours, ground to top; set roles (`body accent high`) to follow the palette.
- bars.speed: 0 holds the gradient; 0.1 makes colours climb slowly through the curtains.
- bars.bars: colour bands up the layer; 2 with three colours is one ramp.
- clouds.cover: how much of the sky the curtains fill; 0.3 wisps, 0.8 nearly all.
- clouds.speed, clouds.size and clouds.direction: drift rate, curtain size, and which way (`up` for rising veils).
- mask.softness: curtain edges; 0.24 soft, 0.05 crisp.
- mask.cutoff: raise to thin the curtains.
- colour-wash.colours: the sky.

## Pairings
- With a sparse **sparkle** layer above (`high`, density 0.15) for stars in the gaps.
- Bind clouds.cover to energy so the aurora spreads as the music builds.

## Pitfalls
- The mask reads the clouds' brightness, coloured by the palette (`all`): a dark palette thins the curtains. Set
  clouds.colours to `#ffffff` so only cover decides.
- Hex colours ignore the look's palette.
