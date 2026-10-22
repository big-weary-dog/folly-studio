# Folly Studio — pattern code and the library (part of the contract)

What people and the AI write: a pattern, the pixel `p` it reads, the stdlib, modules and their chain, the
library, spatial modules, globals, param bindings, integrated clocks and palettes. The rig, looks, the sandbox
and the HTTP API stay in `SPEC.md`.

## Pattern code

A pattern is a plain script (not a module). It defines `pixel`, and optionally `params`, `frame` and `upgrade`.
Everything in the stdlib is in scope as globals.

```js
// Rising bands: bands of colour move up the layer.
const params = {
  speed: { value: 0.4, min: 0, max: 2, label: 'Speed' },
  colours: { value: 'all', type: 'color', label: 'Colours' },
};

function frame(t, P) {}            // optional: once per frame, before pixel()

function pixel(p, t, P) {          // every LED, every frame
  const x = p.ly * 3 - clock('speed'), c = swatch('colours', floor(x));
  c[3] = pulse(fract(x), 0.2);     // [r, g, b], each 0..1, and an optional alpha (coverage)
  return c;
}
```

`P` holds each param's current value (`color` params arrive as `[r,g,b]`). Param kinds:
number `{ value, min, max, step?, unit? }` (`unit: 'minute'`: a speed counted a minute, "Param bindings"), `{ value: bool, type: 'toggle' }`,
`{ value: pick, type: 'color', blend? }`: a pick names palette colours or literals ("Palettes" below), such as
`'all'`, `'accent'` or `'#rrggbb'`; `{ value: 'name', type: 'choice', options: ['name', …] }` (≤ 16
options, each `[a-z][a-z0-9-]{0,31}`; a value not among them takes the default); `{ value: picture, type: 'picture' }`
("Pictures" below; no value: an empty one); `{ value: 'text', type: 'text' }` (≤ 256 printable ASCII characters, a
value that is not takes the default; the pattern reads it: rhythm's steps, a tag list; `lines: true`: its words are
lines, which the Studio stacks one a line, in monospace, storing the spaces between them). Any kind may carry `label` (its name in
the Studio, a unit in parentheses: `'Speed (bars a second)'`) and `help` (≤ 300 characters: one or two sentences on
what it does and how it looks low and high). The Studio shows `help` on hover over the param's row, and on a touch
screen behind an ⓘ beside it; the generators' library docs give it as the param's effect. Every library param has
`help`.

Every source also has `brightness` (`SOURCE_PARAMS`: 0–1, default 1, label Brightness), after its own params: the core
scales the rgb of what `pixel()` returns by it (alpha kept), in a layer and in `use()`, so it binds like any param
(an LFO, a global, the envelope) and a look without it reads 1. A source that declares its own `brightness` keeps it
and applies it itself. The Studio shows it with the rest, and the generators' catalogue lists it on every source.

`upgrade(saved)` (optional) reads params saved for an earlier version of the module: the core hands it a copy of a
module's saved params before resolving them, in a layer and in `use()`, and uses the object it returns (the saved
params as they are if it throws or returns no object). A module whose params were renamed or re-ranged maps the old
ones there, so a look that plays it from the library (a preset, the Pi following a look) plays as it did, with no
migration. Sparkle maps its old `mode`, `length`, `sharp` and `rate` so; bars and edge-fade a
`round` direction (and bars an `orbit`). The sandbox reports each param `upgrade` changed as `[saved, upgraded]`
(`upgraded`, SPEC "Sandbox protocol"), and the Settings panel shows the upgraded value, and writes it with the first
edit, while the saved one is still what it changed, so a slider starts where the look plays and a stale report never
undoes an edit.

## The pixel `p`

| field | meaning |
|---|---|
| `x y z` | 0..1 across the whole rig (depth front → back, height, left → right) |
| `X Y Z` | metres, on the same axes |
| `lx ly lz` | 0..1 across the pixels this layer targets (so a pattern fills what it lands on) |
| `a r` | angle 0..1 (clockwise from 12 o'clock, seen from the front) and radius 0..1, in the façade (z–y) plane round the middle of this layer's LEDs (their mean: on City of Gods the rose) |
| `u i n` | position 0..1 along its fixture, index along it, fixture length |
| `zone zi fixture` | zone name, zone index, fixture index (`strand`: the same) |
| `ring sector` | the rig's `ring` and `sector` attrs, 0 / −1 where it has none (the Folly's rose: ring 1–7, petal 0–15); `row petal` are the same |
| `attr(name, d = 0)` | the rig's per-pixel attr `name`, `d` where it has none |
| `is(tag)` | true when the pixel is in a group tagged `tag` |
| `part(tag)` `parts(tag)` `partUp(tag)` | which of `tag`'s parts holds the pixel (0 up, −1 none; the first that does), how many, and its height in that part (0 its foot, 1 its top; in none, the rig's): the parts are the groups tagged `tag`, or if one, its smallest groups (rig order; none empty) |
| `k seed` | global index; a stable random 0..1 per LED |
| `ox oy oz sx sy sz sr cy cz` | the frame `lx ly lz a r` are read in (metres): `l = 0.5 + (X − o) / 2s` per axis (a flat axis, s 0: 0.5), `a r` round `(cz, cy)` in the façade, `r` 1 at `sr`; `o` the layer's bounds' middle, `s` half its size, `cy cz` its LEDs' mean in the façade and `sr` its farthest LED from that mean, unless a warp re-frames it (anchor) |
| `dt gate` | the pixel's own time and how much of it shows, 0 and 1 unless a warp sets them (in-turn): the modules above run at pattern time `T + dt` (their `t`, and `clock()`), and each source's alpha is multiplied by `gate` |

## Stdlib (globals inside pattern code)

`PI TAU sin cos tan asin acos atan atan2 abs min max floor ceil round sqrt pow exp log hypot sign`,
`clamp(v, lo=0, hi=1)`, `fract(x)`, `mix(a, b, t)` (numbers, or colours faded in OKLab), `step(edge, x)`,
`smoothstep(e0, e1, x)`, `soft(edge, x, width)` (an anti-aliased step: 0 below `edge − width/2`, 1 above
`edge + width/2`, smooth between; width 0 is `step`), `band(x, centre, halfWidth, softness)` (1 within `halfWidth`
of `centre`, else 0, each edge a `soft` one `softness` wide), `wave(x)` = ½+½·sin(2πx), `tri(x)`, `saw(x)`, `pulse(x, width)`
(1 near 0 falling to 0 at ±width, wrapping), `hash(n)` and `rand(a, b?, c?)` (stable 0..1),
`noise(x, y?, z?, w?)` (smooth 0..1), `fbm(x, y, z, octaves=4)`, `hsv(h, s, v)`, `hsl(h, s, l)`,
`rgb(r, g, b)`, `hex('#rrggbb')`, `scale(c, k)`, `add(c1, c2)`, `gradient(t, [c0, c1, ...])`,
`cosPalette(t, a, b, c, d)` (Inigo Quilez), `beat(t, bpm)` (phase 0..1 from the downbeat), `dist(x1,y1,z1,x2,y2,z2)`,
`pal(name, t = 0)` (t 0..1 along colour param `name`'s pick; a bare role `low|body|accent|high` walks the look
palette's role, "Palettes" below; unknown or empty → `body`), `swatch(name, i)` (the same
pick's or role's i-th colour, floored and wrapping),
`palette(t)` (t 0..1 across the look palette's colours, low to high), `centres(tag)` (each group tagged
`tag`: its `centre` as `[X, Y, Z]`, `[]` when none; call it in `frame` or `pixel`), `extent()` (the running layer's
pixels' bounds in metres, `[[X0, Y0, Z0], [X1, Y1, Z1]]`, which `lx ly lz` map to 0..1: so a pattern can burst from
a `centres()` point and still fill its layer; `extent('rig')` the whole rig's, which `x y z` map), `clock(name)` (how far number param `name`, a speed, has moved
things: "Integrated clocks" below), `DIRECTIONS` and `toward(p, direction)`, `region(q, rule, size = 1, seed = 0)` and `regions(rule, size = 1)` ("Directions" below), and
`move(q, lx, ly, lz)`, `turn(q, a, r)` and `slide(q, u)` (the warp contract below), `past(ago)` (in a filter that
keeps history: what was above it at this LED `ago` seconds back, "History" below), `use(name, params?)` → `(p, t) → colour` (`[0, 0, 0, 0]` for null), library source `name` as its own instance (its
`frame` runs once per new t; throws `unknown library pattern`, or for a name in `RETIRED`, "Library" below, names
its preset), `links(tag?)` (the
running layer's neighbour map, or its tag's parts': "The neighbour map" below), `waveStep(L, h, v, speed,
settle, bounce)` (one step of water on a map), `wireDistance(from)` (metres along it) and `rowOrder(by, seed)` (the
layer as one row). Colours are
`[r, g, b]` arrays, 0..1.

## Directions

A library module offering a choice of orientation (rising, falling, sweeping, opening from the middle) uses a
`direction` choice param, `{ value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction' }`, its default
the module's natural orientation, so the UI and the generators see one convention. Its options are the directions it
draws distinctly, in `DIRECTIONS` order: a list literal when that is fewer than all (clouds drift up, down, right
or left). Fire always rises up and Lightning always strikes down; Rotate places them at other orientations.
Streaks offers up, down and along; Angle tilts its fall. Scroll does not turn (Rotate's Spin does, as in
Kaleidoscope); its petal and ring step the rose's regions. Each way is named both ways, so a negative speed is never the only way to reverse (bars add
`orbit-clockwise` and `orbit-counterclockwise`, round an upright axis as seen from above). `DIRECTIONS` is `up down
right left back front out in clockwise counterclockwise along petal ring`, and `toward(p, direction)` turns one into a
coordinate, 0..1 across the layer: `up` ly, `down` 1 − ly, `right` lz (the viewer's right), `left` 1 − lz, `back` lx
(front to back), `front` 1 − lx, `out` r, `in` 1 − r, `clockwise` a (as seen from the front), `counterclockwise` 1 −
a, `along` u, `petal` (sector + 0.5) / 16 and `ring` (ring − 0.5) / 7: a step a petal (clockwise) or a ring (heart to
rim) on the rose, `clockwise` and `out` off it. A clip's wipe reads them too. `round` (`OLD_DIRECTIONS`) is read as
`clockwise` by `toward`, a clip's wipe and a choice whose options have `clockwise`, and never offered; a library
module's `upgrade` maps it. On the rose,
`region(q, rule, size, seed)` is q's pane group by a rule (`petal`, `alternate`, `ring`, `rings`, `centre`, `spiral`,
`wedges`, `checker` or `random`; size is petals a group for spiral, wedges and checker; seed picks random's), 0 up to
`regions(rule, size)`, or −1 off the rose: mask's `by: region` uses it. A free angle off it, where one makes sense, is an `angle` param in turns.
A centre is a location, not an orientation: the `anchor` warp moves it.

## Modules: a layer is a chain

A layer is a chain of modules, listed top to bottom, each a plain script like the above (stdlib in scope), by
`kind`. One rule: **every module works on everything above it**, as in an image editor (`warp(filter(source))`):

| kind | defines | does |
|---|---|---|
| `source` | `pixel(p, t, P, G) → colour` | draws onto what is above it: number (grey), `'#hex'`, `[r, g, b, a?]`, or `null` (nothing) |
| `filter` | `filter(c, q, t, P, G, x) → colour` | reworks `c`, the colour of what is above it; `x` is the colour of the module named by its `input`; the result's alpha defaults to `c`'s |
| `warp` | `warp(q, t, P, G)` | bends what is above it: moves `q` (by the contract below) for the modules above it |

**The warp contract.** Every position field of `q` stays consistent, so any warp works over any source, whatever
field the source reads. A warp moves `q` with `move(q, lx, ly, lz)` (a point in its frame), `turn(q, a, r)` (by angle
and radius round the frame's middle, in the façade; depth stays) or `slide(q, u)` (along its own fixture to the LED
nearest `u`). `move` and `turn` set `X Y Z`, `x y z`, `lx ly lz` and `a r` from that point, and every field of an
LED (`u i n`, `k seed`, `zone zi fixture`, `ring sector`, so `is()` and `attr()` too) from the layer's LED nearest it
(by a grid of cells ≥ ¼ m, ≤ 64 a side, one per set of LEDs, built when a layer that moves them is prepared; nearest among the LEDs in the cells
round the point's cell and round that cell's nearest, ties to the lowest index);
`slide` sets them all from that LED. The LED fields are looked up when next read, so a stack of warps pays for one
lookup, and a module that reads none pays nothing: before a module whose code may read one (names it as `.field` or a
string, or `attr`, `is`, `part`, `partUp`; destructures an object; reads a computed key; calls `use`), and inside
`slide`, `region` and `toward` on `along`, `petal` or `ring`. A warp that re-frames (anchor: a new middle and
reach, or with lineup the rig's) sets `ox oy oz sx sy sz sr cy cz` and recomputes `lx ly lz a r` from `X Y Z`, so the moves after it agree. A warp writes no position field any other way.
A warp that times instances (in-turn) adds to `dt` and multiplies `gate`, never sets them outright; the modules
above it, warps too, then run at `T + dt`, and a module's `frame()` still runs once a frame at `T`.

All may define `params` and `frame(t, P, G)` (once per frame, before any pixel; state such as a trails buffer
indexed by `p.k` lives at top level). A **stage end** is a filter that holds real LED colours, as its code declares
at the top level: `const stage = 'spatial'` (it reads its neighbours: a spatial op, below, is one anyway) or
`const stage = 'history'` (it keeps colours from frame to frame, as trails does); any other value does not compile.
`isStageEnd` in the core reads the declaration, for the runtime, the converter and the chain's drawing alike. A
`'history'` filter may also declare `const history = <seconds>` (above 0, at most 8): the core keeps that long of what
is above it ("History" below). A warp
bends the modules between itself and the nearest stage end above it, never the stage end or anything above that:
those colours exist only at real LEDs.

Per pixel, in one pass with no intermediate buffers (a chain without spatial modules, below): module i reads `q`, a
copy of the pixel bent by the warps below i up to the next stage end, the bottom-most first (in `[S, W1, W2]`, S
draws at W1(W2(p))); a stage end reads the pixel itself, and a warp with nothing above it in its stage does nothing.
`c` starts transparent; each enabled source or filter in order: a source computes `o` and records it; unless
`as: 'input'` (hidden, it only feeds filters) it combines into `c` by its `blend` (default `over` for the first,
`add` after; `over`, `add`, `max`, `multiply` as for layers, and `under`: beneath what is above it, `c` over `o`);
a filter sets `c = filter(…)` with `x` = the output this pixel of the earlier source its `input` names (else
undefined). `c` and `x` are `[r, g, b, a]` arrays the runtime reuses: read them, do not keep them. Then `c`
composites onto the stack as the layer's colour (blend, level × clip envelope). A module that throws or returns NaN
blacks out its layer for that frame, reported with its `module` id. So "a chase masked by clouds, twisted" is
`[source single-strand, source clouds as: 'input', filter mask input: clouds, warp twist]`.

**Drawing on transparent.** A library source draws only what it is: its colour where it draws, alpha its coverage,
`null` (or alpha 0) where it draws nothing. It paints no background and fades by alpha, not toward black. A bed fills
the layer: `colour-wash`, opaque. An element over a bed
is `[colour-wash, element with blend: 'over']`, the bed scaled toward the element by alpha, in values,
as `over` blends; with filters that should rework the element alone, `[element, filters…, colour-wash with blend:
'under']`. Alone on a layer an element shows over black, as one that painted black would. A filter that hides or fades
(mask, edge-fade, trails) does so by alpha too: what it hides is transparent, never black. `mask` reads the brightness
of its input, or with `by: 'self'` the luminance of what is above it (so it keeps what is bright), against a cutoff
that `scatter` moves per LED by `(rand(k, seed) − 0.5) × scatter` (0: one cutoff).

## Composites

A **composite** is a chain module (`kind: 'composite'`, no code) that holds 1–4 **sub-layers**, each `{ id, title,
modules, blend?, level?, groups?, tags?, enabled? }`: a chain of its own (every rule above holds inside it) that
combines onto the sub-layers listed before it by its `blend` (`over` for the first, `add` after; `under` too), scaled by
`level`, and plays only on its `groups` or `tags` within the layer (none: everywhere the layer plays). To the chain
round it a composite is one source: it combines by its own `blend` (or `as: 'input'`), a filter's `input` may name it,
and the modules after it work on all of it, so a warp after a composite bends every sub-layer and a source after it
draws on top. Per pixel, in the same one pass: a composite reads its slot's pixel `q` (bent by the warps after it), and
each sub-layer runs on a copy of `q` (bent by its own warps) into a colour of its own, transparent at the start; a
sub-layer plays on its groups' LEDs as a layer does, at the real LED, so a warp after the composite bends what each
sub-layer draws but not where it plays (as a layer's Plays on). Module ids are unique across the whole layer,
sub-layers' too. A sub-layer holds no stage end (its colours are at bent pixels, not real LEDs) and composites nest
two deep at most (a composite in a sub-layer holds none); a failing module inside one is reported by its own id. Each
sub-layer's modules count toward its own limit of 8.

In the Studio's chain (`ui/chain-tree.tsx`) a composite is a violet row whose name (in full, never cut short) opens
and shuts its sub-layers, nested under it; shut, it says what it holds ("2 sub-layers · 4 modules"). Open, it shows
its name, then each sub-layer as a head (a grip, Sub N, its name, blend, Plays on, on, delete) over its chain, drawn
as a layer's, and + Sub-layer (a module from the shelf). A module's grip drags it into or out of any sub-layer (Alt+↑/↓
steps it through the same places); a sub-layer's grip (or Alt+↑/↓ on its name) reorders its composite's sub-layers.
⧉ Composite in the chain's head puts the selected module in a new composite of one sub-layer; on such a composite it
is Ungroup, its modules back in its place.

## Library

`public/patterns/index.json` lists the library, one entry each `{ name, title, summary, tags, kind, category }`
(`shared/schemas/rig.ts`): a module (`kind` source, warp or filter; its code in `<name>.js`; `use()` runs a source
by name) or a **preset**, a recipe with no file: `{ …, kind: 'preset', layers: [{ title?, modules: [{ ref, id?,
title?, params?, blend?, as?, input?, enabled? }], blend?, level?, soften? }], globals? }`, 1–4 layers of 1–8 modules
each, a module the library's by `ref` (an `input` names an `id` in its layer), params as a look's. A category belongs
to one kind. The server drops a preset that is malformed or names a module the library lacks. The Studio makes a
preset's layers from the library's modules (fresh ids, inputs followed), on the whole rig, softened unless it says,
above the selected layer; of its `globals` it adds the macros the look lacks and its palette where the look has none,
and leaves the rest. A preset that binds `energy` brings an `energy` macro (0..1, 0.5) for it.

The library, one idea a module. Sources: colour-wash, bars, clouds, noise, fire, single-strand (Chase), life, wildfire,
waves, fireflies, sparkle,
streaks, lightning, fireworks, strobe, heartbeat, picture. Warps: mirror, mosaic, polar,
anchor, reorder, rotate, scroll, twist, turbulence, in-turn, and the rose's ring-turn, petal-repeat and petal-stride.
Filters: recolour, hue-shift,
mask, blur, edge-fade, trails, delay, smoke, replay, sort,
splash, rhythm. Presets: Water, Storm, Kaleidoscope, Tunnel and
Afterimage (mirror's Wedges and Rings, trails after lightning), One-petal kaleido (petal-repeat's sixteen); fire and smoke (Brushfire, Willow, Bonfire, Flash pots, Rising embers),
the beat (Level meter, Climbing hits, Stutter, Out of step, Call and answer, Stepping rings, Drop), Daybreak, Chain
reaction, Incense and Growth (Daybreak, Stutter and Rising embers each ride a macro they bring); and Starfield,
Playa wave, Rain, Breathe, Tower helix, Arch chase, Galaxy, Glow, Glitch, Curtain reveal, Palette drift, Shimmer,
Rising sweep, Nave procession, Meteors, Marquee, Rose ripple, Rose chase, Rose bloom, Aurora, Snowstorm, Snowflakes,
Butterfly, Plasma, Shockwave, Lighthouse and Ripple, which stand for sources the library does not have: `RETIRED` in
`compile.ts` maps each such source's name to its preset, and `use()` of one names it.

**The rose warps** move whole petals. Each finds the rose by its `rose` tag (its centre, `centres('rose')[0]`) and
turns a rose LED's point round that centre by whole sixteenths, reflected first across its own petal's centre line
where it mirrors, then slides it onto the nearest LED of its fixture by `along`: so it reads the same place in another
petal, ring and cells kept. Off the rose, or with no ring or petal, it leaves `q` alone. **ring-turn** turns ring n by
(n − 1) × (Petals per ring + ⌊Speed's clock⌋) petals, Alternate reversing the even rings; **petal-repeat** fills
the rose with Repeats copies (two, four, eight, sixteen) of the 16 / Repeats petals from Source petal, Mirror
reflecting alternate copies; **petal-stride** has petal p read petal (p × Stride + Offset) mod 16, Stride odd (an even
value reads as the next odd), so every petal is read once.

**One name, one unit, one idea.** Params that mean the same thing are named the same across the library, each with
its unit in its label: `size` a share of the layer (bigger is bigger), `speed` things a second (`spin` turns a
second), `amount` how much of the effect is mixed in, `softness` a share of what it softens; a toggle
is one word; a `plane` choice lists `facade side plan`.

## Pictures

A `picture` param's value is a picture as data, `{ grid, repeat?, key, frames }`, which the core checks
(`pictureProblem`, `readPicture`) and hands to the pattern in `P` as given, frozen. Every engine passes it through
untouched; the pattern draws it.

| field | meaning |
|---|---|
| `grid` | `rose`: a row a ring (`p.ring`, 1 the heart; without one, `r` in seven bands), each row spread clockwise round its ring from the top petal's left edge (a sixteenth of a turn per petal); `square`: rows top to bottom, each spread left to right, laid flat over the layer (`ly`, `lz`) |
| `repeat` | 1–16 (default 1): a rose row covers 1/`repeat` of the ring and repeats round it (16: a row is one petal) |
| `key` | ≤ 16 entries, one printable ASCII character → a colour: a role or slot (`body`, `accent2`: a role's first colour, a slot wrapping) or `#rrggbb`, with an optional brightness `' N%'` (`'high 25%'`). `.` and space are clear and never keys |
| `frames` | 1–16 of `{ rows, hold? }`: ≤ 128 rows of ≤ 128 characters, each in the key or clear; `hold` 1–64 ticks (default 1) |

At most 32,768 characters as JSON. Each LED or pane takes the character at its centre. A look stores the picture in the module's params; a generator's composition gives
its key as a list, `[{ char, colour }]`, which expansion makes the object.

## Spatial modules

A filter whose code sets `const spatial = 'blur'` (or `'sort'`, below) is a **spatial** module: the core's native
op, which reads the neighbours' colours (its `filter`, the identity, is what a core without it runs). The library's
`blur` is one;
`layer.soften` (`{ radius, mode }`) is one more at the end of the chain, `amount` 1. Its params: `radius` (metres,
0–1.5; along the wire, metres of wire), `mode` (a choice: `wire`, the pixels of its own fixture by their distance
along it; `space`, every pixel within the radius; `both`, the two kernels summed) and `amount` (0–1, its mix with the
unblurred colour), modulated like any number param. Each pixel becomes the weighted mean of itself and its neighbours
**in the layer** (outside its groups nothing counts, so the selection's edges do not darken), weights
`exp(−2 (d / radius)²)` (e⁻² at the radius), the colour premultiplied by its alpha, the mean taken of light (each
value's `v^2.2`, encoded again), so a lit edge spreads as light does and does not darken. `radius` or `amount` 0
leaves it exactly as it was.

`const spatial = 'sort'` (core `sort.ts`; the library's `sort`) sorts along each fixture: a run is consecutive LEDs
of one fixture in the layer whose luminance × alpha is at least `cutoff` (0–1); darker ones stay and end runs (0: whole strands). In each
run the colours (rgba) are ranked by `by` (`brightness`, that luminance, or `colour`, hue 0..1 with grey 0, in steps
of 2⁻¹⁶, ties by place) and the places by `direction`: `up` by height (to the millimetre, ties by place), `down` its
reverse, `end` along the wire, `start` its reverse; the n-th lowest colour goes to the n-th lowest place, then mixed
with the unsorted colour by `amount`. `amount` 0 leaves it exactly as it was.

A chain with no spatial module runs in the one pass above, unchanged. One with spatial modules runs in stages: every
pixel of the layer through the modules up to the first, into a buffer prepareLayer allocated (`c`, unclamped); the
spatial op over that buffer; then the modules after it per pixel, `c` read from the buffer; and so on. Every
`frame()` still runs once a frame, before any stage. Each stage's warps are its own (a spatial module is a stage
end), and a later stage's filters' `x` is what their `input` drew in its own stage.

The neighbours come from the rig, once per scene (`neighbourGraph(scene)`: the sandbox's worker builds it at `init`,
the boxes on the first spatial layer): in **space**, every pixel within 1.5 m (a uniform grid of cells ≥ 1.5 m,
≤ 64 along the longest side); along
the **wire**, each pixel of the same fixture within 1.5 m of wire (at most 64 each way). Distances are kept to 2⁻²⁰ m
and each list is sorted nearest first (ties by index), so a blur stops at its radius and sums in the same order in
every runtime. The Folly: 56 neighbours a LED in space and 25 along the wire, 3.2 MB, built in about 50 ms.

## The neighbour map

Which LEDs touch which, for modules whose light passes from LED to LED (wildfire, waves, fireflies, splash). Found once per scene from the rig's
positions (`linkMap(scene)`, built with the spatial neighbours: the sandbox's worker at `init`), undirected:

- **along a strand**: each LED and the next of its fixture, unless they are over 1 m apart (floods stay apart);
- **where strands touch**: each LED and the nearest LED of every other fixture within 0.5 m (spire strands where they
  converge, a spire on its tower, the rose's petals);
- **to the next strand of its zone**: a rung every metre of wire to the nearest LED of the zone's next fixture in rig
  order within 1.5 m, so strands that run side by side (the main arches, a spire's strands) neighbour each other.

Pieces farther apart stay separate: the map is many networks, not one. `links()` gives pattern code the running
layer's share, the same frozen object every frame of a prepared layer: `{ count, idx, off, nb }`, CSR rows by rig
index `k` (0 up to `count`), neighbours sorted by index, only pixels in the layer (`idx`, its pixels) and only
neighbours in it; read only. A stateful module keeps its arrays by `p.k`, steps them in `frame()` on a fixed grid of
`clock()` steps (so a frame played to and one sought to agree), and starts again when time goes back or jumps far.

`links(tag)` is the map between the tag's parts in the layer (rows by `p.part(tag)`, 0 up to the tag's part count;
`idx` the parts present), two parts linked where any of their LEDs link, so a module can treat each arch or spire
as one cell. `waveStep(L, h, v, speed, settle, bounce)` steps water on a map in place (Waves, Splash): `h` and `v`,
by row, each row pulled toward its neighbours' mean; `speed` links a step (substepped at half a link), `settle` the
share of motion lost a step, and at a strand's end (one link) `bounce` the share sent back, the rest let run out.

`wireDistance(from)` is how far each LED is along the layer's map from `from`, in metres, by `k`: the shortest path
over links (each as long as the gap between its LEDs), from a tag's starts (each of its groups' LEDs in the layer
within 0.1 m of the nearest to the group's centre: the rose's heart) or from `top` / `bottom` (each network's LEDs
within 0.1 m of its highest or lowest). A network no start reaches begins at each LED's straight-line distance from
the nearest start plus 2 m, then runs along its own links. Infinity outside the layer, and everywhere when the layer
holds no start. `rowOrder(by, seed)` is the layer as one row, by `k`, 0 at its first LED to 1 at its last (NaN outside
it): `strands` in rig order, `groups` by the parts of `all` (rig order within each, LEDs in none last), `random` a
shuffle by `rand(k, seed)` (seed rounded). Both are found once per prepared layer (and argument), the same array
every frame; read only. The `reorder` warp `turn`s `q` at its own angle to a radius mixed by its Amount from `r`
toward the order (wire metres over Reach, or over the farthest), so `out` and `in` follow the wiring or the row.

## History

A filter that declares `const stage = 'history'` and `const history = <seconds>` (≤ 8) gets a frame buffer, one per
instance (core `history.ts`): every frame, before its `filter()` runs at an LED, the core keeps `c` there. Frames sit
on a grid of 40 a second (a grid time between two renders keeps their blend, by alpha), as bytes, so 2 s of the
whole rig is about 1.6 MB. `past(ago)` in that filter is `[r, g, b, a]` (reused: read it, do not keep it), what was
above it at the current LED `ago` seconds back in pattern time, held to 0..`history`: 0 is `c` exactly; between grid
times it blends the two round it, so any render rate plays the same. Time going back, or forward more than half a
second, starts the buffer again; a reading further back than what it holds gets the oldest frame it has. `past()`
anywhere else throws. Delay reads one time per LED; replay one per frame for every LED. Smoke and trails keep their
own buffer by `p.k` (their own output, fed back), not this one.

## Globals

`G` holds the look's globals for this frame (sealed; refreshed every frame): `bpm` (the look's tempo, 120 unset),
`palette` (`{ name, low, body, accent, high }`, each a frozen list of `[r, g, b]`), and each macro's value by name
(`G.storm`; `G.energy` on a look with an energy macro, SPEC "Globals"). Pattern `t` is show time (plus the offset a
followed live engine gives, SPEC-live), as are clips, automation and LFOs.

## Param bindings

A number param's value (in `params`, layer or module) may be a binding instead of a number, resolved once per
frame per layer and held to the param's min..max (`from`/`to` default to them):

- `{ mod: 'lfo', shape: 'sine'|'tri'|'saw'|'square'|'hold', rate, unit: 'hz'|'beats', depth, center, hold?,
  amount?, pace? }`: `center + depth × w(t × rate)`, `w` −1..1, beats at `look.bpm` (120 unset; `rate` then cycles
  a beat, phase 0 on the downbeat); `center` defaults to the param's default, `depth` to a quarter of its range (the
  Studio shows them as From/To, `center ∓ depth`). `amount` (a macro's name) scales `depth` by its value
  0..1 of its range; `pace` multiplies the rate by its value, the phase running on its integral (exact over a lane,
  so speeding up never jumps the wave; a live push keeps it continuous). `hold` starts at the bottom, eases up, holds at the top, eases
  down and holds at the bottom; `hold` (0..1, default 0.5, at most 0.95) is the share of each cycle spent holding,
  half at each end: an open, hold, close for a reveal.
- `{ mod: 'global', name, from, to }`: `from + (to − from) × g`, `g` the macro or modulator (SPEC "Globals") as 0..1
  of its range.
- `{ mod: 'envelope', from, to }`: by the layer's clip envelope (1 with no clips). Read only: the Studio does
  not offer it and generators never write it.
- `{ mod: 'beats', per = 1 }` (a speed's beat clock): `per × bpm / 60`, so a speed counts per beat at the look's
  tempo (120 unset): a "rises a second" param bound to it rises `per` a beat. On a param with `unit: 'minute'` it is `per × bpm`.

A colour pick's `rotate` takes the same bindings (from 0, to 1, depth ¼ by default); it wraps rather than holds.

## Integrated clocks

`clock(name)` is ∫ P[name] dT, the distance a number param (a speed) has moved things since t = 0 in pattern time,
per module instance; a module draws motion from it (`p.ly - clock('speed')`), never from `t × P.speed`, so a speed an
LFO, a macro or the envelope moves never makes the motion jump. A param with a fixed value gives value × T, exact. A
bound one is summed over show time on a fixed grid from 0 (steps of 1/128 s, the trapezoid rule, each step the
param's value then, its automation included), kept per instance and started again when time
goes back: a frame played to and the same frame sought to read the same clock, to the bit. A seek to 10 minutes sums
76,800 steps (a few ms); playing adds about three a frame. A `use()` instance's params are values: value × T. On a
pixel with a time offset (`p.dt`), `clock()` reads value × (T + dt) for a fixed value and, for a bound one, its sum at
T plus dt × its rate at T, so an instance's motion runs on its own time without a second sum.

## Palettes

The look's palette (`G.palette`) has four roles: `low` for big surfaces, `body` for the bulk, `accent` for
punctuation, `high` sparingly, each a list of colours whose slots are named `low1`, `body2`, … (TD's palette CSVs). A
colour param's value is a **pick** of them, which a user, a preset or a generator can point anywhere on this ladder:

| Pick | Meaning |
|---|---|
| `'accent'`, `'body high'` | every colour of the role(s) |
| `'body2 accent1'` | single colours by slot; a slot this palette lacks is dropped (none left: its role) |
| `'body/accent'` | `/` deals the groups in turn: body1 accent1 body2 accent2 …, the shorter wrapping |
| `'all'`, `'rainbow'` | the palette low to high; seven hsv stops red to red (step: six) |
| `'#ff3c00'`, `'#3a0000 #ff3c00'` | literal colours, mixing freely with the tokens above |
| `{ pick, blend, range, rotate }` | `blend`: `'step'` (default: equal bands, only the pick's colours) or `'smooth'` (a ramp); `range`: `[from, to]`, the stretch of the walk `pal()` uses; `rotate`: a shift along the stops, 0..1 wrapping, or a binding |

Space joins tokens in order. Unknown tokens are ignored; a pick with none left plays the code's default. A param
declares its default pick and may declare `blend: 'smooth'` when its idea is a gradient; a pick with no `blend` takes
the param's. Per module instance:

- `P.name` is the pick's colour at its rotate position, resolved per frame into the same array.
- `pal(name, t)` walks it: step gives the stop under t (n equal bands), smooth ramps from the first stop to the
  last; `range` maps t into its stretch. `swatch(name, i)` is its i-th stop, whatever the blend.
- Under rotate, smooth shifts the walk along the stops and round from the last to the first; step holds each stop
  and crossfades into the next over the last fifth of it. A turning pick never cuts.
- `pal(role, t)` on a bare role (not a declared param) walks the look palette's role smoothly. A declared
  param wins a name clash.
- Every colour fade (smooth ramps, rotate's crossfades, `mix()` and `gradient()` on colours) goes through OKLab:
  each end's light (`v^2.2`), Ottosson's OKLab, straight across, and back, each channel clamped to 0..1 (or to an
  end beyond). It keeps the brightness a fade of values loses mid-way (red to green dips to a muddy olive) and passes through
  the hues between. Plain OKLab, not OKLCh: a fade between distant hues goes through the middle, not round the wheel.
- A ramp that cannot change (a pick's stops, a look palette's role: frozen lists of frozen colours) is read from a
  table of its fades' light, 64 steps a pair of colours, straight between and then clamped: its colours exact, its light
  within 0.05/255 of the fade's. `pal()` and `ramp()` on any other list fade each time.

Picks resolve to stops when a layer is prepared and again when the palette changes; per frame only rotates move.

**The library's colour rule.** A source has one main colour pick, `colours: { value: 'all', type: 'color', label:
'Colours' }`, except where it declares another for a distinct part: Fire's `tips` colours its tips and embers.
It names no role (roles lay out the pick tile for people). It maps what it draws onto positions in the pick: bands
and seeded objects to `swatch('colours', i)`; a gradient or a tail to `pal('colours', t)`, first colour to last;
a head or crest to the last colour; one colour at a time to `P.colours`. The recolouring filter (`recolour`) takes
one `colours` pick too.
