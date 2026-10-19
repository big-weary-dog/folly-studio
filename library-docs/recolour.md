---
looks: The layer repainted in new colours by brightness: shadows one colour, highlights another.
---
Every colour above it is replaced by a colour from Colours chosen by its brightness: dark parts take the first
colours, bright parts the last, while (with Shade) light and dark stay where they were. A filter: it reworks the
colour of everything above it in its chain, so it goes after the sources it repaints; sources below it keep their
own colours. Reach for it to put a texture (plasma, clouds, fire, sparkle) into the show's palette, or to make one
source read as a heat-map; **hue-shift** turns colours round the wheel by place instead of by brightness,
**posterize** flattens colours without choosing new ones, **invert** flips them.

## Params
- colours: the walk from dark to bright; a role (`body`, `accent`) or a list. Order matters: darkest first.
- amount: 1 replaces the colours fully; 0.3–0.6 tints the original.
- shade: on, each new colour is as bright as what it replaces, so dark stays dark; off, every LED gets the full
  colour, so dark areas light up in the first colour.
- contrast: stretches the walk round mid-brightness. Above 1 pushes toward the two ends (bold, two-tone); below 1
  keeps most LEDs in the middle colours.
- shift: slides along the colours, bouncing back at the ends; ±0.2 re-centres which colour dominates.
- drift: colours a second to slide along automatically, back and forth; 0.02–0.1 for a slowly changing palette.

## Pairings
- After plasma, clouds or fire: the texture's shape in the palette's colours (a fire in blues).
- After a whole chain of sources: one palette over everything, so mixed sources match.
- Bind shift or drift to energy or an lfo: the colour mood moves with the music.

## Pitfalls
- Brightness weighs green heavily: pure blue and red count as dark, green and yellow as bright, so a rainbow source
  does not map in rainbow order.
- Shade off lights up every opaque dark area, possibly the whole layer at full; watch brightness and power.
- On a flat colour-wash every LED has the same brightness, so all take one colour: it needs variation.
