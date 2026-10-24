---
looks: The layer repainted in new colours by brightness: shadows one colour, highlights another.
---
Repaints everything above it in the chain; place it after its sources. Use it to put a texture (clouds, fire) in the
show's palette or make a heat-map. **hue-shift** turns all colours equally round the colour wheel.

## Pairings
- After a whole chain: mixed sources match one palette.
- Bind shift or drift to energy or an lfo.

## Pitfalls
- Steps 1 is smooth; 2–12 makes flat bands. Saved 0 is read as 1, with the same smooth result.
- Needs brightness variation: on a flat **colour-wash** all LEDs take one colour.
- Green counts bright, blue and red dark, so a rainbow does not map in order.
- Steps turns pulses into popping bands that can trip the flash check; use amount under 1.
