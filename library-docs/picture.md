---
looks: A picture on the rose window from text rows: a flower, an eye, a heart, a clock; still or animated.
---
Draws text rows through a key of characters to colours, for when the idea names a thing (a sunflower, an eye, a
heart, a clock) rather than a motion. Made for the rose: target `"tags": ["rose"]`. Clear cells draw nothing, so it
sits over a bed. **heartbeat** swells colour without a shape; **bars** on `in` makes plain rings.

## The picture
In a composition: `{ "grid": "rose", "repeat": 1, "key": [{ "char": "y", "colour": "accent" }], "frames":
[{ "rows": [...], "hold": 1 }] }` (a saved look shows the key as an object, `{ "y": "accent" }`).
- key: at most 16 printable characters → a role, a slot (`body2`; slots wrap, so `accent3` is always a colour) or
  `#rrggbb`, optionally with brightness: `"high 30%"`. `.` and space are always clear. Every character in a row must
  be in the key or clear.
- frames: 1–16, each up to 128 rows of 128 characters, held `hold` ticks (1–64); at most 32,768 characters as JSON.
  Frames follow the look's time.

**Grid `rose`** (anything round): 224 panes in 7 rings round 16 petals. Row 1 is ring 1, the heart; row 7 the rim.

| row (ring) | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| panes round it | 16 | 32 | 16 | 32 | 48 | 32 | 48 |
| a petal's panes | 1 | 2 | 1 | 2 | 3 | 2 | 3 |

A row is spread evenly clockwise from the left edge of the top petal (centred on 12 o'clock); each pane takes the
character at its centre. With `repeat` 1, give each row exactly its ring's pane count: a wrong length is spread with
no warning, so count. On a 48 ring the top petal's middle pane is character 2; clock hours are every 4th from the
2nd. `repeat` N repeats each row in N sectors: with 16 a row is one petal (1 character colours the ring, 2 split each
petal, 3 give left/middle/right on rings 5 and 7). To mirror across 12 o'clock, character c (from 0) pairs with −c on
16 panes, 1 − c on 32, 2 − c on 48 (mod n). Ring centres: 0.23, 0.39, 0.51, 0.66, 0.79, 0.88, 1.0 of the radius.

Sunflower: `{ "grid": "rose", "repeat": 16, "key": [{ "char": "b", "colour": "#3a1d05" }, { "char": "o", "colour":
"#ff8c00" }, { "char": "y", "colour": "#ffc400" }, { "char": "Y", "colour": "#fff04a" }], "frames": [{ "rows": ["b",
"b", "b", "o", "yYy", "yy", ".Y."] }] }`

Eye: pupil on rings 1–2 in navy (dark glass reads as empty), iris 3–5, white 6, lids 7; half-shut, lid colour fills
the petals round 12 and 6; shut, every ring. Clock: face on rings 1–6, hours on ring 7, a hand as one petal's panes on
rings 2–6; 16 frames step it a petal a frame.

Heart (`h` red, `b` violet: a contrasting background, or the shape has no edge; smaller or smoother shapes blob):

```
"hhhhhhhhhhhhhhhh",
"hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
"bhhhhhhhhhhhhhhh",
"bbhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
"bbbhhhhhhhhhhhhhbbbbbbhhhhhhhbbbbbbhhhhhhhhhhhhh",
"bbhhhhhhhbbbbbbbhhbbbbbbbhhhhhhh",
"bbbbhhhhhhhhhbbbbbbbbbbbbhbbbbbbbbbbbbhhhhhhhhhb"
```

To beat it, alternate with these rows (a pane wider, `H` brighter red), held 1, 1, 1, 5 ticks at speed 8 (H, h, H,
h): a lub-dub a second.

```
"HHHHHHHHHHHHHHHH",
"HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
"bHHHHHHHHHHHHHHH",
"bbHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
"bbbHHHHHHHHHHHHHHbbbbHHHHHHHHHbbbbHHHHHHHHHHHHHH",
"bbHHHHHHHHHbbbbbHHbbbbbHHHHHHHHH",
"bbbHHHHHHHHHHHbbbbbbbbbbbHbbbbbbbbbbbHHHHHHHHHHH"
```

**Grid `square`** (a star, a letter, a face): rows top to bottom over the layer's square; 32–64 rows of equal length.
Rings lie at 0.12, 0.19, 0.25, 0.32, 0.39, 0.43, 0.49 of the width from the centre: nothing inside 0.1 or in the
corners shows. Fill the circle edge to edge, outlines two panes thick, no detail in the middle.

## Params
- speed: Ticks a second, not frames a second: a frame held 8 ticks lasts 2 seconds at speed 4.
  2–8 for gentle animation; a blink is 20 ticks open, 2 shut at speed 10. A still picture ignores speed.

## Pairings
- Over a dim **colour-wash** layer, or **colour-wash** `blend: "under"` at the end, so clear cells keep a colour.

## Pitfalls
- On a layer wider than the rose it paints every group by distance: target the rose.
- Palette-name keys change with the palette; use `#hex` for a colour that must stay.
- **rotate** turns a whole pane at a time: spin steadily or step with frames, not a small sway.
- Swapping large bright and dark areas over ~3 times a second fails the flash check.
