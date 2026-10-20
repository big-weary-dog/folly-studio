---
looks: The whole layer one flat colour, holding, then fading to the next of its pick.
---
Every LED on the layer shows the same colour, which holds for a while and then fades into the next colour of the pick,
round and round. At speed 0 it is the first colour, still: the standard bed under everything else, since it is the one
source that covers its whole layer. Reach for **bars** with one smooth bar when the change should travel across the
layer rather than happen everywhere at once, **plasma** or **clouds** for a bed with texture, **strobe** for hard
flashes rather than fades.

## Params
- colours: what it walks through, in order; a single role or hex (`low`, `#06104a`) for a still bed, `rainbow` for a
  slow cycle round the wheel.
- speed: colours per second. 0 holds the first colour for good (the usual bed); 0.05–0.2 is a calm drift; near 2 the
  whole layer changes twice a second.
- hold: the share of each colour's time spent still before it fades on. 0 is a constant slow blend; 0.8 (the cap)
  holds and then snaps over the last fifth.
- brightness: scales the colour down; 0.3–0.5 makes a dim bed that lets what is drawn over it stand out.

## Pairings
- First in the chain as a bed, the next source `blend: "over"` (rising-sweep, galaxy, rain, meteors).
- `blend: "under"` after a filter, so the filter reworks only the element above it (aurora, wash-breathe).
- Then `hue-shift` and `turbulence` to spread its colour into a moving field (palette-drift).
- A dim bed at brightness 0.4, masked by `clouds`, makes a dark rolling sky (storm).

## Pitfalls
- High speed with hold near 0.8 on the whole rig is large-area colour cycling; keep changes well under 3 a second.
- The default pick `all` starts on the palette's lowest colour and cycles every colour, dim ones included; set a pick.
