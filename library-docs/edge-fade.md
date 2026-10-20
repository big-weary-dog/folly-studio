---
looks: The layer fading out toward one edge, or a soft wipe that grows across the layer.
---
Fades what is above it in its chain to transparent toward one edge. Bind Position for a wipe; inverted, it is a fill
level (preset **wash-breathe**). **mask** cuts by a shape instead; **bars** with one bar draws a moving edge itself.

## Params
- direction: `petal`/`ring` with a narrow Width and bound Position opens the rose petal by petal; `in` after
  **anchor** ring by ring (preset **rose-bloom**).
- position: Bind it for a wipe.
- width: 0.05–0.1 a crisp wipe; 0.3–0.6 a soft gradient. Under ~0.05 aliases on sparse LEDs.

## Pairings
- **fire** or **clouds**, edge-fade `down` width 0.5: flames that fade before the arch tops.

## Pitfalls
- Transparency only: over nothing it fades to black.
- A narrow, fast wipe over the whole rig over 3 Hz fails the flash check.
