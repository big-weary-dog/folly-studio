---
looks: A picture on the rose window from text rows: a flower, an eye, a heart, a clock; still or animated.
---
Draws a picture you write as text: rows of characters and a key that maps each character to a palette colour or
`#hex`. Reach for it when the idea names a thing to show (a sunflower, an eye, a heart, a clock, a sign) rather than a
motion. It is made for the rose window: 16 petals round 7 rings of glass panes, 224 in all, so a picture is a mosaic
of a few hundred coloured panes. Put its layer on the rose: `"tags": ["rose"]` (or the rose's group). A few frames,
each held a number of ticks, animate it (a blink, a beat, a hand moving). Clear cells draw nothing, so it sits over a
bed or another layer. **heartbeat** swells colour without a shape; **bars** on `in` makes plain rings.

## The picture
In your composition: `{ "grid": "rose", "repeat": 1, "key": [{ "char": "y", "colour": "accent" }], "frames":
[{ "rows": [...], "hold": 1 }] }`. The key is a list there (a saved look shows it as an object, `{ "y": "accent" }`).
- key: one printable character each, at most 16, → `low` `body` `accent` `high`, a slot (`body2`), or `#rrggbb`, with
  an optional brightness after a space: `"high 30%"`. Slots wrap round a role's colours, so `accent3` is always a
  colour. `.` and space are always clear and are never keys. Every character in a row must be in the key or clear.
- frames: 1–16, each up to 128 rows of up to 128 characters, held `hold` ticks (1–64, default 1); Speed is ticks a
  second. A picture is at most 32,768 characters as JSON. Each pane takes the character at its centre. Rows may
  differ in length: each is spread over its own ring or line. Frames follow the look's time, so they start again
  when it loops.

**Grid `rose`** (use it for anything round). The rose is 224 glass panes in 7 rings round 16 petals. Row 1 is ring
1, the heart; row 7 the rim; missing rows are clear, rows past 7 unused. The rings hold different numbers of panes:

| row (ring) | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| panes round it | 16 | 32 | 16 | 32 | 48 | 32 | 48 |
| a petal's panes | 1 | 2 | 1 | 2 | 3 | 2 | 3 |

The top petal is centred on 12 o'clock. A row's characters are spread evenly clockwise round its ring, from that
petal's left edge, and each pane takes the character at its centre. So with `repeat` 1 (the agent-friendly way) give
each row exactly as many characters as its ring has panes: 16, 32, 16, 32, 48, 32, 48. Then character 1 is the top
petal's first pane (its left one, or the only one), and every pane is set once, whatever its size. On a 48 ring the
top petal's middle pane is character 2; the hours of a clock (12 is not a petal count) are every 4th character from
the 2nd. `repeat` (one for the whole picture, every frame) N cuts each ring into N equal sectors and repeats the row
in each: with `repeat` 16 a row is one petal, so 1 character colours the whole ring, 2 split each petal left/right
(rings 2, 4, 6) and 3 give left/middle/right (rings 5, 7). Use it for a pattern the same in every petal.
A row of the wrong length is spread out with no warning: count each one. To mirror a shape left and right across
12 o'clock, character c (from 0) pairs with (n/16 − 1 − c) mod n on a ring of n: c with −c on 16, 1 − c on 32 and
2 − c on 48. The rings' centres lie at 0.23, 0.39, 0.51, 0.66, 0.79, 0.88 and 1.0 of the rose's radius.

Sunflower, a dark heart and pointed yellow petals, one petal repeated:
`{ "grid": "rose", "repeat": 16, "key": [{ "char": "b", "colour": "#3a1d05" }, { "char": "o", "colour": "#ff8c00" },
{ "char": "y", "colour": "#ffc400" }, { "char": "Y", "colour": "#fff04a" }],
"frames": [{ "rows": ["b", "b", "b", "o", "yYy", "yy", ".Y."] }] }`

An eye is round too, so use this grid: the pupil on rings 1–2 in a deep colour (navy, not black: dark glass reads as
empty), the iris on 3–5, the white on 6, the lids on 7; half-shut, the lid colour fills the petals round 12 and 6
o'clock; shut, every ring lid-coloured. A clock: a face on rings 1–6, the hours on ring 7's 48 (every 4th from the
2nd), and a hand as one petal's panes on rings 2–6; with 16 frames it steps a petal a frame.

A heart reads on this grid too, drawn by the outer rings alone (rings 1–3 are all heart): a notch at 12 o'clock on
rings 4–7, broad lobes on 5–7 reaching 3 and 9 o'clock, the sides falling away on 5–7 towards 6 o'clock, and a V
point there. Behind it, glass of a contrasting hue (violet, deep blue): a dark red gives the shape no edge, and a
shape smaller than the rose, or a smooth curve, turns into a blob. These rows read (`h` red, `b` violet):

```
"hhhhhhhhhhhhhhhh",
"hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
"bhhhhhhhhhhhhhhh",
"bbhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
"bbbhhhhhhhhhhhhhbbbbbbhhhhhhhbbbbbbhhhhhhhhhhhhh",
"bbhhhhhhhbbbbbbbhhbbbbbbbhhhhhhh",
"bbbbhhhhhhhhhbbbbbbbbbbbbhbbbbbbbbbbbbhhhhhhhhhb"
```

Beat it with frames rather than a mask: these rows a pane wider, with `H` a brighter red, then the ones above,
held 1, 1, 1, 5 ticks at speed 8 (H, h, H, h), make a lub-dub a second that swells:

```
"HHHHHHHHHHHHHHHH",
"HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
"bHHHHHHHHHHHHHHH",
"bbHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
"bbbHHHHHHHHHHHHHHbbbbHHHHHHHHHbbbbHHHHHHHHHHHHHH",
"bbHHHHHHHHHbbbbbHHbbbbbHHHHHHHHH",
"bbbHHHHHHHHHHHbbbbbbbbbbbHbbbbbbbbbbbHHHHHHHHHHH"
```

**Grid `square`** (shapes that are not round: a star, a letter, a face). Rows top to bottom, each spread left to
right over the layer's square. 32–64 rows of the same length read best: about 2 cells per pane where the panes are
smallest (ring 2), and every pane is distinct from 24. Measured from the square's centre, as a share of its width,
the rings lie at 0.12, 0.19, 0.25, 0.32, 0.39, 0.43 and 0.49: nothing is inside 0.1, so on a 32 grid the middle 6 by
6 cells show nothing, and the corners (past 0.5) show nothing either. Keep the shape big and bold, filling the circle
edge to edge, with outlines two panes thick and no detail in the middle (a detail there vanishes).

## Params
- picture: Write it per idea; the default is a pattern of palette colours.
- speed: With frames, 2–8 for a gentle animation; a blink is a frame of 20 ticks open then 2 shut at speed 10.

## Pairings
- On the rose over a dim **colour-wash** layer, or with **colour-wash** `blend: "under"` at the end of its
  chain, so clear cells keep a colour.
- **hue-shift** or the look's palette recolours keys given as palette names.
- A heart that swells in light: **heartbeat**, the heart picture `as: "input"`, a **mask** (it opens on the input's
  brightest channel, so any bright key passes), then the picture again with a dimmer key `blend: "under"` so it
  never goes dark. Frames (above) are simpler and keep the shape sharper.

## Pitfalls
- On a layer wider than the rose, a rose grid falls back to rings by distance and paints every group: target the
  rose.
- Key colours given as palette names change with the palette; give `#hex` for a colour that must stay (a sunflower's
  yellow).
- A row with a character missing from the key, or a picture over its limits, is refused; the error names it.
- **rotate** turns it a whole pane at a time: a sway smaller than a petal flips rim panes between colours rather
  than gliding. Turn it steadily (a spin) or step it with frames.
- A picture swapping large bright and dark areas more than about 3 times a second fails the flash check; a blink
  every few seconds, or a beat about once a second, passes.
