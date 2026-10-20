How the library's pieces make a look. Read this once, then a kind's README to choose, then the docs of the modules
you use.

## Layers
A look is a stack of 1 to 4 layers, composited bottom (first) to top. Each layer lands on a union of groups (its
`groups`, by id) and fills what it lands on: a source's coordinates run 0..1 across the layer's own LEDs, so the
same chain fits a tower or the whole rig. Usual shape: a calm bed on the root group, then one or two layers on the
places the idea names. `level` (0..1) scales the whole layer; a bed under an element usually sits at 0.15–0.35.

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
- A **filter** reworks the colour of everything above it (recolour, fade, mask, blur, trails).
- A **warp** bends where everything above it reads its pixel (fold, turn, slide, wrap), so a warp goes after what it
  bends. `blur` and `trails` hold real LED colours and end a stage: a warp below one does not reach above it.
- `anchor` moves the centre that `in`, `out`, `round`, polar and the rotations use; put it lowest of the warps.

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
  from and to the layer's centre (or the anchor's), `round` circling it, `along` following each wire. Each module
  lists the directions it supports.
- Colours (`colours`, a pick): `all` (the palette low to high), a role (`low` `body` `accent` `high`), a slot
  (`accent2`), `rainbow`, or `#rrggbb`; joined by spaces in order (`"accent high"`) or dealt in turn with `/`
  (`"body/accent"`). A source draws only from its one pick and reads it by position: bands take colours in turn, a
  gradient runs first to last, a head or crest takes the last. So order a pick dark to bright for fire-like things.

## Bindings: motion and build
Any number param may be bound instead of set:
- `{ "mod": "lfo", "rate": 0.2, "shape": "sine", "center": 0.5, "depth": 0.5 }`: a wave in Hz, or `"unit":
  "beats"` at the look's bpm. Shape `hold` steps and holds (one step a beat, a curtain that opens and waits).
- `{ "mod": "global", "name": "energy", "from": 0.2, "to": 1 }`: follows a global or macro. Library sources never
  read energy themselves: bind density, speed or level to it to build.
- `{ "mod": "envelope", "from": 0, "to": 1 }`: the layer clip's fade.
Speeds are integrated, so binding a speed never makes the motion jump.

## Groups and tags
Groups are the rig's places (ids in the prompt's group list); a layer's groups are a union. Tags say what a group is
(`tower`, `spire`, `rose`, `arch`, `left`, `right` …): give each layer the tags it is meant for, so the look moves
to another rig. Modules that find places themselves (`anchor`, `in-turn`) take a tag, never an id.

## Globals
A look may set `globals`: `palette` (by name; every pick reads it), `speed` (0..4, 1: scales every clock), `level`,
`hue` (turns the whole look), `saturation`, `energy` (0..1, what bindings follow), `bpm`, and macros (named numbers
bindings can follow). `automation` moves a global or macro over time: energy from 0.2 to 1 over a minute is a
build. A palette sets hue, not brightness: choose one whose colours suit the idea and keep them at full strength.

## Safety and taste
- Large areas flashing, strobing or cycling colour faster than about 3 Hz fail the flash check.
- Darkness is punctuation: a dim or mostly dark look reads as broken. Movement comes from colour moving.
- Sparse places (spire strands, the rose's cells) alias: fine stripes and hard edges step from LED to LED. Prefer
  soft edges and fewer, wider features there.
