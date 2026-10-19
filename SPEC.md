# Folly Studio — build contract

The shared contract for everyone building `studio/`. Code may refine details, but the
**interfaces** below are what the pieces rely on; change them here first.

Folly Studio is a web app where people log in, describe a show idea, get it turned into
pattern code, see it on a browser model of the installation (the Gothic Folly; any other described by a rig
file), edit it, and export it toward the real installation.

## Ground rules

- **Dependencies when they make life easier**, pinned exactly in `package.json` with `package-lock.json` committed
  (CONTRIBUTING "Dependencies" says why each is there). They are installed at setup (the browser's bundled at build
  time), never fetched at run time and never from a CDN, so the app, the sandbox and the boxes work offline on the
  playa. ES modules everywhere (`"type": "module"`), TypeScript or JavaScript: Node ≥ 22.18 runs the server's, the
  boxes' and the tests' as written (types stripped, no build); Vite builds the browser's into `dist/`.
- **Every LED comes from `public/data/rig.json`** (SPEC "Rig"); the Folly's comes from the canonical pixel CSV
  pipeline (`td/python/make_pixel_csv.py`), never re-derived by hand. Nothing else names the installation.
- **Pattern code is untrusted.** It only ever runs inside the sandbox page (below) or a box
  (bubblewrap: the render box, a Fleet worker's), never in the app page and never in the server's
  own Node process (except in tests, on our own library patterns). What a box returns is data.
- Patterns see **x = depth** (front → back), **y = height**, **z = left → right** facing the front; the rig's
  `axes` map its own coordinates onto these (the Folly's are the repo's: front/playa −12 m → back +14 m, 0 →
  18.5 m, −9 → +8 m).
- Frame rate, universes, channels per universe and colour order are the rig's `output`. The Folly: 40 fps,
  universes 1–80 of 510 channels (xLights networks), so a full frame is **40,800 channels**, RGB.

## Layout

```
studio/
  SPEC.md  README.md  DESIGN.md  IDEAS.md  package.json (+ lock)  tsconfig.json  vite.config.js  server.ts
  src/            server (Fastify): app.ts (createServer) api.ts api-looks.ts http.ts (plumbing) auth.ts store.ts
                  static.ts (serves dist/: headers, precompressed copies, ETags)  core-script.ts (the core for the boxes)
                  generate/{index,sketch,claude,fleet,prompt}.ts
                  frames.ts (pure: FSEQ parse + analysis)  bake.ts (bake queue, frame files)
                  render-box.ts (bubblewrap runner)  box-output.ts (what a box hands back, as data)
                  frames-wire.ts (stream encoder)  frames-cache.ts (chunks, downloads, encoder jobs, disk cap)
                  frames-http.ts (frames routes)  fseq-codec.ts (FSEQ zstd/zlib blocks)
                  frames-worker.ts (low-priority encoding)
  shared/schemas/ zod: look.ts (what the API stores) generated.ts (a generator's look, its JSON Schema) api.ts (bodies,
                  users, ideas) rig.ts (the rig, the library index); the server's at run time, the browser's as types
  render-box/     render.ts: bakes a look to .fseq inside bubblewrap; renderer.ts: the frame loop
  fleet-box/      check.ts + BRIEF.template.md for the boxed Fleet worker
  tools/          build_rig.py  build_palettes.py  budgets.ts (+ budgets.json: what oxlint cannot check, line budgets)
                  backup.ts (dated .tar.gz of the data)  frames-bench.ts (brotli quality vs time)
                  vite-sandbox.ts (builds the sandbox page)  vite-compress.ts (.br/.gz copies)  dev.ts (npm run dev)
  docs/HOSTING.md running it at home: tunnels, settings, resources, backups; docs/screenshots/ (DESIGN.md's)
  public/
    index.html  favicon.svg
    css/                  base (tokens, layout, components: every page);
                          pages, studio, viewer, timeline, compose (imported by their views)
    sandbox.html          the sandboxed pattern runner's page (a template: the build inlines its relay and Worker)
    js/
      pattern-core.ts     pure: stdlib, compile, scene prep, renderFrame, toChannels, re-exported from core/
                          {stdlib,compile,scene,timeline,render,globals}.ts (sandbox, boxes, Node tests)
      sandbox-relay.ts    the sandbox page's script: relay + watchdog
      sandbox-worker.ts   the sandbox's Worker: runs a look's layers on the core
      fseq.ts             pure: FSEQ v2 writer (browser + Node tests)
      frames-stream.ts    streamed playback of baked frames, and its pure decoder (manifest, chunks)
      runtime.ts          app side: owns the sandbox iframe, speaks the protocol below, adapts the frame rate
      viewer.ts           the 3D view: orbit camera (pointer and keys: viewer-input.ts); draws Points (viewer-gl.ts)
                          or Playa (playa/)
      playa/              the Playa view, loaded on first use: geometry.ts (from render hints), renderer.ts, glsl.ts
      main.tsx  api.ts    the UI's entry and its API client; ui/*.tsx: Preact components, signals for state
    patterns/             built-in library: <name>.js + index.json (sources, warps and filters)
    data/rig.json         the installation (SPEC "Rig"); the Folly's by tools/build_rig.py (committed)
    data/palettes.json    generated by tools/build_palettes.py from td/palettes/*.csv (committed)
  test/                   Vitest suites: `npm test` (= `vitest run`, vitest.config.js); e2e/: Playwright Test
                          browser checks (`npm run smoke`, `perf`, `e2e`; playwright.config.js)
  dist/                   `npm run build`: index.html, assets/<name>-<hash>.<ext>, .vite/manifest.json (not committed)
```

## Rig (`public/data/rig.json`)

The one installation-specific file: every LED, how it is addressed and grouped, and how the 3D view draws it.
The core, the boxes, the frame analysis, the generators and the viewer read only this. The Folly's is built by
`tools/build_rig.py [--check]` from `../pixel-map/` through `td/python/make_pixel_csv.py` (never by hand);
another installation writes its own (CONTRIBUTING "Adding a new installation").

```jsonc
{ "rig": 1, "name": "Gothic Folly 2026", "about": "…",   // about: optional prose for the AI generators
  "units": "m", "axes": { "up": "+y", "front": "-x", "right": "+z" },
  "output": { "protocol": "sacn", "universes": 80, "channelsPerUniverse": 510, "order": "RGB", "fps": 40 },
  "count": 4870, "bounds": { "min": [x, y, z], "max": [x, y, z] },          // of the pixels
  "fixtures": [ { "id": "main-arch-1", "name": "Main arch 1", "zone": "main-arch", "kind": "strip",
                  "start": 0, "count": 240, "render": { "radius": 0.15 } }, … ],
  "pixels": { "universe": [int], "channel": [int],    // the pixel's first channel, 1-based
              "pos": [x0, y0, z0, x1, …],             // metres, 3 decimals
              "attrs": { "ring": [int], "sector": [int] } },   // optional per-pixel numbers, any names
  "groups": [ { "id": "rose-ring-3", "name": "Rose ring 3", "parent": "rose-window", "tags": ["ring"],
                "where": { "ring": [3] } }, … ],
  "views": { "front": { "Target": [x, y, z], "Distance": 42, "Angle": 25, "Elevation": 12, "Fov": 45 }, … },
  "structure": { "lines": [[x1, y1, z1, x2, y2, z2], …], "radius": 0.024, "ground": { "y": 0 } } }
```

- **Output.** Universes 1…`universes`; a frame is `universes × channelsPerUniverse` channels. A pixel's absolute
  channel (0-based) is `(universe − 1) × channelsPerUniverse + (channel − 1)`; its three channels carry `order`
  (a permutation of `RGB`). `fps`: the show's frame rate, which bakes, exports and sACN playback use (FSEQ keeps
  whole milliseconds a frame: `1000 / fps`, rounded).
- **Axes.** `up`, `front` (the side the audience faces) and `right` (the viewer's right, facing the front) each
  name a signed rig axis (`±x`, `±y`, `±z`, all different). Positions, bounds, render hints and structure are in
  rig axes; the core turns them into the pattern frame (x depth front → back, y up, z left → right); the 3D view
  takes its cameras from them. The Folly's are the identity.
- **Fixtures** tile the pixels in order (`start` = the previous `start + count`, from 0). `id` is unique
  (`[a-z0-9-]`), `zone` a name fixtures may share (default: the id). `kind` and its `render` hints (metres,
  degrees; all optional):

  | kind | is | `render` |
  |---|---|---|
  | `strip` | pixels along a wire, in wiring order | `radius` of the glowing tube; `bulbs: true`: globes of `radius` on a thin wire; `sag`: the wire hangs this far below its chord mid-span (by 4u(1 − u); positions stay as wired) |
  | `points` | separate emitters | `radius` |
  | `cells` | one lit polygon per pixel (rose glass) | `cells`: a flat `[x, y, z, …]` loop per pixel; `normal`: the side it faces |
  | `flood` | one light cone per pixel | `cone: { angle (full), length, dir \| dirs (one per pixel), apex? (one [x, y, z] per pixel, else the pixel), solid? (a lit shell, not a beam) }` |
- **Groups**: an xLights-style tree (`parent` an id or null); the first root is the whole rig, a layer's default.
  Members: pixels whose fixture is in `fixtures` (ids) or zone in `zones`, or every pixel when the group gives
  only `where`; then only those whose attrs are listed in `where` (`{ "ring": [3] }`). A group with none of
  the three is the union of its children. `centre` (optional; default the middle of its pixels' bounds) is what
  `centres(tag)` hands patterns. `tags` say what a group is, so looks, the library and the generators find "the
  rose" on any rig. Conventional tags: `all` (the root), `arch`, `arch-main`, `arch-mini`, `arch-quad`, `tower`,
  `spire`, `spirelet`, `window`, `rose`, `ring`, `canopy`, `wash`, `flood`, `ground-level` (within reach),
  `front`, `back`, `left`, `right`; a rig may add its own.
- **Views**: named cameras as `td/config/views.json` (`Target`, `Distance`, `Angle`, `Elevation`, `Fov`,
  `Eyelock`). **Structure** (optional): unlit scaffold for the 3D view, `lines` as tubes of `radius`, and the
  `ground` plane (`y`: its height on the up axis).

The Folly: fixtures are make_pixel_csv's chains (an arch, a quad face, a spire strand, a rose petal; a
spirelet corner's or a tower's wash floods merged), `attrs` are the rose's `ring` (1–7, else 0) and `sector`
(petal 0–15, else −1), and the group tree covers Cathedral; Arches → Main arches (each arch), Mini arches
left/right (each arch), Quad arches (each of 6, each face); Spires (each of 4); Spirelets (each corner); Rose
window (each petal, rings 1–7); Canopy (each run); Wash (each tower), with the ids saved looks name.

## The 3D view

`new Viewer(canvas, { views, defaultView, onError })`; `setRig(rig)` maps the rig's axes onto the view frame (x
front → back, y up, z left → right) for positions, bounds and views; `setColors(rgb)` takes each frame as the
sandbox or the baked frames give it (count × 3, 0..1); `setHighlight(mask)`, `setView(name)`, `setOption(key, v)`
(`ghost`, `gain` from the flash guard, `insetTop`). It draws only when something changed. Two modes,
`setMode('playa' | 'points')` (resolves to the mode shown; the Studio remembers it, default Playa):

- **Points**: every LED a glowing sprite over a ground grid. The light fallback.
- **Playa**: Mirage's night playa, from the rig's render hints alone: `strip` a camera-facing ribbon per pixel
  (stepping pixel to pixel, as solid as fabric), `bulbs` globes on a wire, `points` sprites, `cells` lit glass,
  `flood` a soft beam or a lit shell; `structure.lines` a faint scaffold; a ground plane, sky and horizon. Each
  frame's light goes into one RGBA16F texture (no allocation) that the geometry samples by pixel index; spill lights
  (pixels clustered once, summed each frame) light the playa and scaffold; HDR, bloom, then Mirage's tone map on the
  peak only, so saturated colours stay saturated. It needs float render targets, else the view stays on Points.
  `setQuality('auto' | 'full' | 'lite' | 'low')`: full (pixel ratio ≤ 2, half-res bloom, 16 spill lights), lite
  (≤ 1, quarter-res bloom, 6, tubes without the neighbour blend), low (≤ 1, no bloom, 4). Auto starts at full,
  lite on a touch screen, and steps down while the median of 24 frames takes over 30 ms.

## Pattern code (what people and the AI write)

A pattern is a plain script (not a module). It defines `pixel`, and optionally `params` and
`frame`. Everything in the stdlib is in scope as globals.

```js
// Rising embers: warm sparks drift up every surface.
const params = {
  speed: { value: 0.4, min: 0, max: 2 },
  color: { value: '#ff6a00', type: 'color' },
};

function frame(t, P) {}            // optional: once per frame, before pixel()

function pixel(p, t, P) {          // every LED, every frame
  const v = pulse(fract(p.ly * 3 - t * P.speed), 0.2);
  return scale(P.color, v);        // [r, g, b], each 0..1 (optional 4th = alpha)
}
```

`P` holds each param's current value (`color` params arrive as `[r,g,b]`). Param kinds:
number `{ value, min, max, step? }`, `{ value: bool, type: 'toggle' }`,
`{ value: pick, type: 'color', blend? }`: a pick names palette colours or literals ("Palettes" below), such as
`'high'`, `'body/accent'` or `'#rrggbb'`.

### The pixel `p`

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
| `k seed` | global index; a stable random 0..1 per LED |

### Stdlib (globals inside pattern code)

`PI TAU sin cos tan asin acos atan atan2 abs min max floor ceil round sqrt pow exp log hypot sign`,
`clamp(v, lo=0, hi=1)`, `fract(x)`, `mix(a, b, t)` (numbers or colours), `step(edge, x)`,
`smoothstep(e0, e1, x)`, `wave(x)` = ½+½·sin(2πx), `tri(x)`, `saw(x)`, `pulse(x, width)`
(1 near 0 falling to 0 at ±width, wrapping), `hash(n)` and `rand(a, b?, c?)` (stable 0..1),
`noise(x, y?, z?, w?)` (smooth 0..1), `fbm(x, y, z, octaves=4)`, `hsv(h, s, v)`, `hsl(h, s, l)`,
`rgb(r, g, b)`, `hex('#rrggbb')`, `scale(c, k)`, `add(c1, c2)`, `gradient(t, [c0, c1, ...])`,
`cosPalette(t, a, b, c, d)` (Inigo Quilez), `beat(t, bpm)` (phase 0..1), `dist(x1,y1,z1,x2,y2,z2)`,
`pal(name, t = 0)` (t 0..1 along colour param `name`'s pick, else role `low|body|accent|high` through the layer's
remap; unknown or empty → `body`), `swatch(name, i)` (the same pick's or role's i-th colour, floored and wrapping),
`palette(t)` (t 0..1 across the look palette's colours, low to high), `centres(tag)` (each group tagged
`tag`: its `centre` as `[X, Y, Z]`, `[]` when none; call it in `frame` or `pixel`), and `use(name, params?)` → a
function `(p, t) → colour` running library source `name` as its own instance (its `frame` runs once per new t;
throws `unknown library pattern`). Colours are `[r, g, b]` arrays, 0..1.

### Modules: a layer is a chain

A layer is a chain of modules, each a plain script like the above (stdlib in scope), by `kind`:

| kind | defines | does |
|---|---|---|
| `source` | `pixel(p, t, P, G) → colour` | draws: number (grey), `'#hex'` or `[r, g, b, a?]` |
| `warp` | `warp(q, t, P, G)` | moves the pixel: mutates `q` (x y z X Y Z lx ly lz a r u i …) for the modules after it |
| `filter` | `filter(c, q, t, P, G, x) → colour` | reworks `c`, the chain's colour so far; `x` is the colour of the module named by its `input`; the result's alpha defaults to `c`'s |

All may define `params` and `frame(t, P, G)` (once per frame, before any pixel; state such as a trails buffer
indexed by `p.k` lives at top level). Per pixel, in one pass with no intermediate buffers: `q` is a fresh copy of
the pixel, `c` is transparent; each enabled module in order: a warp updates `q`; a source computes `o` and
records it; unless `as: 'input'` (hidden, it only feeds filters) it combines into `c` by its `blend` (default
`over` for the first, `add` after; `over`, `add`, `max`, `multiply` as for layers); a filter sets
`c = filter(…)` with `x` = the output this pixel of the earlier source its `input` names (else undefined).
`c` and `x` are `[r, g, b, a]` arrays the runtime reuses: read them, do not keep them. Then `c` composites
onto the stack exactly as a layer did (blend, level × clip envelope). A module that throws or returns NaN
blacks out its layer for that frame, reported with its `module` id. So "meteors masked by clouds" is
`[source meteors, source clouds as: 'input', filter mask input: clouds]`.

### Globals

`G` holds the look's globals for this frame (sealed; refreshed every frame): `energy` (0..1, calm → busy),
`speed`, `level`, `hue`, `saturation`, `palette` (`{ name, low, body, accent, high }`, each a frozen list of
`[r, g, b]`), and each macro's value by name (`G.storm`). The runtime applies `speed` (pattern `t` is the
look's clock, ∫ speed dt, so a change never makes motion jump), `level` (master), `hue` and `saturation` (to the
composite, per pixel) for free. Clips, automation and LFOs run on show time.

### Param bindings

A number param's value (in `params`, layer or module) may be a binding instead of a number, resolved once per
frame per layer and held to the param's min..max (`from`/`to` default to them):

- `{ mod: 'lfo', shape: 'sine'|'tri'|'saw'|'square', rate, unit: 'hz'|'beats', depth, center }`:
  `center + depth × w(t × rate)`, `w` −1..1, beats at `look.bpm` (120 unset); `center` defaults to the
  param's default, `depth` to a quarter of its range.
- `{ mod: 'global', name, from, to }`: `from + (to − from) × g`, `g` the global (`energy`, `speed`, `level`,
  `hue`, `saturation` or a macro) as 0..1 of its range.
- `{ mod: 'envelope', from, to }`: by the layer's clip envelope (1 with no clips).

A colour pick's `rotate` takes the same bindings (from 0, to 1, depth ¼ by default); it wraps rather than holds.

### Palettes

The look's palette (`G.palette`) has four roles: `low` for big surfaces, `body` for the bulk, `accent` for
punctuation, `high` sparingly, each a list of colours whose slots are named `low1`, `body2`, … (TD's palette CSVs). A
colour param's value is a **pick** of them, so every colour param is a slot a user, a preset or a generator can
point anywhere on this ladder:

| Pick | Meaning |
|---|---|
| `'accent'`, `'body high'` | every colour of the role(s), through the layer's remap |
| `'body2 accent1'` | single colours by slot; a slot this palette lacks is dropped (none left: its role) |
| `'body/accent'` | `/` deals the groups in turn: body1 accent1 body2 accent2 …, the shorter wrapping |
| `'all'`, `'rainbow'` | the palette low to high; seven hsv stops red to red (step: six) |
| `'#ff3c00'`, `'#3a0000 #ff3c00'` | literal colours, mixing freely with the tokens above |
| `{ pick, blend, range, rotate }` | `blend`: `'step'` (default: equal bands, only the pick's colours) or `'smooth'` (a ramp); `range`: `[from, to]`, the stretch of the walk `pal()` uses; `rotate`: a shift along the stops, 0..1 wrapping, or a binding |

Space joins tokens in order. Unknown tokens are ignored; a pick with none left plays the code's default. A source
declares a slot's default, usually a role (`{ value: 'body/accent', type: 'color' }`), and may declare `blend:
'smooth'` for a slot that is a gradient by nature; a pick with no `blend` takes the slot's. Per module instance:

- `P.name` is the pick's colour at its rotate position, resolved per frame into the same array.
- `pal(name, t)` walks it: step gives the stop under t (n equal bands), smooth ramps from the first stop to the
  last; `range` maps t into its stretch. `swatch(name, i)` is its i-th stop, whatever the blend.
- Under rotate, smooth shifts the walk along the stops and round from the last to the first; step holds each stop
  and crossfades into the next over the last fifth of it. A turning pick never cuts.
- `pal(role, t)` on a bare role (not a declared param) ramps smoothly, as it always has, so code and looks from
  before picks render exactly as they did. A declared param wins a name clash.

A layer's `palette` (`{ low?, body?, accent?, high? }` of picks) remaps its roles for every module on it, the
`use()` instances they run included: role tokens and `pal(role, t)` read the remap, which is smooth unless its pick
says `blend: 'step'`. A remap's tokens read the look palette's own roles; slots, `all`, `G.palette` and `palette(t)`
are always the look palette's. Picks resolve to stops when a layer is prepared and again when the palette changes;
per frame only rotates move. Hue and saturation grade the composite, literals included.

## Looks (what gets saved)

A look is a stack of layers, composited bottom to top like xLights rows reversed (index 0 is the
bottom). The rules below are `shared/schemas/look.ts`; its types (`Layer`, `Module`, `Globals`, …) are the
browser's too:

```jsonc
{ "title": "Coral reef", "summary": "…", "duration": 30, "bpm": 120, "layers": [
  { "id": "l1", "title": "Sea", "groups": ["cathedral"], "tags": ["all"], "blend": "add" | "over" | "max" | "multiply",
    "level": 1, "clips": [{ "start": 0, "end": 12, "fadeIn": 2, "fadeOut": 3 }],
    "palette": { "body": "accent2 accent3", "high": "#ffffff" },
    "modules": [
      { "id": "m1", "kind": "source", "title": "Meteors", "ref": "meteors", "code": "…",
        "params": { "speed": 40, "head": "high", "color": { "pick": "body/accent", "rotate": 0.25 } } },
      { "id": "m2", "kind": "source", "title": "Clouds", "ref": "clouds", "code": "…", "params": {}, "as": "input" },
      { "id": "m3", "kind": "filter", "title": "Mask", "ref": "mask", "code": "…", "input": "m2",
        "params": { "amount": { "mod": "global", "name": "storm", "from": 0, "to": 1 } } }
    ] }
],
  "globals": { "speed": 1, "level": 1, "hue": 0, "saturation": 1, "energy": 0.5,
    "palette": { "name": "carnival", "low": ["#6700cb"], "body": ["#ee008e"], "accent": [], "high": ["#f9e9cf"] },
    "macros": { "storm": { "value": 0.2, "min": 0, "max": 1 } } },
  "automation": { "energy": [[0, 0.2], [20, 1]], "storm": [[0, 0], [30, 1]] } }
```

`groups` is an array of the rig's group ids (union; none: the rig's root). `tags` (optional, ≤ 16 of
`[a-z0-9-]{1,32}`) make a layer portable: when it names no groups, or one this rig lacks, the layer takes its
known ids plus every group carrying one of its tags (a rig without them lights nothing there); where all its
ids are known, tags change nothing. An unknown id in a layer without tags is an error. Generators set both; editing a
layer's groups by hand clears its tags. Blend: `add` sums light (default), `over` replaces where the layer
has alpha × level, `max` keeps the brighter channel, `multiply` tints what is below.

- **Modules**: 1–8 per layer, ids unique in it (`[A-Za-z0-9_.:-]{1,64}`), `code` ≤ 20 kB each and always
  stored (looks stay self-contained for the boxes); `ref` names the library entry it came from; `params`
  override the code's defaults; `enabled: false` skips it; `input` names an earlier source; `as` is only
  `'input'`; `blend` as for layers. A layer with `code` (+ `params`) and no `modules` is a one-source chain and
  renders exactly as before.
- **Colours** ("Palettes"): a colour param's value is a pick string (≤ 200 characters, not checked: a bad one plays
  the default, as a bad hex always did), `[r, g, b]`, or `{ pick, blend?, range?, rotate? }` (checked: tokens, `step`
  or `smooth`, two numbers 0..1, a number 0..1 or a binding). `layer.palette` is `{ low?, body?, accent?, high? }` of
  picks, checked; absent, the layer plays the look palette.
- **Globals** (all optional): `speed` 0..4 (1), `level` 0..1 (1), `hue` −0.5..0.5 turns (0), `saturation`
  0..2 (1), `energy` 0..1 (0.5); `palette` as role lists (≤ 16 `#rrggbb` each; a bare name from
  `data/palettes.json` is filled in on save; default `chapel`); `macros` ≤ 16, names
  `[a-z][A-Za-z0-9_]{0,31}` other than G's own, `{ value, min = 0, max = 1 }`.
- **Automation**: `{ <global or macro>: [[t, v], …] }`, ≤ 16 lanes of ≤ 256 points, t 0–600 s ascending (to
  the ms); linear between points, held before the first and after the last; it replaces the static value.
- `data/palettes.json` (`tools/build_palettes.py [--check]`, from `td/palettes/*.csv`; roles as `td/README.md`
  "Colours"): `{ version: 1, roles: [low, body, accent, high], palettes: [{ name, low, body, accent, high }] }`.

### Timeline

Sequencing lives on the look, xLights-style.

- `look.duration`: seconds the look runs, then loops; 1–600, default 30 (absent = 30).
- `look.bpm`: optional, 40–240; the editor's beat grid, and the tempo of LFOs in `beats` (nothing else).
- `layer.clips`: optional `[{ start, end, fadeIn = 0, fadeOut = 0 }]` in seconds (0–600, kept to
  the millisecond), ≤ 32 per layer, sorted, not overlapping (touching is fine). No or empty
  clips: the layer is always on (looks from before the timeline are unchanged).
- A clip only scales the layer's level by its envelope: 0 outside `[start, end)`, ramping
  linearly 0 → 1 over `fadeIn` and 1 → 0 over `fadeOut` (when the fades add up to more than
  the clip, both shrink in proportion). Where the envelope is 0 the layer does not run at all
  (no `frame()`, no `pixel()`). Pattern `t` stays show time, so motion is continuous across cuts.
- Sequencing whole looks = importing another look's layers into this one, then placing clips.
- Preview loops over `duration`; bakes and `.fseq` exports render `duration` from t = 0.
- The Studio edits it in a Timeline panel (`ui/timeline*.tsx`): docked under the 3D view beside
  Code on a wide screen (drag, trim, fade, zoom, snap to ¼ s or beats), a Time tab on a phone
  (the selected clip's numbers). The editor's edits (`ui/timeline-model.ts`, pure) keep every
  rule above, so what it saves the API accepts. Under the layers, a lane per automated global (energy, macros):
  click to add a point, drag to move it, double-click to remove it.
- Composition (`ui/chain.tsx`, `ui/params.tsx`, `ui/shelf.tsx`, `ui/look-globals.tsx`): the selected layer's
  module chain (kind badge, enable, reorder, delete, a filter's input), shelves of library modules by kind and category, the code editor and
  params on the selected module (each number param can be modulated), and a Look panel of globals, the palette
  (each swatch titled by its slot, `body2 · #fd7f40`) and macros. On a phone: globals and palette in the Look tab;
  the chain read-only but for enable and params.
- Colours (`ui/picks.tsx`, `ui/pick-model.ts`; "Palettes"): a colour param is one row, the colours its pick plays,
  its text, ▾ the pick tile, ∿ to move its rotate (the modulate dialog), ↺. The tile is TD's pick: a row per role
  (a box for the whole role, a cell per slot), the whole palette, rainbow, custom colours, then whether roles
  alternate (`/`), blend, range and rotate. The layer's Colours row, under Plays on, shows each role as it plays
  here and remaps it with the same tile (`layer.palette`). On a phone the tile is a sheet with the palette and a
  custom colour; blend, range and rotate show when set.

## Sandbox protocol (runtime.ts ⇄ sandbox.html)

The app embeds `<iframe sandbox="allow-scripts">` on the sandbox page, which the build makes self-contained
(`tools/vite-sandbox.ts`): `public/sandbox.html` with `js/sandbox-worker.ts` and the pattern core as one classic
script in a `<script type="text/x-folly-worker" id="pattern-worker">` data block, and `js/sandbox-relay.ts` as one
inline script, both minified, at `/assets/sandbox-<hash>.html` (runtime.ts imports its URL as
`'../sandbox.html?sandbox'`; the dev server builds it for each request at `/sandbox.html`). It is served with
`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; sandbox allow-scripts`
(opaque origin, no network, no cookies), so it loads nothing. The sandbox's first `ready` and the app's `init` go by
`postMessage(msg, '*')` (the app checks `event.source === iframe.contentWindow`); `init` carries a `MessagePort`, and
every message after it goes over that channel, both ways (Chrome takes about a millisecond to unpack each window
message between a page and an opaque-origin frame; a port's take microseconds).

Pattern code never runs on the sandbox page's thread (a same-process iframe shares the app's).
The page starts a Worker from a Blob holding the data block's script, the core and its runner, all in one function
scope (it inherits the CSP, so no network either), relays messages to it and keeps time.

| app → sandbox | sandbox → app |
|---|---|
| `{ type: 'init', rig, library? }` + a `MessagePort` (library: `[{ name, code }]` sources for `use`) | `{ type: 'ready' }` (also sent once on load, before init) |
| `{ type: 'look', layers, globals?, automation?, bpm? }` (as saved) | `{ type: 'compiled', layers: [{ id, ok, error?, params, modules: [{ id, ok, error?, params }] }] }` (`params`: the first source's schema) |
| `{ type: 'frame', seq, t }` | `{ type: 'frame', seq, rgb: Float32Array(count×3), errors: [{ id, module?, error }], ms, layerMs: { <layer id>: ms } }` (rgb transferred; `ms` the frame's, `layerMs` each layer's, timed in the worker) |
| `{ type: 'render', seq, start, frames, fps, gamma, brightness }` | `{ type: 'progress', seq, done }` … then `{ type: 'rendered', seq, channels: Uint8Array(frames × frame channels) }` |

Compute is decoupled from drawing: the app keeps one `frame` request in flight and asks at 40 fps, stepping down to
30 and then 20 while the worker's `ms` (smoothed) is over budget, 80 % of the frame interval, and back up once it is
well under the faster rate's; the 3D view draws at display rate when something changed, and idles otherwise. A layer
whose smoothed `layerMs` is over 40 % of a 40 fps frame's budget (8 ms) is marked heavy on its card.
A layer that throws or returns NaN goes black for that frame and is reported in `errors`. Live frames keep
the look's clock continuous across a new look (`prepareLook(look, previous)`); renders start it afresh, as bakes do.
Watchdog (the page's): a frame, live or exported, running over 1 s, or new code compiling for
over 0.7 s, has hung. The page terminates the worker, finds the layer to blame (the one being
compiled, or each layer run alone for one frame in a throwaway worker), starts a fresh worker
without it and reports it as an error starting `Pattern hung`; it stays paused until its code
changes. Every `frame` request is answered within 1.5 s. The app (runtime.ts) tears the iframe
down and reloads it only if the page itself stops answering for 4 s (8 s during an export, while the page probes a
hung layer).

`pattern-core.ts` exports (used by the sandbox's worker, the boxes and the Node tests), and its types (`Scene`,
`PreparedLayer`, `PreparedLook`, `Compiled`, `ParamSchema`, `Pixel`, `G`, `LayerInput`, …):
`STDLIB`, `compilePattern(code) → { kind, pixel, frame, params }` (throws on syntax error / no `pixel`),
`compileModule(code, kind) → { kind, pixel | warp | filter, frame, params, picks }` (`picks`: the instance's colours,
"Palettes"), `readPick(value) → { groups, blend, range, rotate } | null` and `pickText(groups)` (a pick read leniently,
and as text), `layerModules(layer) → modules`
(a legacy layer → one source), `compileLayer(layer) → compiled[]` (throws `title: error`), `setLibrary([{ name,
code }])`, `prepareScene(rig) → scene` (throws on a malformed rig), `groupsByTag(scene, tag) → [group]` (outermost
first), `pixelsForGroups(scene, ids, tags?) → Int32Array` (a layer's rule above), `tagMask(scene, tag) → Uint8Array`,
`tagCentres(scene, tag) → [[X, Y, Z]]`, `flashRegions(scene) → [{ id, idx | null, large }]` and `LARGE` (Baked
frames, Checks), `prepareLayer(scene, layer, compiled | compiled[]) → prepared`
(keeps `normalizeClips(layer.clips)`), `prepareLook({ globals, automation, bpm }, previous?) → look`,
`renderFrame(scene, preparedLayers, t, out?, look?) → { rgb, errors }` (level × `layerEnvelope`; skips layers at
0; allocation-free per layer; sets each prepared layer's `ms`, its time this frame), `normalizeGlobals(globals)`, `automationAt(points, t)`, `PALETTE_ROLES`,
`DEFAULT_PALETTE`, `MODULE_KINDS`, `GLOBALS`,
`toChannels(scene, rgb, out?, { gamma = 1, brightness = 1 }) → Uint8Array(frame channels)` (in the rig's colour
order), and for the
timeline `layerEnvelope(clips, t) → 0..1`, `normalizeClips(clips) → clips | null` (lenient: drops
bad and overlapping clips), `lookDuration(look) → seconds`, `DEFAULT_DURATION` `MIN_DURATION`
`MAX_DURATION` `MAX_CLIPS`.

`fseq.ts` exports `writeFseq({ channelCount?, frames, stepMs = 25, data: Uint8Array, media?, ranges?, compression? })
→ Uint8Array` (FSEQ v2.0). `ranges: [[startChannel, count], …]` (0-based, ascending, ≤ 255) writes a
sparse file: each frame holds only the ranged channels, so `channelCount` is their total.
`compression: { type: 'zstd' | 'zlib', blocks: [{ frame, bytes }] }` writes a compressed file
instead of `data` (type 1 / 2; each block one whole zstd frame or zlib stream of its frames,
compressed by the caller; ≤ 255 blocks, so the block count's high nibble in byte 20 stays 0).
Header length = 32 + 8 × blocks (u32 first frame, u32 compressed length) + 6 × ranges (u24 start,
u24 count). `fseqBlocks(frames, per = 80) → [[first, count], …]` splits frames into ≤ 255 blocks.

## Static files

`npm run build` (Vite, `vite.config.js`) builds `public/` into `dist/`: `index.html` naming its entry module, the
modules it loads eagerly (`modulepreload`) and its stylesheet, and every other file under `assets/` with a content
hash in its name (`<name>-<8 characters>.<ext>`): modules and their split chunks, each view's stylesheet (imported
by the view's module and loaded with it), the data modules fetch (`new URL('../../data/rig.json',
import.meta.url)`), the favicon and the sandbox page. `.vite/manifest.json` says what each module loads with it.
Nothing is inlined into the app's pages (no data: URLs, no inline script; the modulepreload polyfill is off). Beside
each text file of 512 bytes or more the build writes `<file>.br` (quality 11) and `<file>.gz` (9) where smaller
(`tools/vite-compress.ts`), so nothing static is compressed per request.

`src/static.ts` (@fastify/static) serves `dist/` under the app CSP (`CSP_APP`): files under `assets/` with
`Cache-Control: public, max-age=31536000, immutable`, the sandbox page with `CSP_SANDBOX`; the shell (`index.html`, for
every SPA route) `no-cache`; anything else 5 minutes. Text goes br or gzip from those copies as the request accepts
(`Vary: Accept-Encoding`); every file has an ETag (each encoding its own) and Last-Modified. Dotfiles (`.vite/`) are
never served, and other methods are 405. Without a build, every static path is a 404 and the server says to run
`npm run build`.

## HTTP API (JSON; cookie session)

Mutating requests must be `Content-Type: application/json` and, when an `Origin` header is
present, same-origin. Errors are `{ error: "message" }` with a 4xx/5xx status. A body is a JSON object of at most
256 KB (413 past it; empty is `{}`), checked by the shared schemas (`shared/schemas/api.ts`, `look.ts`): a 400 names
the first problem ("Layer 2, clip 1: start must be a number of seconds from 0 to 600."). Unknown routes are 404, a
known path's other methods 405 with `Allow`. Signing up or in is limited per client address (100 a minute) and, for
failures, per address and username (10 a minute): 429 with `Retry-After`.

```
POST   /api/signup   { username, password }   → { user }            (sets cookie)
POST   /api/login    { username, password }   → { user }
POST   /api/logout                            → { ok: true }
GET    /api/me                                → { user } | 401
GET    /api/ideas                             → { ideas: [idea] }    mine, newest first
POST   /api/ideas    { text }                 → { idea }             queued for generation
GET    /api/ideas/:id                         → { idea }             mine only
GET    /api/looks?scope=mine|gallery          → { looks: [listed] }  metadata only: no layers
POST   /api/looks    { title, summary?, layers, duration?, bpm?, globals?, automation?, ideaId? } → { look }
GET    /api/looks/:id                         → { look }             mine, or shared
PUT    /api/looks/:id { title?, summary?, layers?, duration?, bpm?, globals?, automation?, shared? } → { look }
                                              owner only; keeps versions
DELETE /api/looks/:id                         → { ok: true }         owner only
POST   /api/looks/:id/bake                    → 202 { bake }      owner, or a curator if shared; queued
GET    /api/looks/:id/frames[?compress=1|zstd|zlib] → the baked .fseq   mine, or shared; 404 if none (attachment);
                                              503 + Retry-After while evicted frames are baked again
GET    /api/looks/:id/frames/wire             → 302 to its manifest; 202 { pending } + Retry-After while encoded
                                              (or baked again)
GET    /api/looks/:id/frames/:hash/manifest   → the stream manifest (immutable)        mine, or shared
GET    /api/looks/:id/frames/:hash/:n         → stream chunk n (immutable; br/gzip)  mine, or shared
GET    /api/library                           → { patterns: [{ name, title, summary, tags, kind, category, code }] }
```

API `GET`s answer `Cache-Control: private, no-cache` with an ETag (a reload or a poll revalidates to an
empty 304); other responses are `no-store`. JSON bodies of 1 KB or more are sent br (quality 5) or gzip
when the request accepts it, with `Vary: Accept-Encoding`; the ETag is the uncompressed body's. A list
holds `listed = { id, owner, ownerName, title, summary, duration, layerCount, shared, reviewed, bpm?, sharedAt?,
ideaId?, createdAt, updatedAt }`; `GET /api/looks/:id` has the rest.

`PUT reviewed: true` answers 409 with the reason unless the look has a passing render-box bake of
its current layers; large-area flashing in any bake always blocks (flashing on small regions only
warns: `bake.warning`). Changing `layers`, `duration`, `globals` or `automation` (`null` clears either) makes
a version (`{ title, summary, layers, duration, globals?, automation?, savedAt }`), drops the bake and its
frames and clears `reviewed`; `bpm` (`null` clears it) does not. Clips that overlap or fall
outside 0–600 s, and a duration outside 1–600 s, are refused with 400.

`user = { id, username, role: 'member' | 'curator' }` (curators listed in `STUDIO_CURATORS`).
`idea = { id, owner, text, status: 'queued'|'generating'|'ready'|'failed', generator, lookId?, error?, createdAt, updatedAt }`.
`look = { id, owner, ownerName, title, summary, layers, duration, bpm?, shared, ideaId?, reviewed, bake?, createdAt, updatedAt }`
(`bake`: see Baked frames).

## Generators (idea → look)

`src/generate/index.ts` runs a small in-process queue. An adapter is
`async generate({ text, user, library, rig, groups }) → { title, summary, duration?, globals?, automation?, layers }`
(`groups`: the rig's)
and is chosen by `STUDIO_GENERATOR` (`sketch` default, `claude`, `fleet`). Generators find places by the rig's
tags (falling back to group ids and names), describe the installation from the rig (`about`, its fixtures and
groups), and give layers the tags they meant beside the ids. The result is cleaned by `validateLook`
(`shared/schemas/generated.ts`, zod: ≤ 4 layers,
known group ids (none known: the root) and tags, code ≤ 20 kB containing `function pixel`, or modules whose code defines their kind's
function; clips and duration normalised, bad or overlapping clips dropped; `globals` and `automation`
cleaned, a palette name filled in; picks and a layer's `palette` cleaned of unknown tokens) before a look is saved and the idea set `ready`. Old single-code layers
stay valid. Generators may add
clips and a duration for ideas that describe a progression; most looks have neither.

- `sketch`: offline, keyword → library pattern(s) + params, place words → tags. Colour words choose the palette
  nearest them in hue and become the nearest swatch's slot (`accent2`; none close: the colour itself), on a colour
  param, or for a pattern that reads only the palette, its layer's `palette` (`low` for a colour set "on" or
  "behind" something, else `body`). Always available.
- `claude`: one Messages API call with the pattern guide + library examples as the system prompt, and structured
  output whose JSON Schema is the generated look's own (`wireSchema(groups)`: group ids and tags as enums).
- `fleet`: hands the idea to a boxed Fleet worker as an untrusted brief (experimental), in a workspace holding
  copies of the modules `check.ts` imports (the core's, `fseq.ts`, `frames.ts`), as they are. The worker
  also bakes (`node check.ts --bake`); the adapter returns `bake` + `frames` (see below), and
  the queue stores them with the look. This foundry is opt-in: it runs only with `STUDIO_FOUNDRY=on`,
  one job at a time in a slot of its own. While it is off or busy, its ideas go to the one-shot
  generator (`STUDIO_GENERATOR_FALLBACK`, else `sketch`), or wait for it with `STUDIO_FOUNDRY_WAIT=1`.
  Without a systemd user bus (`systemd-run --user --scope` fails, as on WSL) Fleet's boxes have no
  memory cap, and the server warns at start.

## Baked frames

Frames are the deliverable; the server never runs look code itself, it only parses and measures
bytes a box hands back. Anything a box says about itself is kept as `boxStats: { untrusted: true }`.

- **Boxes.** `render-box` (authoritative, any look): `src/render-box.ts` runs `render-box/render.ts`
  under bubblewrap (`--unshare-all`, no network, `--clearenv`, read-only node + its libraries +
  the core as one script (`src/core-script.ts`, from its source) / renderer.ts / fseq.ts / rig.json /
  `public/patterns` (for `use`), tmpfs /tmp, one
  empty writable /out; the look on stdin as `{ layers, globals?, automation?, bpm? }`), with prlimit
  (CPU s, tasks, file size, RLIMIT_DATA; no RLIMIT_AS) and a wall-clock kill. Inside, layers run in
  a `node:vm` realm holding only the stdlib (defence in depth). No bubblewrap → 503, no fallback.
  One bake at a time, under `nice` (`STUDIO_BAKE_NICE`, default 10), in a lane it shares with wire encodes
  (`src/bake.ts` `createLane`), so the two never run at once. `fleet-box` (advisory): the Fleet worker's own `frames.fseq` + `stats.json` (its `use`
  library: `patterns/` beside check.ts, else none). All three run the same core and `renderer.ts`.
- **Length.** A bake renders the look's `duration` from t = 0, honouring clips, but at most
  `STUDIO_BAKE_SECONDS` (default 120 s, ≤ 600) in the render box; `fleet-box/check.ts --bake`
  does the same (`--seconds` overrides). `look.bake.seconds` records what was baked; a bake is
  dropped if the layers or duration change while it runs. The box's wall-clock and CPU budgets
  default to 30 s + 1.5 s per second baked (at least 90 s / 120 CPU s).
- **Format.** The rig's fps, sparse FSEQ v2 covering only the rig's channels (the Folly: 40 fps, 33 ranges, 14,610
  ch; 20 s ≈ 11.7 MB, 120 s ≈ 70 MB, where full 40,800-ch frames would be ≈ 32.6 MB for 20 s). Files are
  capped at 64 MB, or ≈ 0.6 MB a second of `STUDIO_BAKE_SECONDS` when that is more
  (`STUDIO_BAKE_MAX_FRAMES` overrides).
- **Checks** (`src/frames.ts`, pure): `parseFseq(bytes, { maxBytes, maxDataBytes = maxBytes, decompress? })`
  is strict (magic, v2.x, consistent header/offset/sizes, ranges within `maxChannels` (default 80 × 510; the
  rig's frame where the host knows it), data = frames ×
  channels). Compressed files (zstd, zlib) are read only with `decompress(type, bytes, size)`
  (`src/fseq-codec.ts` `inflateBlock`: node:zlib with `maxOutputLength`): the block index must
  start at frame 0 and ascend, its lengths fill the data exactly, frames × channels ≤
  maxDataBytes before anything is inflated, and each block inflate to exactly its frames, so a
  decompression bomb is refused. Empty index entries may only pad its end (FPP preallocates).
  `analyzeFrames(parsed, scene, regions)` (the core's `prepareScene(rig)`, `flashRegions(scene)`; frames.ts imports
  only types, so the Fleet box runs a copy) → `{ frames, seconds, fps, peakBrightness, meanBrightness,
  darkFraction, estPeakAmps (20 mA/channel at 5 V), coverage, flicker: { maxHz, flaggedSeconds,
  regions, ok, small: { maxHz, flaggedSeconds, regions } } }`. Flicker: WCAG 2.3.1 general flash
  (≥ 10 % luminance swings, darker side < 0.8, > 3 flashes in any 1 s) on the mean of the whole
  rig and of each top-level group (`flashRegions`). Only large regions fail `ok`: the whole, a group with
  ≥ 10 % of the LEDs, or one covering ≥ 10 % of the lit area seen from the front or the side (grid
  cells 1/32 of the bounds' diagonal; `largeRegions`). Flashing on small regions alone (on the real
  map: spirelets, wash) goes to `small`, a warning.
- **Stored.** `<STUDIO_DATA>/frames/<lookId>.fseq` and `look.bake = { source, status:
  queued|running|done|failed, ok, reason?, warning?, checkedAt, layersHash, renderKey?, analysis?, frames?: {
  bytes, sha256 }, boxStats? }`. `ok` is false when the frames are missing, malformed or flash over a
  large area; `warning` says when only small regions flash. `layersHash` = SHA-256 of `renderFields(look)`.
  Bakes are deterministic: `renderKey` = SHA-256 over `renderFields(look)`, the seconds baked and a digest of
  the box's inputs (render.ts, renderer.ts, the core's modules, fseq.ts, rig.json, the library, the
  Node version). A bake request whose key a done render-box bake with stored frames has takes that bake,
  its frames hard-linked, instead of baking.
- **Disk cap.** `STUDIO_FRAMES_MAX_BYTES` (default 2 GB) bounds `frames/`: past it, the bakes used least
  recently (their `.fseq` files and hash folder; use = streamed, downloaded or baked, kept in the
  `.fseq`'s mtime) are evicted, never a reviewed look's, a fleet-box bake's or one being encoded. The
  record stays; asking for the frames bakes them again (`bakes.restore`), keeping the record when the
  bytes come out the same.
  Beside them, by content hash (`hash` = 32 hex of SHA-256 over the wire version, chunk size and
  `frames.sha256`): `frames/<hash>/<n>.br`, `manifest.json` (written last), `<n>.gz` and
  `frames.<zstd|zlib>.fseq` (both made on first request). Looks with the same frames share a
  folder; folders no bake names are pruned.
- **Wire** (`src/frames-wire.ts` encodes, `public/js/frames-stream.ts` decodes). Chunks of 80
  frames, each decodable alone: one layout byte (0 frame-major, 1 frame-major deltas, 2 planar
  i.e. channel-major, 3 planar deltas; deltas are byte-wise mod 256 from the previous frame, the
  chunk's first frame against zeros), then the frames. Brotli picks the smallest layout per chunk
  (probed at quality 5) and compresses it at `STUDIO_FRAMES_BROTLI_QUALITY` (default 9; 11 is about 12 %
  smaller for about 13× the CPU: `tools/frames-bench.ts`), once, after a bake (or on first request for
  older bakes; the wire then says 202). Encoding, the gzip copies and compressed downloads run in one
  worker thread at nice 10, one job at a time (`src/frames-worker.ts`). The gzip copy, for clients that do
  not take br (browsers send br only over HTTPS), picks its own layout, so it has its own ETag.
  Manifest: `{ version: 1, hash, frames, fps, channels, ranges, chunkFrames, chunks: [{ bytes }],
  bytes }` (brotli sizes). Manifest and chunks are served `Cache-Control: public,
  max-age=31536000, immutable`, chunks with `Content-Encoding: br` (else gzip, else none) and
  `Vary: Accept-Encoding`.
- **Playback** (`public/js/frames-stream.ts`): manifest, then chunk 0, then play; two chunks
  ahead are fetched, a seek fetches its chunk, deltas are undone in place once per chunk, and
  frames are read without allocating. On a phone, a cellular link, Save-Data or below 4G the
  first press of Play only shows the download size; the second plays.
- **Downloads.** `?compress=1` (zstd when this Node has `zlib.zstdCompress`, else zlib), `zstd` or
  `zlib`: FSEQ v2 with 80-frame blocks (zstd level 19, zlib 9), as FPP's FSEQFile writes them;
  plain (no `compress`) is the stored file, gzip transfer-encoded.
