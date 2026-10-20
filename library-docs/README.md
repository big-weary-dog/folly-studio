How the library's pieces make a look. Each kind's README lists its modules by category; each module has its page.

## Layers
A look is a stack of 1 to 4 layers, composited bottom (first) to top. Each layer lands on a union of groups (its
`groups`, by id) and fills what it lands on: a source's coordinates run 0..1 across the layer's own LEDs, so the
same chain fits a tower or the whole rig. Usual shape: a calm bed on the root group, then one or two layers on the
places the idea names. `level` (0..1) scales the whole layer.

Layer blends, how a layer meets the layers below:
- `add`: sums light. Brightens; colours mix toward white. Good for sparkles, beams and anything mostly dark.
- `over`: covers what is below wherever the layer draws (by its alpha × level). The element on top of a bed.
- `max`: keeps the brighter of the two per channel. Overlaps without blowing out.
- `multiply`: tints what is below; a dark layer darkens. A colour cast over everything.

## Chains and the one rule
A layer is a chain of modules listed top to bottom (at most 8), or a preset (a ready chain). One rule: each module
works on everything above it, as in an image editor.
- A **source** draws its element on transparent onto what is above it. Alpha is how much it covers; it paints no
  background. The first source covers; later ones add, unless given a `blend`: `over`, `add`, `max`, `multiply`, or
  `under` (drawn beneath what is above). With `as: "input"` (and an `id`) it draws nothing itself and only feeds a
  filter whose `input` names it.
- A **filter** reworks the colour of everything above it (recolour, fade, mask, blur, trails, delay, smoke, replay,
  sort, splash, rhythm).
- A **warp** bends where everything above it reads its pixel (fold, turn, slide, wrap), so a warp goes below what it
  bends (later in the list). `blur`, `trails`, `delay`, `smoke`, `replay`, `sort` and `splash` hold real LED colours
  and end a stage: a warp below one does not reach above it.
- `anchor` moves the centre that `in`, `out`, the turning directions, polar and the rotations use; put it lowest of
  the warps.

Example, "a chase only inside clouds, mirrored": single-strand, clouds (`id: "sky"`, `as: "input"`), mask
(`input: "sky"`), mirror.

A bed fills: `colour-wash` first in the chain, then the element with `blend: "over"`; or a colour-wash layer below.
Keep a bed dim (layer level 0.15–0.35, or its brightness 0.2–0.4) so the element reads.

## Presets
A preset is a chain by name: `{ "preset": "rain", "overrides": [{ "module": "streaks", "name": "speed", "value":
0.7 }] }`. Its doc shows the recipe and which overrides matter; `module` is a ref in the recipe, `bars#2` for its
second bars. Start from a preset when one is the idea, or copy its recipe into `modules` and change it.

## Values
- Numbers within the param's range (out of range is clamped). On/off for toggles; a word for a choice.
- Directions: `up down right left back front` along the layer's axes (back is away from the front); `out` and `in`
  from and to the layer's centre (or the anchor's), `clockwise` and `counterclockwise` circling it (as seen from the
  front), bars' `orbit-clockwise` and `orbit-counterclockwise` round an upright axis (as seen from above), `along`
  following each wire. Each module lists the ones it takes.
- Colours (`colours`, a pick): `all` (the palette low to high), a role (`low` `body` `accent` `high`), a slot
  (`accent2`), `rainbow`, or `#rrggbb`; joined by spaces in order (`"accent high"`) or dealt in turn with `/`
  (`"body/accent"`). A source draws only from its one pick and reads it by position: bands take colours in turn, a
  gradient runs first to last, a head or crest takes the last. So order a pick dark to bright for fire-like things.

## Bindings: motion and build
Any number param may be bound instead of set:
- `{ "mod": "lfo", "rate": 0.2, "shape": "sine", "center": 0.5, "depth": 0.5 }`: a wave in Hz, or with `"unit":
  "beats"` its rate is cycles a beat at the look's bpm (0.25: once a bar). Shape `hold` steps and holds (one step a
  beat, a curtain that opens and waits). `"amount": "<fader>"` scales its swing by a global's or macro's value (0
  holds it at its centre); `"pace": "<fader>"` multiplies its rate by one (a storm that quickens it), never jumping.
- `{ "mod": "global", "name": "energy", "from": 0.2, "to": 1 }`: follows a global, macro or modulator. Library
  sources never read energy themselves: bind density, speed or level to it to build.
- `{ "mod": "beats", "per": 0.5 }`: a speed in time with the beat (the Studio's beat clock on its field): the
  param is `per` × the beats a second, so it follows the bpm.
Speeds are integrated, so binding a speed never makes the motion jump.

## Groups and tags
Groups are the rig's places (ids in the prompt's group list); a layer's groups are a union. Tags say what a group is
(`tower`, `spire`, `rose`, `arch`, `left`, `right` …): give each layer the tags it is meant for, so the look moves
to another rig. Modules that find places themselves (`anchor`, `in-turn`) take a tag, never an id.

## Globals
A look may set `globals`: `palette` (by name; every pick reads it), `speed` (0..4, 1: scales every clock), `level`,
`hue` (turns the whole look), `saturation`, `energy` (0..1, what bindings follow), and macros (named numbers
bindings can follow). `bpm` (40–240, 120 when unset) sits beside `globals`, not in it: the look's tempo, which LFOs
in beats and beat-clocked speeds keep. `automation` moves a global or macro between points over the duration: energy from
0.2 to 1 over a minute is a build. A palette sets hue, not brightness: choose one whose colours suit the idea and
keep them at full strength.

## Macros: one dial for many params
A macro is a named number of the look's own (`globals.macros`, at most 16; a name like `storm`). Bind params in
any layer to it and one automation lane moves them together: the storm darkens the bed while bolts come faster.
`from`..`to` maps the macro's place in its own min..max onto the param (the example below). A
layer's `level` is not a param and cannot be bound: bind a source's brightness, density or speed instead.

## Modulators: things that move together
A macro with a `mod` (an LFO) is a modulator: it moves by itself, and every param bound to it
follows the one wave, in step across layers. Each param maps it through its own `from`..`to`, so one breath can
swell a bed's brightness while it narrows a beam's width. Give a modulator `min` 0, `max` 1 and its LFO `center`
0.5, `depth` 0.5, so it sweeps its whole range. Its LFO may take `pace` and `amount` from a fader (a global, or a
macro without a mod) but never from another modulator: one level only.
```json
"bpm": 90,
"globals": { "macros": [{ "name": "storm", "value": 1, "min": 0.5, "max": 3 },
  { "name": "breath", "value": 0.5, "min": 0, "max": 1, "mod": { "mod": "lfo", "shape": "sine", "rate": 0.25,
    "unit": "beats", "center": 0.5, "depth": 0.5, "pace": "storm" } }] },
"automation": [{ "name": "storm", "points": [[0, 0.5], [60, 3]] }],
"layers": [
  { "modules": [{ "use": "colour-wash", "params": [{ "name": "brightness",
    "value": { "mod": "global", "name": "breath", "from": 0.2, "to": 0.6 } }] }] },
  { "modules": [{ "use": "clouds", "params": [{ "name": "cover",
    "value": { "mod": "global", "name": "breath", "from": 0.3, "to": 0.8 } }] }] }]
```
Everything breathes once a bar together, faster as `storm` rises. A lane on a modulator overrides its wave while
it runs. Prefer one modulator to the same LFO repeated: copies only stay in step until something changes.

## Over time: duration, clips, automation
- `duration` (seconds, 30 when unset) is how long the look runs before it loops.
- A layer's `clips` `[{ "start", "end", "fadeIn", "fadeOut" }]` (seconds) are when it plays; with none it plays
  throughout. Keep the bed clip-less and give the arrivals clips: a layer that enters at 20 s with a 4 s fade.

## Timing across places
Some modules make the same effect play in several places, each its own copy:
- **in-turn** plays what is above it once per group of a tag, one after another (`start`: forward, back, random,
  together; `every` seconds apart), or at random drops: a procession through the arches, towers taking turns.
- **anchor** with `which: nearest` gives every group of a tag its own centre at once: rings round each tower.
- **scroll** with `petal` or `ring` steps the rose a whole petal or ring at a time.
Each is a warp, below the sources it times; their docs give the params.

## Layer or module?
A new layer when the part goes on different places, plays in a different clip, or needs its own level or blend: a
bed on the root, bolts on the spires. Another module in the same chain when it works on the same place: a second
source over the first, a mask, a warp.

## Safety and taste
- Large areas flashing, strobing or cycling colour faster than about 3 Hz fail the flash check.
- Darkness is punctuation: a dim or mostly dark look reads as broken. Movement comes from colour moving.
- Sparse places (spire strands, the rose's cells) alias: fine stripes and hard edges step from LED to LED. Prefer
  soft edges and fewer, wider features there.
