---
looks: Colours turned round the colour wheel across the layer: one colour becomes a rainbow.
---
Every colour above it is turned round the colour wheel by an amount that grows along Direction (Spread) and over time
(Speed), keeping its brightness, so one red becomes a rainbow sweeping across the portal, and a whole palette slowly
cycles. A filter: it reworks the colour of everything above it in its chain, so it goes after the sources; sources
below it keep their colours. Reach for it to add a moving spectrum to any single-colour source, or to cycle a look's
colours over a song; **recolour** chooses colours by brightness from a palette, **colour-wash** with `rainbow`
changes the whole layer at once, **invert** flips colours.

## Params
- direction: which way the hue changes across: up, down, right, left, back, front, out, in, round (a colour wheel
  round the centre), along (each wire).
- spread: turns of the wheel across the layer. 1 shows the full spectrum once; 0.2–0.4 a gentle shading; 0 the same
  turn everywhere.
- speed: turns a second; 0.02–0.1 cycles slowly. Combined with spread it makes the rainbow move along Direction.

## Pairings
- After a one-colour source (bars, single-strand, sparkle): a rainbow of them.
- After a rainbow colour-wash, then **turbulence**: hues drifting unevenly (preset palette-drift).
- On `round` after anything, then **anchor** (rose): a colour wheel centred on the rose.

## Pitfalls
- White, grey and black have no hue and do not change; pale colours change only a little. Feed it saturated colours.
- It ignores the show palette: a full turn passes through every hue, clashing with a curated palette. Keep spread and
  speed small to stay near it.
- Fast speed (above ~0.5) on a big bright area reads as colour flicker.
