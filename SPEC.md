# Folly Studio — build contract

The shared contract for everyone building Folly Studio. Code may refine details, but the
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
- **Every LED comes from `public/data/rig.json`** (SPEC "Rig"), built from the lighting repo's pixel maps, never
  by hand. Nothing else names the installation.
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
folly-studio/
  SPEC.md (+ SPEC-library, -generators, -live .md)  README.md  DESIGN.md  IDEAS.md  package.json (+ lock)  tsconfig.json  vite.config.js  server.ts
  src/            server (Fastify): app.ts (createServer) api.ts api-looks.ts api-models.ts http.ts (plumbing) auth.ts
                  store.ts store-lock.ts access.ts (invites, limits) api-access.ts
                  static.ts (serves dist/: headers, precompressed copies, ETags)  core-script.ts (the core for the boxes)
                  generate/{index,models,sketch,claude,codex,proc,fleet,prompt}.ts
                  frames.ts (pure: FSEQ parse + analysis)  bake.ts (bake queue, frame files)
                  render-box.ts (bubblewrap runner)  box-output.ts (what a box hands back, as data)
                  frames-wire.ts (stream encoder)  frames-cache.ts (chunks, downloads, encoder jobs, disk cap)
                  frames-http.ts (frames routes)  fseq-codec.ts (FSEQ zstd/zlib blocks)
                  frames-worker.ts (low-priority encoding)
  shared/schemas/ zod: look.ts (what the API stores) generated.ts (a generator's look, its JSON Schema) api.ts (bodies,
                  users, ideas) rig.ts (the rig, the library index) models.ts (the model registry) access.ts (invites, limits); the server's at
                  run time, the browser's as types
  shared/plays.ts what plays (PLAYS), the server's and the browser's at run time
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
      pattern-core.ts     pure: stdlib, compile, scene prep, renderFrame, toChannels, the flash check, re-exported from
                          core/{stdlib,compile,scene,timeline,render,output,light,spatial,globals,flash}.ts (sandbox, boxes,
                          Node tests)
      sandbox-relay.ts    the sandbox page's script: relay + watchdog
      sandbox-worker.ts   the sandbox's Worker: runs a look's layers on the core
      fseq.ts             pure: FSEQ v2 writer (browser + Node tests)
      frames-stream.ts    streamed playback of baked frames, and its pure decoder (manifest, chunks)
      runtime.ts          app side: owns the sandbox iframe, speaks the protocol below, adapts the frame rate
      viewer.ts           the 3D view: orbit camera (pointer and keys: viewer-input.ts); draws Points (viewer-gl.ts)
                          or Playa (playa/)
      playa/              the Playa view, loaded on first use: geometry.ts (from render hints), renderer.ts, glsl.ts
      main.tsx  api.ts    the UI's entry and its API client; ui/*.tsx: Preact components, signals for state
    patterns/             built-in library: <name>.js + index.json (sources, warps, filters; presets in the index)
    data/rig.json         the installation (SPEC "Rig"); City of Gods by tools/build_rig.py (committed)
    data/palettes.json    built by tools/build_palettes.py from tools/data/palettes/*.csv (committed)
    data/venue.json       props round the rig for the 3D view, never LEDs (SPEC "The 3D view"; hand-written)
  test/                   Vitest suites: `npm test` (= `vitest run`, vitest.config.js); e2e/: Playwright Test
                          browser checks (`npm run smoke`, `perf`, `e2e`; playwright.config.js)
  dist/                   `npm run build`: index.html, assets/<name>-<hash>.<ext>, .vite/manifest.json (not committed)
```

## Rig (`public/data/rig.json`)

The one installation-specific file: every LED, how it is addressed and grouped, and how the 3D view draws it.
The core, the boxes, the frame analysis, the generators and the viewer read only this. City of Gods' is
built by `tools/build_rig.py [--check]` from lighting's `city-of-gods/pixel-map/out/`, the Folly's playa build
(`rig-folly.json`) from its `show-builder/pixel-map/` (`LIGHTING_DIR`; never by hand; fixtures and groups: DESIGN
§9), on lighting's xLights and Falcon channels (`tools/check_channels.py`);
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

## The 3D view

`new Viewer(canvas, { views, defaultView, onError })`; `setRig(rig)` maps the rig's axes onto the view frame (x
front → back, y up, z left → right) for positions, bounds and views; `setColors(rgb)` takes each frame as the
sandbox or the baked frames give it (count × 3, 0..1); `setLight(light)` (the light settings); `setHighlight(mask)`,
`setView(name)`, `setOption(key, v)` (`ghost`, `gain` from the flash guard or the Live master, `insetTop`),
`setClear(rect)` (the part of the canvas a dialog leaves clear,
CSS px: views centre there by a lens shift and Fit fills it; the first rect eases to Fit, null eases back to the view
from before unless the camera moved meanwhile). It draws only when something changed. Two modes,
`setMode('playa' | 'points')` (resolves to the mode shown; the Studio remembers it in `studio.render`, default
Playa; the view's LEDs button is Points):

Both modes show light, through one preview transform (`previewChannels`, core/light.ts), applied once before either
draws: each value's light on the LEDs (`v^gamma`, unquantised; off where the LEDs round to off; the `floor`) × the
`gain` × a highlight's dim outside it, all linear as the Pi's master is, × `exposure` (where full drive sits on the
screen: 0.85, Playa's shoulder, by default). Balance and trims are left out: they make the LEDs match the swatches.
The views encode light to sRGB for the screen with one encode; an unlit LED's faint ghost never shows under a lit one.

- **Points** (LEDs): every LED a glowing sprite over a ground grid, the sprite's peak its light, overlapping sprites
  the brighter of them (a max blend), not their sum. The light fallback.
- **Playa**: Mirage's night playa, from the rig's render hints alone: `strip` a camera-facing ribbon per pixel
  (stepping pixel to pixel, as solid as fabric), `bulbs` globes on a wire, `points` sprites, `cells` lit glass,
  `flood` a soft beam or a lit shell; `structure.lines` a scaffold of one dim grey, unlit; a ground plane, sky and
  horizon. Each frame's light goes into one RGBA16F texture (no allocation) that the geometry samples by pixel index;
  spill lights (pixels clustered once, summed each frame) light the playa; HDR, `bloom` (light over 0.5
  glows, × the setting; 0 is off), then a tone map on the peak only, so saturated colours stay saturated: linear
  to .85, then a shoulder. A fixture's brightest pixel shows its light, so at the default exposure the LEDs stay
  linear, as they are. It needs float render targets, else the view stays on Points.
  `setQuality('auto' | 'full' | 'lite' | 'low')`: full (pixel ratio ≤ 2, half-res bloom, 16 spill lights), lite
  (≤ 1, quarter-res bloom, 6, tubes without the neighbour blend), low (≤ 1, no bloom, 4). Auto starts at full,
  lite on a touch screen, and steps down while the median of 24 frames takes over 30 ms.

**Venue** (`data/venue.json`, `setVenue(venue)`, `showVenue(on)`): scenery round the rig, drawn in both modes, dim,
unlit (a shade per face) and hazed with distance, so the LEDs stay the star. Never LEDs: no channels, no pixels, groups
or tags; the core, bakes, exports, fseq and the Pi never read it. It shows only when its `rig` is the rig's `name`.
Metres in the rig's axes and origin: `boxes` (`min`, `max`, linear `color`; `faces`, a subset of `front`, `back`,
`left`, `right`, `top`, `bottom`, draws only those, so a wall is one plane facing the courtyard that a camera outside
sees through; `windows`: a `bay` × `storey` grid of `size` windows from `from` metres up, `rows` high, a `lit`
share warm-lit; `ground`: in the Playa view it tints the lit playa, added, rather than hiding the LEDs' light on
it), `rails` (`from`, `to` along the foot, `height`, a post every `posts` metres) and `scaffold` bays (`min`, `max`,
`faces` as a box's: a standard where two meet, a ledger along each at every height in `levels`, a brace across each
lift; a face shared with the rig's own scaffold left out). The Studio's Venue
button shows or hides it (default on, kept per browser).

## Light and output

How a colour value becomes light (docs/LIGHT.md has the why and every number):

- **The engine works in encoded values**, 0..1, the swatches' own sRGB numbers. Every dim, opacity, level, Amount
  and fade scales those, so a slider is perceptual: 0.5 looks about half, and is 22 % of the light. Only `add` and
  blur work in light, at a fixed `v^2.2` (not the Light gamma), and colour fades in OKLab, from that light.
- **The LEDs give linear light.** One output transform turns a value into an output byte, in float, then rounds:
  `byte = round(255 · min(1, v^gamma · balance[colour] · trim[LED] · cap))`, then a lit channel never below `floor`.
  The Falcon's own gamma is None, so this is the only curve. Export's .fseq and the Pi use it; bakes and the preview
  keep the encoded values (`toChannels`), and the bake checks decode those bytes through the same curve (`ledLight`).
- **Caps are linear and come after the curve**: the Pi's master, blackout and fade, Export's Brightness and each
  group's `trim` scale light, as WLED's and FPP's brightness do, so dimming never shifts a colour's hue. The Falcon's
  port brightness (80 %, the rose's 70 %) is the electrical backstop, set on the controller and never repeated here.
- **The checks judge the look at full output**: `gamma`, `balance` and `floor`, never the caps.

The light settings, `shared/schemas/light.ts`, are stored once: `<STUDIO_DATA>/light.json`, written by the Light page
(Admin) and read by Export, the bake checks and the previews; the Pi reads the same shape from `pi/light.json`
(the Light page's "Download for the Pi"). Missing, unreadable or out of range, each field is its default:

```
{ gamma: 2.2,              // 1..3: light = v^gamma
  balance: [1, 1, 1],      // 0..1 each: a colour's light trimmed down, to even out the whites
  floor: 0,                // 0..16: the least byte a lit channel sends (v ≥ 0.5/255); 0 lets the curve round to off
  trims: [],               // ≤ 32 of { tag, level 0..1 }: a group's light × level, by the rig's group tags
  controller: [{ ports, brightness, gamma }],    // ≤ 16: the controller's own settings, recorded, never applied
  preview: { exposure: 0.85, // 0.1..2: the screen light of full drive (above 0.85 Playa compresses; Points clips at 1)
    bloom: 0.4,              // 0..1: Playa's glow round bright light; 0 is off
    highlight: 0.22,         // 0..1: the light left outside a hover highlight
    focus: 0.05 } }          // 0..1: the light left outside a layer's groups while picking them
```

## Pattern code and the library

In `SPEC-library.md`, part of this contract: **Pattern code** (what people and the AI write), **The pixel `p`**,
**Stdlib**, **Directions**, **Modules** (a layer is a chain; the warp contract), **Library**, **Spatial modules**,
**History**, **Globals**, **Param bindings**, **Integrated clocks** and **Palettes**. `SPEC "<one of those>"` means
that file.

## Looks (what gets saved)

A look is a stack of layers, composited bottom to top like xLights rows reversed (index 0 is the
bottom). The rules below are `shared/schemas/look.ts`; its types (`Layer`, `Module`, `Globals`, …) are the
browser's too:

```jsonc
{ "title": "Coral reef", "summary": "…", "duration": 30, "bpm": 120, "chain": 2, "layers": [
  { "id": "l1", "title": "Sea", "groups": ["cathedral"], "tags": ["all"], "blend": "add" | "over" | "max" | "multiply",
    "level": 1, "clips": [{ "start": 0, "end": 12, "fadeIn": 2, "fadeOut": 3 }], "soften": { "radius": 0.15, "mode": "wire" },
    "modules": [
      { "id": "m1", "kind": "source", "title": "Chase", "ref": "single-strand", "code": "…",
        "params": { "speed": 40, "colours": { "pick": "body/accent", "rotate": 0.25 } } },
      { "id": "m2", "kind": "source", "title": "Clouds", "ref": "clouds", "code": "…", "params": {}, "as": "input" },
      { "id": "m3", "kind": "filter", "title": "Mask", "ref": "mask", "code": "…", "input": "m2",
        "params": { "amount": { "mod": "global", "name": "storm", "from": 0, "to": 1 } } },
      { "id": "m4", "kind": "warp", "title": "Twist", "ref": "twist", "code": "…", "params": {} }
    ] }
],
  "globals": {
    "palette": { "name": "carnival", "low": ["#6700cb"], "body": ["#ee008e"], "accent": [], "high": ["#f9e9cf"] },
    "macros": { "storm": { "value": 0.2, "min": 0, "max": 1 } } },
  "automation": { "storm": [[0, 0], [30, 1]] } }
```

`groups` is an array of the rig's group ids (union). Missing, the layer plays on the rig's root; `[]` (with no tags)
is a valid pick that lights nothing. In the Studio a layer's groups are picked in its Groups drawer (`ui/groups-drawer.tsx`,
opened from "Plays on" in its settings; a drawer as Modulate's): a tree that ticks a group with every group under it and
stores the outermost ticked ones; a parent with some of its subgroups ticked shows partly ticked, and one with all of
them ticked is ticked itself. While it is open the 3D view shows where the layer plays (and the group pointed at) as it
is, and every other LED at a fixed 2 %, the unlit rig still faint. Add a layer picks the new layer's groups the same
way, in the same tree beside its list (on a phone, behind its "Plays on" button): it starts on the rig's root, the
audition plays on the groups ticked, the view focuses them, and the layer (each of a preset's layers) is added on
them; closing the picker forgets them. `tags` (optional, ≤ 16 of
`[a-z0-9-]{1,32}`) make a layer portable: when it names no groups, or one this rig lacks, the layer takes its
known ids plus every group carrying one of its tags (a rig without them lights nothing there); where all its
ids are known, tags change nothing. An unknown id in a layer without tags is an error. Generators set both; editing a
layer's groups by hand clears its tags. Blend: `add` sums light (default: 50 % and 50 % make
68 %), `over` replaces where the layer has alpha × level, `max` keeps the brighter channel, `multiply` tints what is
below.

- **Modules**: 1–8 per layer, ids unique in it (`[A-Za-z0-9_.:-]{1,64}`), `code` ≤ 20 kB each and always
  stored (looks stay self-contained for the boxes); `ref` names the library entry it came from, and a module whose `ref` the library has is standard: it keeps the
  library's title (`shared/standard-modules.ts`; the API and generators put a renamed one's back), and a hand edit
  of its code drops `ref`, making it custom; `params`
  override the code's defaults (≤ 64; a string ≤ 256 characters: a pick, a choice or text); `enabled: false` skips it; `input` names an earlier source; `as` is only
  `'input'`; `blend` as for layers, or `under` (a source's only). A layer with `code` (+ `params`) and no `modules`
  is a one-source chain and renders exactly as before.
- **chain**: `2`, the one rule (SPEC-library "Modules"). Before it a warp bent the modules after it, on through blurs and
  trails. A look without `chain: 2` (saved before, or a body to `POST`/`PUT` without it) is converted once on its way
  in (`shared/chain-order.ts`), exactly wherever it can be: warps leading a stage move to its end, reversed; a stage
  after a stage end gets copies of the warps it read; two sources bent differently turn over (the first goes
  `under`, or adds or maxes as the second did); otherwise a warp stop (a blur of radius 0, `ref: 'blur'`) splits the
  stage. Where it cannot (more than 8 modules, or trails reading a pixel a warp changed), each warp moves to the end of
  its stage and the summary says which layers changed. Trails saved before it declared its stage (`ref: 'trails'`)
  gets `const stage = 'history'`. Stored looks are converted at start (their versions too); a bake of an exact
  conversion keeps its place.
- **Soften** (optional): `{ radius: 0–1.5 m, mode: 'wire' | 'space' | 'both' (default 'wire') }`, a blur at the end
  of the chain (SPEC-library "Spatial modules"); radius 0 is none. New layers in the Studio and generated layers get
  `DEFAULT_SOFTEN`; a layer without it renders as before.
- **Colours** (SPEC-library "Palettes"): a colour param's value is a pick string (≤ 200 characters, not checked: a bad one plays
  the default, as a bad hex always did), `[r, g, b]`, or `{ pick, blend?, range?, rotate? }` (checked: tokens, `step`
  or `smooth`, two numbers 0..1, a number 0..1 or a binding). A layer's `palette`, a role remap from before one
  colour param per source, is dropped on the way in and from stored looks at start (`dropRemaps`).
- **Globals** (all optional): `palette` as role lists (≤ 16 `#rrggbb` each; a bare name from
  `data/palettes.json` is filled in on save; default `chapel`); `macros` ≤ 16, names
  `[a-z][A-Za-z0-9_]{0,31}` but `palette` and `bpm`, `{ value, min = 0, max = 1, mod? }`. Old looks' `speed`,
  `level`, `hue`, `saturation` (lanes, live names) are ignored; their `energy` is read as a macro `energy`
  (its value, else 0.5) where stored, automated or followed (`upgradeGlobals`, on read; never rewritten). A macro with a `mod` (an LFO
  or, in older looks, a tempo binding, SPEC-library "Param bindings"; never the envelope) is a **modulator**: it moves by itself each
  frame, `value` its value when the mod is lifted, and params bound to it (`{ mod: 'global', name }`) follow it in
  step. Each frame a lane wins over the mod, the mod over the value. One level only: a modulator follows faders
  (macros without a mod): a global binding, or an LFO's `amount` or `pace`, naming a modulator is
  refused by the schema and dropped by the core.
  `live`: the names a live engine (the Pi, SPEC-pi) offers as controls: the look's macros and `bpm`,
  each once; absent, it offers the macros without a mod. A modulator it lists is released from its mod
  while a control holds it. Nothing else reads it.
- **Automation**: `{ <macro>: [[t, v], …] }`, ≤ 16 lanes of ≤ 256 points, t 0–600 s ascending (to
  the ms); linear between points, held before the first and after the last; it replaces the static value.
- **What plays** (`PLAYS`), versions and History: `SPEC-history.md`, part of this contract.
- `data/palettes.json` (`tools/build_palettes.py [--check]`, from `tools/data/palettes/*.csv` and
  `tools/data/palettes/themes.txt`; sRGB swatches grouped by role):
  `{ version: 1, roles: [low, body, accent, high], palettes: [{ name, theme, low, body, accent, high }] }`. A look
  stores a palette's colours, not its theme.

### Timeline

Sequencing lives on the look, xLights-style.

- `look.duration`: seconds the look runs, then loops; 1–600, default 30 (absent = 30).
- `look.bpm`: optional, 40–240; the editor's beat grid, the tempo of LFOs in `beats`, and `G.bpm`. A bake's key
  holds it when a binding counts beats or a module's code reads `G.bpm`.
  Beats count from the look's downbeat `beat0` (a PreparedLook field, 0: show time 0), which only a live engine
  moves (tap tempo); `beat()` and LFOs in `beats` read it, so bakes are unchanged.
- `layer.clips`: optional `[{ start, end, fadeIn = 0, fadeOut = 0, transition? }]` in seconds (0–600, kept to
  the millisecond), ≤ 32 per layer, sorted, not overlapping (touching is fine). No or empty
  clips: the layer is always on (looks from before the timeline are unchanged).
- A clip only scales the layer's level by its envelope: 0 outside `[start, end)`, ramping
  linearly 0 → 1 over `fadeIn` and 1 → 0 over `fadeOut` (when the fades add up to more than
  the clip, both shrink in proportion). Where the envelope is 0 the layer does not run at all
  (no `frame()`, no `pixel()`). Pattern `t` stays show time, so motion is continuous across cuts.
- A clip's `transition` (`{ kind: 'fade' | 'wipe', direction = 'right', softness = 0.1 }`, default fade) is how its
  fades show. `fade` scales the level, as above; `wipe` keeps the level and lights the layer's pixels across
  `direction` (a library direction, read as `toward`) as the envelope rises, behind an edge `softness` wide, and
  on the way out carries on across, so the layer leaves from the side it came in. `transitionWeight(kind, direction,
  e, p, out?, softness?)` (`core/timeline.ts`, pure) is a pixel's share at envelope `e`; the live stage uses it too.
- Sequencing whole looks = importing another look's layers into this one, then placing clips.
- Preview loops over `duration`; bakes and `.fseq` exports render `duration` from t = 0.
- The Studio edits it in a Timeline panel (`ui/timeline*.tsx`): docked under the 3D view beside
  Code on a wide screen (drag, trim, fade, zoom, snap to ¼ s or beats), a Time tab on a phone
  (the selected clip's numbers). The editor's edits (`ui/timeline-model.ts`, pure) keep every
  rule above, so what it saves the API accepts. Under the layers, a lane per modulator (`ui/timeline-mods.tsx`): its
  value over the show (0..1 of its range, as it plays: pace, swing and lanes in), its name and what it drives in the
  lane's head, which opens it on the Look panel; the group folds to its head (kept per browser). Under those, a lane per
  automated macro: choose a macro in the Automate picker to create its lane. New automation… makes a new macro
  named `automation` (then `automation2`, …), range 0..1, initially 0.5, and its lane. A setting's ∿ drawer also
  offers Automate: one edit creates a macro named from its layer and setting, with the setting's range and value,
  binds the setting to it, creates its lane, and opens the timeline. A colour setting automates its rotate, 0..1.
  An already automated setting or macro opens its existing lane; each lane starts flat at 0 and the look's end.
  Click to add a point, drag to move it, double-click to remove it. Points are hollow amber at 0%, half-filled
  violet between the endpoints and filled mint at 100%. Segments blend between amber, violet and mint over the range.
  The bottom
  dock (Code, Timeline, Look) is one height on every tab: a share of the Studio's height (36%, at least 220 px, the
  3D view keeping at least 200 px), dragged by the splitter above it and kept per browser.
- Reorder: a layer row moves by its ↑ ↓ buttons, a module row by Alt+↑/↓ on its controls, either by dragging its
  grip (`ui/drag-order.ts`, any pointer), which marks where it lands, the drop one edit; Escape cancels.
- Composition (`ui/chain.tsx`, `ui/params.tsx`, `ui/shelf.tsx`, `ui/look-globals.tsx`): the selected layer's
  module chain (a line a module: kind badge, Custom on a module not standard, name, a source's blend or a filter's
  input, enable, delete; only a custom module's name is editable; wide, the selected one's settings open under it,
  a click on it closing or opening them, ▾ ▸), its Soften row (radius and mode; new layers
  start at `DEFAULT_SOFTEN`), the pickers (Add a module: tabs Sources, Warps, Filters; Add a layer: Blank, a blank
  layer or one source, and Presets, beside the groups the new layer plays on; one-line rows by category with a filter,
  the tab remembered for the session, each row auditioned in the 3D view), the code editor and
  params on the selected module (each number param can be modulated), and a Look panel of globals, the palette
  (its theme line under the menu; each swatch titled by its slot, `body2 · #fd7f40`), its modulators and its faders
  (macros without a mod; `ui/look-mods.tsx`). A modulator is a card: its name to rename, how it moves, its value now,
  ∿ to edit it, × to delete it, and a chip for each param it drives (layer › param), which selects that layer and
  module and opens the param's ∿; a fader's row lists what it drives, paces or swings the same way. Modulating is in
  place (`ui/modulate.tsx`, `ui/mod-live.tsx`): ∿ opens a drawer (`ui/drawer.tsx`), a panel the Studio's full
  height between the 3D view and the side, which shrinks the view beside it and fits a 1366×768 screen unscrolled
  (a sheet on a phone); one drawer shows at a time, one opened from inside another stacks over it, Escape or ×
  closes it. Kinds LFO (its wave over two cycles in the param's range with the playhead, shape, rate in beats a
  cycle with pills from ¼ beat to 4 bars or, its beat clock off, in Hz, Rate × and Swing × a fader, From/To; a new
  one swings a quarter of the range round the field's value), Macro (the look's modulators with their value now, its
  faders, its globals; at its lowest and at its highest), Off. A binding to the clip envelope, or a modulator's
  tempo pulse, from an older look shows as old with Off; neither is offered. A speed (a param named for one or for a spin, or a
  rate a minute) has a beat clock beside its number: on, it reads per beat and stores `{ mod: 'beats', per }`
  (keeping its value at the look's bpm); off, a plain number a second. Each change applies as it is made; Revert
  puts back what was there when it opened.
  "Share this LFO as a modulator…" makes the LFO a new modulator, named from where the layer plays and the param
  (`roseSpeed`), and binds the param to it. With a modulator picked, the drawer renames it and its own ∿ (LFO,
  Macro: following a fader, Off) sets how it moves, for every param that follows it. A bound row shows a live
  chip: what moves it, its range, its value now and a bar. Renaming a macro carries its lane, its bindings, a
  colour's rotate and the modulators that follow it; deleting it
  drops them. On a phone: globals and palette in the Look tab;
  the chain read-only but for enable and params.
- Phones (≤ 899 px wide; `ui/phone/`, `css/phone.css`): the 3D view over one panel, switched by the tabs Layers,
  Time, Groups, Look and More. Layers lists one row a layer (name, mute, status); tapping one opens its settings in
  the same panel (‹ Layers back, its name, mute and solo, plays on, the chain, the params). The light view hides
  blend, level, solo and moving up or down on the rows, the layer and module names and Soften in the settings, the
  automation lanes and the 3D view's style buttons; More holds the code editor, the 3D view's Show unlit, LEDs
  and quality, and Full detail, which shows them all again (kept per browser). On a phone the preview starts without
  Show unlit, the Playa view drops the scaffold lines, and Points draws at a pixel ratio of 1.
- Colours (`ui/picks.tsx`, `ui/pick-model.ts`; SPEC-library "Palettes"): a colour param is one row like a number's: its pick in
  a field the size of a number's (`kit.tsx` Scrub), its text over the colours it plays (the field opens the pick
  tile), ∿ to move its rotate (the same popover), ↺. The tile is TD's pick: a row per role (a box for the whole
  role, a cell per slot), a custom row (its colours, each a cell whose × removes it; below 4, a swatch that opens
  the browser's chooser and + to add the colour it shows, in place of the whole palette or rainbow as a slot is),
  the whole palette, rainbow, then whether roles alternate (`/`), blend, and range and rotate as number fields. On a
  phone the tile is a sheet with the palette's roles and the custom row; the whole palette, rainbow,
  blend, range and rotate show when set.

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
| `{ type: 'look', layers, globals?, automation?, bpm?, clock? }` (as saved; `clock: 'fresh'`: the clock not continued from the look before, SPEC-live) | `{ type: 'compiled', layers: [{ id, ok, error?, params, modules: [{ id, ok, error?, params, upgraded? }] }] }` (`params`: the first source's schema; `upgraded`: each param a module's `upgrade()` changes, `[saved, upgraded]`, SPEC-library) |
| `{ type: 'frame', seq, t, set? }` | `{ type: 'frame', seq, rgb: Float32Array(count×3), errors: [{ id, module?, error }], ms, layerMs: { <layer id>: ms } }` (rgb transferred; `ms` the frame's, `layerMs` each layer's, timed in the worker) |
| `{ type: 'render', seq, start, frames, fps, brightness, light }` (light: the settings, Light and output; brightness: a linear cap) | `{ type: 'progress', seq, done }` … then `{ type: 'rendered', seq, channels: Uint8Array(frames × frame channels) }` |

Compute is decoupled from drawing: the app keeps one `frame` request in flight and asks at 40 fps, stepping down to
30 and then 20 while the worker's `ms` (smoothed) is over budget, 80 % of the frame interval, and back up once it is
well under the faster rate's; the 3D view draws at display rate when something changed, and idles otherwise. A layer
whose smoothed `layerMs` is over 40 % of a 40 fps frame's budget (8 ms) is marked heavy on its card.
A layer that throws or returns NaN goes black for that frame and is reported in `errors`. Live frames keep
the look's clock continuous across a new look (`prepareLook(look, previous)`); renders start it afresh, as bakes do.
A frame's `set: { values, bpm, beat0, offset, paces? }` is set in place on the prepared look first, as a live engine sets its
own (`js/live-set.ts`; SPEC-live "Following /pi"): globals and macros by name, the tempo, the downbeat, the clock, and `paces` (each pace fader's phase offset, so a
modulator's LFO stays where the Pi has it).
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
SPEC-library "Palettes"), `readPick(value) → { groups, blend, range, rotate } | null` and `pickText(groups)` (a pick read leniently,
and as text), `readText(value) → string | null` (a text param's value: printable ASCII, at most `TEXT_MAX`, 256,
characters), `layerModules(layer) → modules`
(a legacy layer → one source), `compileLayer(layer) → compiled[]` (throws `title: error`), `setLibrary([{ name,
code }])`, `prepareScene(rig) → scene` (throws on a malformed rig), `groupsByTag(scene, tag) → [group]` (outermost
first), `pixelsForGroups(scene, ids, tags?) → Int32Array` (a layer's rule above), `tagMask(scene, tag) → Uint8Array`,
`tagCentres(scene, tag) → [[X, Y, Z]]`, `FLASH` (the default limits), `flashLimits(partial?) → limits` and
`new FlashWatch(scene, limits?, { record? })` (Baked frames, Checks), `prepareLayer(scene, layer, compiled | compiled[])
→ prepared`
(keeps `normalizeClips(layer.clips)`; a chain with spatial modules or `soften` gets its stage buffers here),
`neighbourGraph(scene) → { space, wire }` (each CSR: pixel k's neighbours `nb[off[k]]…nb[off[k + 1] − 1]` at
distances `d`, nearest first; Int32Array, Int32Array, Float32Array; cached on the scene), `MAX_RADIUS` (1.5),
`BLUR_MODES`, `DEFAULT_SOFTEN`, `prepareLook({ globals, automation, bpm }, previous?) → look`,
`renderFrame(scene, preparedLayers, t, out?, look?) → { rgb, errors }` (level × `layerEnvelope`, or a wipe's
`transitionWeight` per pixel; skips layers at 0; allocation-free per layer; sets each prepared layer's `ms`, its time this frame), `normalizeGlobals(globals)`, `automationAt(points, t)`, `PALETTE_ROLES`,
`DEFAULT_PALETTE`, `MODULE_KINDS`, `OLD_GLOBALS`, `upgradeGlobals(look)`,
`toChannels(scene, rgb, out?) → Uint8Array(frame channels)` (in the rig's colour order, the colours as previewed:
bakes and Live), the output transform (Light and output; `core/light.ts`, the only module that reads the settings'
fields): `LIGHT` (the defaults), `lightOf(settings)` (bounded, defaults where missing), `prepareLight(scene, light?)`,
`lightByte(v, light) → 0..255` (the curve alone, white, for showing it), `ledChannels(scene, rgb, prepared, out?, cap = 1) →
Uint8Array(frame channels)` (the Export dialog's .fseq and the Pi's output) and `ledLight(light?) → Float32Array(768)`
(each encoded byte's light per colour, 0..1, as the LEDs give it at full output), and for the
timeline `layerEnvelope(clips, t) → 0..1`, `normalizeClips(clips) → clips | null` (lenient: drops
bad and overlapping clips), `transitionWeight(…)` and `TRANSITIONS` (above), `lookDuration(look) → seconds`, `DEFAULT_DURATION` `MIN_DURATION`
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
Nothing is inlined (no data: URLs, no inline script; the modulepreload polyfill is off). Beside each text file of 512 bytes or more the build writes `<file>.br` (quality 11) and `<file>.gz` (9) where smaller
(`tools/vite-compress.ts`), so nothing static is compressed per request.

`src/static.ts` (@fastify/static) serves `dist/` under the app CSP (`CSP_APP`): files under `assets/` with
`Cache-Control: public, max-age=31536000, immutable`, the sandbox page with `CSP_SANDBOX`; the shell (`index.html`, for
every SPA route) `no-cache`; anything else 5 minutes. Text goes br or gzip from those copies as the request accepts
(`Vary: Accept-Encoding`); every file has an ETag (each encoding its own) and Last-Modified. Dotfiles (`.vite/`) are
never served, and other methods are 405. Without a build, every static path is a 404 (the log says to build).

### Updates

A hosted build has `/build.json` (`{ commit, builtAt }`, written by `npm run host`). An open page asks for it at
start, on coming back to the tab and every 5 minutes (`public/js/ui/updates.ts`); when its commit changes, or a lazy
chunk fails to load (a deploy removed it), the page reloads onto the new build by itself if nothing is unsaved: no
Studio edits (the leave guard's dirty flag), no text field focused, and no text typed into a form's textarea. It does
so once per build (a sessionStorage marker naming the commit), so a build whose chunks really fail cannot loop; with
something unsaved, or once already, it shows one "Folly Studio was updated" toast with Reload instead.

## HTTP API (JSON; cookie session)

Mutating requests must be `Content-Type: application/json` and, when an `Origin` header is
present, same-origin. Errors are `{ error: "message" }` with a 4xx/5xx status. A body is a JSON object of at most
256 KB (413 past it; empty is `{}`), checked by the shared schemas (`shared/schemas/api.ts`, `look.ts`): a 400 names
the first problem ("Layer 2, clip 1: start must be a number of seconds from 0 to 600."). Unknown routes are 404, a
known path's other methods 405 with `Allow`.

```
POST   /api/signup   { username, password }   → { user, flash, profile }  (sets cookie)
POST   /api/login    { username, password }   → { user, flash, profile }
POST   /api/logout                            → { ok: true }
GET    /api/me                                → { user, flash, access, profile } | 401
PUT    /api/me/tour  tour                     → { tour }  SPEC-tutorial
GET    /api/ideas                             → { ideas: [idea] }    mine, newest first
POST   /api/ideas    { text, model?, explore? } → { idea }           queued for generation on that model (none: the
                                              default this user gets); 400 when it is unknown, off, not offered
                                              to their role, or cannot run here; 403 { error, access } when it is
                                              paid and the account is locked; 429 { error, access } + Retry-After
                                              at a limit (SPEC-access "Access"); `explore` quick | explore (default) |
                                              deep, kept on a prompted model's idea (SPEC-generators "Explore");
                                              400 for deep while it is off, 403 while it is admins' only
POST   /api/looks/:id/refine { text?, model?, critique?, fix?: { layer, error } } → 201 { idea }  owner only: a
                                              refinement of the saved look (SPEC-generators "Refine"); text 2–1000
                                              unless critique or fix; refused as POST /api/ideas is; 409 while
                                              one is pending on the look
GET    /api/ideas/:id[?wait=<status>@<updatedAt>] → { idea }         mine only; with wait, an idea still pending and
                                              as given is answered when it changes, or after 25 s
GET    /api/ideas/:id/how[/live|/stills/:n]   → { idea, from, run, prompt?, rounds } | image/png  mine or admins'
                                              (else 404): SPEC-generators "How it was made"
POST   /api/ideas/:id/undo                    → { idea }  mine only, a ready refinement: marks it `undone` (the
                                              Studio has put its look back), so later refinements' history skips it
GET    /api/models                            → { models: [{ id, label, paid }], default }  what this user may pick
GET    /api/admin/models                      → { file, config, models: [{ id, available, note, warn? }], efforts,
                                              problem? }  admins only (403): the registry and what can run here
PUT    /api/admin/models  config              → the same, after writing the registry file; admins only; 400 names
                                              the first problem
GET    /api/light                             → light  the light settings (Light and output), defaults where unset
PUT    /api/admin/light  light                → light, after writing <STUDIO_DATA>/light.json; admins only; 400 names
                                              the field
GET    /api/admin/ideas/:id/log               → { idea, calls, system, stills }  admins only (403): an idea's or
                                              refinement's log (SPEC-generators "The idea log"); 404 when none
GET    /api/admin/ideas/:id/log/stills/:name  → image/png  admins only; `name` as the log lists it (400 otherwise)
POST   /api/reports  report                   → 201 { id }  an F8 bug report (SPEC "Bug reports"): its own 3 MB
                                              body limit (413: send it again without the shot); 10 an hour per user
GET    /api/admin/reports                     → { reports: [summary] }  admins only (403), newest first
GET    /api/admin/reports/:id                 → { report }  admins only; 404 when none
GET    /api/admin/reports/:id/shot            → image/jpeg  admins only; 404 when it has none
GET    /api/looks?scope=mine|gallery          → { looks: [listed] }  metadata only: no layers
POST   /api/looks    { title, summary?, layers, duration?, bpm?, globals?, automation?, ideaId?, chain? } → { look }
GET    /api/looks/:id                         → { look }             mine, or shared
PUT    /api/looks/:id { title?, summary?, layers?, duration?, bpm?, globals?, automation?, shared?, reviewed?,
                     flashOverride?, chain?, restoredFrom?, versionName? } → { look }  owner only (reviewed: a
                                              curator); layers without chain: 2 converted
GET|PUT /api/looks/:id/versions[/:n]          the owner's versions: SPEC-history
DELETE /api/looks/:id                         → { ok: true }         owner only
POST   /api/looks/:id/bake                    → 202 { bake }      owner, or a curator if shared; queued
GET    /api/looks/:id/frames[?compress=1|zstd|zlib] → the baked .fseq   mine, or shared; 404 if none (attachment);
                                              503 + Retry-After while evicted frames are baked again
GET    /api/looks/:id/frames/wire             → 302 to its manifest; 202 { pending } + Retry-After while encoded
                                              (or baked again)
GET    /api/looks/:id/frames/:hash/manifest   → the stream manifest (immutable)        mine, or shared
GET    /api/looks/:id/frames/:hash/:n         → stream chunk n (immutable; br/gzip)  mine, or shared
GET    /api/looks/:id/preview/:key.webp       → the gallery preview (image/webp, immutable)  mine, or shared;
                                              `:key-still.webp` its still; 404 unless `key` is `listed.preview`
GET    /api/library                           → { patterns: [{ name, title, summary, tags, kind, category, code }] }
                                              (a preset: kind 'preset', its layers and globals?, code '')
```

API `GET`s answer `Cache-Control: private, no-cache` with an ETag (a reload or a poll revalidates to an
empty 304); other responses are `no-store`. JSON bodies of 1 KB or more are sent br (quality 5) or gzip
when the request accepts it, with `Vary: Accept-Encoding`; the ETag is the uncompressed body's. A list
holds `listed = { id, owner, ownerName, title, summary, duration, layerCount, shared, reviewed, bpm?, sharedAt?,
ideaId?, preview?, createdAt, updatedAt }` (`preview`: its gallery preview's key, when it has one); `GET /api/looks/:id`
has the rest.

`PUT reviewed: true` answers 409 with the reason unless the look has a passing render-box bake of
its current layers; large-area flashing in any bake blocks (flashing on small regions only
warns: `bake.warning`) unless the curator gives `flashOverride`, their reason (3–500 characters), with a render-box
bake that fails only the flash check: it is kept as `look.flashOverride = { reason, by, at }` (and logged), and
cleared with the review (400 without `reviewed: true`). Changing what plays (`PLAYS`; `null` clears `bpm`, `globals`
or `automation`) makes a version, and a change to the frames drops the bake and clears `reviewed` (SPEC-history).
Clips that overlap
or fall outside 0–600 s, and a duration outside 1–600 s, are refused with 400.

`user`, `access`, `invite` and `person`: SPEC-access.
`flash = { check, perSecond, delta, darker, area }`: the flash check's settings (Baked frames, Checks), for the
preview's guard; `check: false` (`STUDIO_FLASH_CHECK=off`) means nothing is dimmed or blocked.
`idea = { id, owner, text, status: 'queued'|'generating'|'ready'|'failed', model?, generator, by?, explore?, took?,
timing?, rounds?, how?, lookId?, refine?, changes?, verdict?, undone?, error?, createdAt, updatedAt }`: `status` goes queued → generating →
ready or failed, which are final (moves: `shared/idea-status.ts`); `model` the registry id asked for, `generator` the one that made
the look (the one-shot generator's when the foundry was off or busy), `by` its label ("Opus"), `timing = { wait, prompt, request, parse,
total, check?, critique?, sketch?, tokens? }` in ms (`tokens = { input, cached, output }`); `rounds = [{ kind, ms,
outcome? }]` its model's rounds and `how` how it was made (SPEC-generators "The idea log"); `explore` the level it was made at and `took` what its look took from
each sketch (SPEC-generators "Explore"). A refinement has `refine = { critique?, fix? }` and the look it changes as
`lookId` from the start; `changes` (ready) says what changed, `verdict` how its critique round ended (`revised`,
`unchanged`, …), and `undone: true` that it was undone.
`look = { id, owner, ownerName, title, summary, layers, duration, bpm?, shared, ideaId?, reviewed, reviewedBy?,
flashOverride?, bake?, chain, createdAt, updatedAt }`
(`bake`: see Baked frames).

## Bug reports

In `SPEC-reports.md`, part of this contract: F8 reports, what they hold, and where the server keeps them.

## Generators and models

In `SPEC-generators.md`, part of this contract: **Generators** (idea → look) and **Models** (the registry).

## Accounts and access

In `SPEC-access.md`, part of this contract: **Accounts** (roles, sign-in), **Admin** (its pages), **Access** (invite
codes and limits on the paid models) and their routes.

## The live stage

In `SPEC-live.md`, part of this contract: the shared `/live` stage, its socket (`/api/live/socket`), its state and
the `/live/control` page.

## Offline on the Pi, and the Pi preview

In `SPEC-offline.md`, part of this contract: the Pi profile (`STUDIO_PROFILE`, `profile`), `/pi` (a Studio Live
engine behind Studio) and look files; in `SPEC-liveplay.md`, the live play controller.

## Gallery previews

Each shared look gets a looping preview for its card (`src/previews/`): the Playa view from the Studio's default
camera ('fit'), with the venue, at full quality, 260 × 228 px (drawn at 2× and scaled down), sampled at ~13 fps, over the 5 s that move the most (mean change from one
sample to the next, plus a tenth of the mean brightness so a dark stretch loses), its last 0.5 s crossfaded into its
first so it loops; an animated WebP (sharp; quality 50, else 40 or 30 to stay within 300 KB), and a WebP still (the
window's brightest sample) for reduced motion. They are made off the request path, one look at a time, when a look
is shared or a shared look changes (and for every shared look at start, the gallery's top first): from the look's
bake when that is current (a look being baked waits for it), else from the render box (at most 60 s, in the bake
lane). Kept in `<STUDIO_DATA>/previews/<lookId>-<key>.webp` and `-<key>-still.webp`, `key` naming what it renders;
a look keeps its old preview until the new one is written, and previews of looks no longer shared go at the next
start. A look without one shows its card's glass.

The camera is the app's own Viewer (`public/js/preview-camera.ts`) in a headless Chromium (playwright-core's
headless shell, `src/previews/playa.ts`), started on first use and closed after a minute idle: no window, its own
profile, no port; it serves itself the viewer's source with the types stripped, so it needs no build. It asks for
the GPU (ANGLE on EGL, with no display; under WSL, Mesa's d3d12 driver when `/dev/dxg` is there) and logs the renderer it got,
as a warning when that is a software one. `STUDIO_PREVIEWS=front` draws them flat instead (the LEDs from the front:
z across, y up), without a browser; the tests and browser checks do.

## Baked frames

Frames are the deliverable; the server never runs look code itself, it only parses and measures
bytes a box hands back. Anything a box says about itself is kept as `boxStats: { untrusted: true }`.
In the Studio, Export → Check & bake… (the phone's Look tab: Check & bake) opens a dialog (`ui/bake.tsx`) that
bakes the saved look, shows the checks (flash, peak power, length), plays the baked frames and, for a curator,
marks the look reviewed.

- **Boxes.** `render-box` (authoritative, any look): `src/render-box.ts` runs `render-box/render.ts`
  under bubblewrap (`--unshare-all`, no network, `--clearenv`, read-only node + its libraries +
  the core as one script (`src/core-script.ts`, from its source) / renderer.ts / fseq.ts / rig.json /
  `public/patterns` (for `use`), tmpfs /tmp, one
  empty writable /out; the look on stdin as `{ layers, globals?, automation?, bpm? }`), a cgroup
  (tasks, memory), prlimit (CPU s, file size; no RLIMIT_AS) and a wall-clock kill. Inside, layers run in
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
  `analyzeFrames(parsed, scene, watch, light)` (the core's `prepareScene(rig)`, a recording `FlashWatch` and
  `ledLight(light)`, the light settings when it bakes; frames.ts imports only types, so the Fleet box runs a copy) → `{ frames, seconds, fps, peakBrightness,
  meanBrightness, darkFraction, estPeakAmps (20 mA/channel at 5 V), coverage, flicker: { maxHz, flaggedSeconds,
  regions, ok, small: { maxHz, flaggedSeconds, regions }, limits: { perSecond, delta, area } } }`. All of it is in
  the LEDs' light: each byte is decoded by the output correction (`v^gamma`, Output) first, so brightness, power
  and darkness (every channel under 1 % of its light) are what the LEDs give, not the colour values.
  Flicker (`core/flash.ts`, which the preview's guard runs too, on the same light): WCAG 2.3.1's general flash rate
  on big swings only, a flash being a pair of opposing swings of ≥ `delta` (0.5: half the light; WCAG's is 0.1)
  with the darker side < 0.8, over `perSecond` (3) in any 1 s. An LED's light here is its brightest channel, not
  its luminance, so a full red, blue or orange strobe is a full swing (saturated red flashing is a known trigger:
  WCAG's red flash rule). The whole rig and each top-level
  group watch their mean for swings; each swing is credited to the parts that made it (the group's LEDs in each
  grid cell 1/32 of the bounds' diagonal that changed by `delta` themselves between its extremes) and is large when they cover ≥ `area` (0.25) of the LEDs, or of the lit cells seen from the
  front or the side. Flashes are counted per cell (a later change of direction), so a wave crossing the rig flashes
  each place once a pass. Flashing over the limit on a large area fails `ok` (`regions`: the top-level groups where);
  elsewhere alone (on the real map: spirelets, rose window, wash) it goes to `small`, a warning. The limits come from
  `STUDIO_FLASH_PER_SECOND`, `_DELTA` and `_AREA` (`flashSettings(config)`, `src/box-output.ts`; `FLASH` when unset or
  out of range); `STUDIO_FLASH_CHECK=off` (local use, never a public server) still measures, but large-area
  flashing only warns.
- **Stored.** `<STUDIO_DATA>/frames/<lookId>.fseq` and `look.bake = { source, status:
  queued|running|done|failed, ok, reason?, warning?, checkedAt, layersHash, renderKey?, analysis?, frames?: {
  bytes, sha256 }, boxStats? }`. `ok` is false when the frames are missing, malformed or flash over a
  large area (with the check on); `warning` says when only small regions flash. `layersHash` = SHA-256 of `renderFields(look)`.
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
