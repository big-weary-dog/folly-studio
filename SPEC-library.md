# Folly Studio — pattern code and the library (part of the contract)

What people and the AI write: a pattern, the pixel `p` it reads, the stdlib, modules and their chain, the
library, spatial modules, globals, param bindings, integrated clocks and palettes. The rig, looks, the sandbox
and the HTTP API stay in `SPEC.md`.

## Pattern code

A pattern is a plain script (not a module). It defines `pixel`, and optionally `params` and
`frame`. Everything in the stdlib is in scope as globals.

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
number `{ value, min, max, step? }`, `{ value: bool, type: 'toggle' }`,
`{ value: pick, type: 'color', blend? }`: a pick names palette colours or literals ("Palettes" below), such as
`'all'`, `'accent'` or `'#rrggbb'`; `{ value: 'name', type: 'choice', options: ['name', …] }` (≤ 16
options, each `[a-z][a-z0-9-]{0,31}`; a value not among them takes the default).

## The pixel `p`

| field | meaning |
|---|---|
| `x y z` | 0..1 across the whole rig (depth front → back, height, left → right) |
| `X Y Z` | metres, on the same axes |
| `lx ly lz` | 0..1 across the pixels this layer targets (so a pattern fills what it lands on) |
| `a r` | angle 0..1 (clockwise from 12 o'clock, seen from the front) and radius 0..1, in the façade (z–y) plane round the centre of this layer's pixels |
| `u i n` | position 0..1 along its fixture, index along it, fixture length |
| `zone zi fixture` | zone name, zone index, fixture index (`strand`: the same) |
| `ring sector` | the rig's `ring` and `sector` attrs, 0 / −1 where it has none (the Folly's rose: ring 1–7, petal 0–15); `row petal` are the same |
| `attr(name, d = 0)` | the rig's per-pixel attr `name`, `d` where it has none |
| `is(tag)` | true when the pixel is in a group tagged `tag` |
| `part(tag)` `parts(tag)` | which of `tag`'s parts holds the pixel (0 up, −1 none; the first that does) and how many: the groups tagged `tag`, or if one, its smallest groups (rig order; none empty) |
| `k seed` | global index; a stable random 0..1 per LED |
| `ox oy oz sx sy sz sr cy cz` | the frame `lx ly lz a r` are read in (metres): `l = 0.5 + (X − o) / 2s` per axis (a flat axis, s 0: 0.5), `a r` round `(oz, oy)` in the façade, `r` 1 at `sr`; `cy cz` the middle of the LEDs in the façade (their mean: spot and heartbeat centre there); the layer's bounds' middle, half its size, its farthest pixel from that middle and its LEDs' mean, unless a warp re-frames it (anchor) |

## Stdlib (globals inside pattern code)

`PI TAU sin cos tan asin acos atan atan2 abs min max floor ceil round sqrt pow exp log hypot sign`,
`clamp(v, lo=0, hi=1)`, `fract(x)`, `mix(a, b, t)` (numbers or colours), `step(edge, x)`,
`smoothstep(e0, e1, x)`, `soft(edge, x, width)` (an anti-aliased step: 0 below `edge − width/2`, 1 above
`edge + width/2`, smooth between; width 0 is `step`), `band(x, centre, halfWidth, softness)` (1 within `halfWidth`
of `centre`, else 0, each edge a `soft` one `softness` wide), `wave(x)` = ½+½·sin(2πx), `tri(x)`, `saw(x)`, `pulse(x, width)`
(1 near 0 falling to 0 at ±width, wrapping), `hash(n)` and `rand(a, b?, c?)` (stable 0..1),
`noise(x, y?, z?, w?)` (smooth 0..1), `fbm(x, y, z, octaves=4)`, `hsv(h, s, v)`, `hsl(h, s, l)`,
`rgb(r, g, b)`, `hex('#rrggbb')`, `scale(c, k)`, `add(c1, c2)`, `gradient(t, [c0, c1, ...])`,
`cosPalette(t, a, b, c, d)` (Inigo Quilez), `beat(t, bpm)` (phase 0..1), `dist(x1,y1,z1,x2,y2,z2)`,
`pal(name, t = 0)` (t 0..1 along colour param `name`'s pick; a bare role `low|body|accent|high`, in code from
before one colour param, walks the look palette's role; unknown or empty → `body`), `swatch(name, i)` (the same
pick's or role's i-th colour, floored and wrapping),
`palette(t)` (t 0..1 across the look palette's colours, low to high), `centres(tag)` (each group tagged
`tag`: its `centre` as `[X, Y, Z]`, `[]` when none; call it in `frame` or `pixel`), `extent()` (the running layer's
pixels' bounds in metres, `[[X0, Y0, Z0], [X1, Y1, Z1]]`, which `lx ly lz` map to 0..1: so a pattern can burst from
a `centres()` point and still fill its layer), `clock(name)` (how far number param `name`, a speed, has moved
things: "Integrated clocks" below), `DIRECTIONS` and `toward(p, direction)` ("Directions" below), and
`move(q, lx, ly, lz)`, `turn(q, a, r)` and `slide(q, u)` (the warp contract below), `use(name, params?)` → `(p, t) → colour` (`[0, 0, 0, 0]` for null), library source `name` as its own instance (its
`frame` runs once per new t; throws `unknown library pattern`, or names a retired one's preset). Colours are
`[r, g, b]` arrays, 0..1.

## Directions

A library module with a built-in orientation (it rises, falls, sweeps across, opens from the middle) says so with a
`direction` choice param, `{ value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction' }`, its default
the orientation it always had, so the UI and the generators see one convention. Its options are the directions it
draws distinctly, in `DIRECTIONS` order: a list literal when that is fewer than all (fire rises or falls or blows
sideways; bars have no `out`: `in` at the opposite speed moves the same way, its colours in reverse order). `DIRECTIONS` is `up down right left
back front out in round along`, and `toward(p, direction)` turns one into a coordinate, 0..1 across the layer: `up`
ly, `down` 1 − ly, `right` lz (the viewer's right), `left` 1 − lz, `back` lx (front to back), `front` 1 − lx, `out` r,
`in` 1 − r, `round` a (clockwise), `along` u. A free angle off it, where one makes sense, is an `angle` param in turns.
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
(by a grid of cells ≥ ¼ m, ≤ 64 a side, built per layer when first asked; nearest among the LEDs in the cells
round the point's cell and round that cell's nearest, ties to the lowest index);
`slide` sets them all from that LED. The LED fields are looked up when next read, so a stack of warps pays for one
lookup: before a source or filter, `slide`, or a warp whose code may read one (names it as `.field` or a string, or
`attr`, `is`, `part`; destructures an object; reads a computed key). A warp that re-frames (anchor: a new middle and
reach) sets `ox oy oz sx sy sz sr cy cz` and recomputes `lx ly lz a r` from `X Y Z`, so the moves after it agree. A warp writes no position field any other way.

All may define `params` and `frame(t, P, G)` (once per frame, before any pixel; state such as a trails buffer
indexed by `p.k` lives at top level). A **stage end** is a filter that holds real LED colours, as its code declares
at the top level: `const stage = 'spatial'` (it reads its neighbours: a spatial op, below, is one anyway) or
`const stage = 'history'` (it keeps colours from frame to frame, as trails does); any other value does not compile.
`isStageEnd` in the core reads the declaration, for the runtime, the converter and the chain's drawing alike. A warp
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
composites onto the stack exactly as a layer did (blend, level × clip envelope). A module that throws or returns NaN
blacks out its layer for that frame, reported with its `module` id. So "a chase masked by clouds, twisted" is
`[source single-strand, source clouds as: 'input', filter mask input: clouds, warp twist]`.

**Drawing on transparent.** A library source draws only what it is: its colour where it draws, alpha its coverage,
`null` (or alpha 0) where it draws nothing. It paints no background and fades by alpha, not toward black. A bed fills
the layer: `colour-wash`, opaque. An element over a bed
is `[colour-wash, element with blend: 'over']`, `mix(bed, element, alpha)` exactly what a source that painted the bed
itself drew; with filters that should rework the element alone, `[element, filters…, colour-wash with blend:
'under']`. Alone on a layer an element shows over black, as one that painted black would. A filter that hides or fades
(mask, edge-fade, trails) does so by alpha too: what it hides is transparent, never black. `mask` reads the brightness
of its input, or with `by: 'self'` of what is above it (so it keeps what is bright). Older code may
still paint a background.

## Library

`public/patterns/index.json` lists the library, one entry each `{ name, title, summary, tags, kind, category }`
(`shared/schemas/rig.ts`): a module (`kind` source, warp or filter; its code in `<name>.js`; `use()` runs a source
by name) or a **preset**, a recipe with no file: `{ …, kind: 'preset', layers: [{ title?, modules: [{ ref, id?,
title?, params?, blend?, as?, input?, enabled? }], blend?, level?, soften? }], globals? }`, 1–4 layers of 1–8 modules
each, a module the library's by `ref` (an `input` names an `id` in its layer), params as a look's. A category belongs
to one kind. The server drops a preset that is malformed or names a module the library lacks. The Studio makes a
preset's layers from the library's modules (fresh ids, inputs followed), on the whole rig, softened unless it says,
above the selected layer; of its `globals` it adds the macros the look lacks and its palette where the look has none,
and leaves the rest.

The library, one idea a module. Sources: colour-wash, bars, plasma, clouds, fire, spot, circles, wave, shockwave,
lighthouse, curtain, single-strand (Chase), groups-in-turn, random-fixtures, life, sparkle, streaks, ripple, lightning, fireworks, tendril,
climb, garlands, strobe, heartbeat. Warps: mirror, kaleidoscope, radial-repeat, mosaic, polar, anchor, rotate, scroll,
twist, turbulence. Filters: recolour, hue-shift, posterize, invert, mask, blur, edge-fade, trails. Presets: Water,
Storm, Curtain reveal, and the **retired sources'**: twinkle's Starfield, depth-wave's Playa wave, canopy-rain's Rain,
wash-breathe's Breathe, spire-helix's Tower helix, arch-chase's Arch chase, pinwheel's Galaxy, and by their own names palette-drift, shimmer,
rising-sweep, nave-procession, meteors, marquee, galaxy, rose-ripple, rose-chase, rose-bloom, aurora, snowstorm,
snowflakes, butterfly. Saved looks keep their code; `use()` of a retired one names its preset.

**One name, one unit, one idea.** Params that mean the same thing are named the same across the library, each with
its unit in its label: `size` a share of the layer (bigger is bigger), `speed` things a second (`spin` turns a
second), `amount` how much of the effect is mixed in, `softness` a share of what it softens; a toggle
is one word; a `plane` choice lists `facade side plan`.

## Spatial modules

A filter whose code sets `const spatial = 'blur'` is a **spatial** module: the core's native blur, which reads the
neighbours' colours (its `filter`, the identity, is what a core without it runs). The library's `blur` is one;
`layer.soften` (`{ radius, mode }`) is one more at the end of the chain, `amount` 1. Its params: `radius` (metres,
0–1.5; along the wire, metres of wire), `mode` (a choice: `wire`, the pixels of its own fixture by their distance
along it; `space`, every pixel within the radius; `both`, the two kernels summed) and `amount` (0–1, its mix with the
unblurred colour), modulated like any number param. Each pixel becomes the weighted mean of itself and its neighbours
**in the layer** (outside its groups nothing counts, so the selection's edges do not darken), weights
`exp(−2 (d / radius)²)` (e⁻² at the radius), the colour premultiplied by its alpha. `radius` or `amount` 0 leaves it
exactly as it was.

A chain with no spatial module runs in the one pass above, unchanged. One with spatial modules runs in stages: every
pixel of the layer through the modules up to the first, into a buffer prepareLayer allocated (`c`, unclamped); the
spatial op over that buffer; then the modules after it per pixel, `c` read from the buffer; and so on. Every
`frame()` still runs once a frame, before any stage. Each stage's warps are its own (a spatial module is a stage
end), and a later stage's filters' `x` is what their `input` drew in its own stage.

The neighbours come from the rig, once per scene (`neighbourGraph(scene)`: the sandbox's worker builds it at `init`,
the boxes on the first spatial layer): in **space**, every pixel within 1.5 m (a uniform grid of 1.5 m cells); along
the **wire**, each pixel of the same fixture within 1.5 m of wire (at most 64 each way). Distances are kept to 2⁻²⁰ m
and each list is sorted nearest first (ties by index), so a blur stops at its radius and sums in the same order in
every runtime. The Folly: 56 neighbours a LED in space and 25 along the wire, 3.2 MB, built in about 50 ms.

## Globals

`G` holds the look's globals for this frame (sealed; refreshed every frame): `energy` (0..1, calm → busy),
`speed`, `level`, `hue`, `saturation`, `bpm` (the look's tempo, 120 unset), `palette` (`{ name, low, body, accent, high }`, each a frozen list of
`[r, g, b]`), and each macro's value by name (`G.storm`). The runtime applies `speed` (pattern `t` is the
look's clock, ∫ speed dt, so a change never makes motion jump), `level` (master), `hue` and `saturation` (to the
composite, per pixel) for free. Clips, automation and LFOs run on show time.

## Param bindings

A number param's value (in `params`, layer or module) may be a binding instead of a number, resolved once per
frame per layer and held to the param's min..max (`from`/`to` default to them):

- `{ mod: 'lfo', shape: 'sine'|'tri'|'saw'|'square'|'hold', rate, unit: 'hz'|'beats', depth, center, hold? }`:
  `center + depth × w(t × rate)`, `w` −1..1, beats at `look.bpm` (120 unset); `center` defaults to the
  param's default, `depth` to a quarter of its range. `hold` starts at the bottom, eases up, holds at the top, eases
  down and holds at the bottom; `hold` (0..1, default 0.5, at most 0.95) is the share of each cycle spent holding,
  half at each end: an open, hold, close for a reveal.
- `{ mod: 'global', name, from, to }`: `from + (to − from) × g`, `g` the global (`energy`, `speed`, `level`,
  `hue`, `saturation` or a macro) as 0..1 of its range.
- `{ mod: 'envelope', from, to }`: by the layer's clip envelope (1 with no clips).
- `{ mod: 'beats', per = 1 }`: `per × bpm / 60`, so a speed counts per beat at the look's tempo (120 unset): a
  "rises a second" param bound to it rises `per` a beat.

A colour pick's `rotate` takes the same bindings (from 0, to 1, depth ¼ by default); it wraps rather than holds.

## Integrated clocks

`clock(name)` is ∫ P[name] dT, the distance a number param (a speed) has moved things since t = 0 in pattern time,
per module instance; a module draws motion from it (`p.ly - clock('speed')`), never from `t × P.speed`, so a speed an
LFO, a global or the envelope moves never makes the motion jump. A param with a fixed value gives value × T, exact. A
bound one is summed over show time on a fixed grid from 0 (steps of 1/128 s, the trapezoid rule, each step the
param's value then × the look's speed then, its automation included), kept per instance and started again when time
goes back: a frame played to and the same frame sought to read the same clock, to the bit. A seek to 10 minutes sums
76,800 steps (a few ms); playing adds about three a frame. A `use()` instance's params are values: value × T.

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
- `pal(role, t)` on a bare role (not a declared param) walks the look palette's role smoothly, as it always has, so
  code and looks from before picks render as they did. A declared param wins a name clash.

Picks resolve to stops when a layer is prepared and again when the palette changes; per frame only rotates move. Hue
and saturation grade the composite, literals included.

**The library's colour rule.** A source has one colour param, `colours: { value: 'all', type: 'color', label:
'Colours' }` (fire adds `tips`, its tips and embers, since flames and what rises off them are two things), and names
no role (roles lay out the pick tile for people). It maps what it draws onto positions in the pick: bands and seeded
objects to `swatch('colours', i)`; a gradient or a tail to `pal('colours', t)`, first colour to last; a head or crest
to the last colour; one colour at a time to `P.colours`. The recolouring filter (`recolour`) takes one `colours` pick
too. Code from before this rule may still name roles in `pal()`.
