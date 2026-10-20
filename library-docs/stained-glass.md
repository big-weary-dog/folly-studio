---
looks: The rose as a cathedral window: glass panes by petal, ring or spiral, lead lines, backlit.
---
Turns the rose window into stained glass. Each of its 224 panes takes one colour of Colours by a Rule (each petal,
alternate petals, each ring, alternate rings, heart against rim, a spiral, wedges, a checkerboard, a gradient heart to
rim, or at random), lit by Backlight plus the brightness of whatever is above it in the chain. Leading darkens the
edge panes where two colours meet, as lead lines do. Motion `glow` breathes each pane in its own time; `sweep` passes a
band of sunlight across. A filter: alone on a layer it is a still window; after a source (**clouds**, **plasma**,
**fire**) the light behind the glass moves while its colours stay. **picture** draws a shape instead of a pattern;
**posterize** and **recolour** keep the shapes of what is above.

## Params
- rule: `petal` a colour each petal; `alternate` and `rings` two colours; `centre` heart, middle and rim; `spiral`,
  `wedges` and `checker` use Petals; `gradient` runs Colours heart to rim; `random` panes at random by Seed.
- colours: 3–6 strong colours; jewel tones `#9b111e #0f52ba #1f8a4c #ffb000 #6a2c9c` read as a cathedral window.
- petals: 1–2 for a fine spiral or checker; 4 for four big wedges.
- seed: For `random` only.
- leading: 0.3–0.5 draws lead lines; 0 a seamless window.
- backlight: 0.7–0.9 a window lit from behind; 0.3–0.5 with a moving source above, so its light shows through.
- motion: `glow` for a living window; `sweep` for sunlight moving across.
- speed: 0.05–0.2; faster reads as flicker, not light.
- amount: below 1 lets what is above show through the glass.

## Pairings
- After **clouds** (white, slow) with backlight 0.4: light drifting behind still glass.
- On the `rose` group; a dim **colour-wash** layer on the rest keeps the Folly from going dark round it.
- **heartbeat** above it with backlight 0.3: the whole window pulses through its colours.

## Pitfalls
- Its panes are the rose's (each petal and ring); on other groups it falls back to angle and distance from the
  layer's centre, which looks like a pie chart, not glass. Target the rose.
- A palette's dim colours make dull glass; pick bright colours, or `#hex`.
- With backlight 0 and nothing above, the window is dark.
