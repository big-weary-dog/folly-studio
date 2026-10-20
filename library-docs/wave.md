---
looks: One bright line snaking across the layer: a sine, zig-zag or square, rolling along.
---
A single line runs across the layer in Direction and swings either side of the middle as a sine, a triangle zig-zag or
a square wave, the shape rolling along at Speed; its colour walks the pick from one end to the other. Off the line
nothing is drawn. Reach for it for oscilloscope, music-visualiser or snake-like motifs. **bars** fills whole bands
rather than drawing a line; **garlands** drapes swags; **lighthouse** turns beams.

## Params
- colours: They stay put as the wave rolls.
- direction: Right/left/back/front swing the line up and down; up/down swing it across.
- speed: Waves passing a point each second. 0.2–0.5 is a calm swell.
- shape: On square the risers between the two levels barely draw.
- waves: 0.5–2 for a gentle swell, 4–8 for a tight wiggle.
- width: A share of the layer. 0.05 is a fine line on dense groups; 0.1–0.2 on the sparse ones.

## Pairings
- Over a dim `colour-wash` with `blend: "over"`; a second wave (negative speed, another colour) for a crossing pair.
- Under `trails` for a glowing oscilloscope trace; then `mirror` up-down for a mirrored pair.
- Bind height to the `energy` global or an lfo so the line swells with the music.

## Pitfalls
- Thin width on sparse LEDs (spires, globe strands) breaks into dots that blink as it moves; widen it there.
- Square shape draws the levels but hardly the risers: it reads as dashes, not a square wave.
