---
looks: One bright line snaking across the layer: a sine, zig-zag or square, rolling along.
---
A single line runs across the layer in Direction and swings either side of the middle as a sine, a triangle zig-zag or
a square wave, the shape rolling along at Speed; its colour walks the pick from one end to the other. Off the line
nothing is drawn. Reach for it for oscilloscope, music-visualiser or snake-like motifs; on `round` it is a wobbling
ring. **bars** fills whole bands rather than drawing a line; **garlands** drapes swags; **lighthouse** turns beams.

## Params
- colours: walked along the line from its start to its end in Direction, so the colours stay put as the wave rolls.
- direction: the way the line runs and the wave rolls. Right/left/back/front swing it up and down; up/down swing it
  across. `round` is a ring at half the radius rippling in and out; `out`/`in` is a single wavy spoke hanging straight
  down from the centre.
- speed: waves passing a point each second; negative rolls it the other way. 0.2–0.5 is a calm swell.
- shape: sine (smooth), triangle (zig-zag) or square (two flat levels; the risers between them barely draw).
- waves: how many fit across. 0.5–2 for a gentle swell, 4–8 for a tight wiggle. On `round` use whole numbers.
- height: how far it swings from the middle, as a share of the layer; 0 is a straight line, 0.5 reaches the edges.
- width: the line's thickness, as a share of the layer. 0.05 is a fine line on dense groups; 0.1–0.2 on the sparse ones.

## Pairings
- Over a dim `colour-wash` with `blend: "over"`; a second wave (negative speed, another colour) for a crossing pair.
- Under `trails` for a glowing oscilloscope trace; then `mirror` up-down for a mirrored pair.
- Bind height to the `energy` global or an lfo so the line swells with the music.

## Pitfalls
- Thin width on sparse LEDs (spires, globe strands) breaks into dots that blink as it moves; widen it there.
- On `round`, fractional waves (the default 1.5) leave a jump at 12 o'clock.
- Square shape draws the levels but hardly the risers: it reads as dashes, not a square wave.
