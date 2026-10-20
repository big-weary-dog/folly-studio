---
looks: Light and dark swapped: each colour turned to its opposite, dark areas lit.
---
Each colour above it becomes its opposite (red to cyan, blue to yellow, black to white), so dark gaps light up and
bright shapes become dark silhouettes. A filter: it reworks the colour of everything above it in its chain, so it
goes after the sources. Reach for it for a negative or a sudden contrast flip on a cue. **hue-shift** turns hues and
keeps brightness, but by place and time, not by a fixed half turn; **recolour** remaps colours by brightness and can
keep dark dark; **mask** with `invert` shows where a source is dark rather than changing colours.

## Params
- amount: 1 fully inverted, 0.5 a flat grey wash, so between 0 and 1 the colours pass through grey; use it at 0 or 1,
  or bind it to cut on a cue.

## Pairings
- After a dark bed with a bright element: a bright field with a dark element moving through it.
- Bind amount to a cue or a hold lfo for a stepwise negative flip on a downbeat.
- After sparkle or streaks over a colour-wash: black stars on a coloured sky.

## Pitfalls
- A dark opaque bed becomes nearly white: the whole layer at full brightness and power.
- Flipping amount 0 ↔ 1 changes every LED at once; faster than 3 a second on a big layer fails the flash check.
- Transparent areas stay transparent: only what is drawn is inverted.
