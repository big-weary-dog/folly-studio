---
looks: Colours turned round the colour wheel across the layer: one colour becomes a rainbow.
---
Adds a moving spectrum to a single-colour source, or cycles a look's colours, keeping brightness. **recolour** picks
colours by brightness from a palette; **colour-wash** `rainbow` changes the whole layer at once.

## Params
- direction: `clockwise` or `counterclockwise` makes a colour wheel; `petal` or `ring` gives one hue per rose petal
  or ring.
- spread: 0.2–0.4 a gentle shading; 1 the full spectrum once.
- speed: 0.02–0.1 cycles slowly; with spread, the rainbow moves along Direction.

## Pairings
- `clockwise`, then **anchor** on the rose: a colour wheel centred on it.

## Pitfalls
- White, grey and black don't change; pale colours barely. Feed it saturated colours.
- It ignores the palette; keep spread and speed small to stay near it.
- Speed above ~0.5 on a big bright area reads as flicker.
