---
looks: Colours turned round the colour wheel equally across the layer.
---
Rotates a look's RGB hues; clipping can change brightness and colour intensity. **recolour** picks colours by brightness from a palette;
**bars** draws spatial bands of colour.

## Params
- offset: a fixed turn of the wheel; 0 keeps the colours, 0.5 gives their opposite hues.
- speed: 0.02–0.1 cycles slowly; 0 holds still, negative cycles the other way.

## Pairings
- After **bars** to cycle the bands' hues together.

## Pitfalls
- White, grey and black don't change; pale colours barely. Feed it saturated colours.
- It ignores the palette; keep offset small and speed at 0 to stay near it.
- Speed above ~0.5 on a big bright area reads as flicker.
