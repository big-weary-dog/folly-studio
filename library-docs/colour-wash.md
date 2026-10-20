---
looks: The whole layer one flat colour, holding, then fading to the next of its pick.
---
The standard bed: at speed 0 it is one still colour covering the whole layer. Use **bars** for change that travels,
**plasma** or **clouds** for a textured bed, **strobe** for hard flashes.

## Params
- speed: 0 is the usual bed; 0.05–0.2 a calm drift.
- hold: 0.8 snaps over the last fifth.
- brightness: every source's own; 0.3–0.5 for a dim bed under other sources.

## Pairings
- First in the chain, the next source `blend: "over"`.
- `blend: "under"` after a filter so the filter reworks only what is above.

## Pitfalls
- The default `all` starts on the darkest colour and cycles every colour; set a pick.
- Fast speed with high hold is large-area flashing; keep changes under 3 a second.
