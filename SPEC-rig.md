# Folly Studio — the rig, 3D view and light

Part of the [build contract](SPEC.md).

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
draws: each value's light on the LEDs (`v^gamma` × `balance`, unquantised; off where the LEDs round to off; the
`floor`; no trims), through the `calibration`, × the `gain` × a highlight's dim outside it, all linear as the Pi's
master is, × `exposure` (full drive's screen light).
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
  group's `trim` scale light, as WLED's and FPP's brightness do, so dimming never shifts a colour's hue.
- **The checks judge the look at full output**: `gamma`, `balance` and `floor`, never the caps.
  A bake is judged at the settings in force when it is checked. A new gamma changes no baked frame (they are
  values), so every bake still plays, through the new curve; its report keeps the old gamma's numbers until a rebake.

The light settings, `shared/schemas/light.ts`, are stored once: `<STUDIO_DATA>/light.json`, written by the Light page
(Admin) and read by Export, the bake checks, the previews and the Pi (its `light` setting: on the Pi, Studio's own
`light.json`; elsewhere `pi/light.json`, the Light page's "Download for the Pi"). The Pi re-reads it when it changes,
so a saved gamma reaches the LEDs within seconds. The page edits `gamma`, `calibration` and `preview`; the other
output fields change by hand.
Missing, unreadable or out of range, each field is its default:

```
{ gamma: 2.65,             // 1..3: light = v^gamma; 1 sends the values as they are, as FPP and the live apps do
  balance: [1, 1, 1],      // 0..1 each: a colour's light trimmed down, to even out the whites
  floor: 0,                // 0..16: the least byte a lit channel sends (v ≥ 0.5/255); 0 lets the curve round to off
  trims: [],               // ≤ 32 of { tag, level 0..1 }: a group's light × level, by the rig's group tags
  controller: [{ ports, brightness, gamma }],    // ≤ 16: the controller's own settings, recorded, never applied
  calibration: { white: [1, 1, 1], response: 1, saturation: 1 }, // the real LEDs' look: docs/LIGHT.md
  preview: { exposure: 0.85, // 0.1..2: the screen light of full drive (above, Playa compresses; Points clips at 1)
    bloom: 0.4,              // 0..1: Playa's glow round bright light; 0 is off
    highlight: 0.22,         // 0..1: the light left outside a hover highlight
    focus: 0.05 } }          // 0..1: the light left outside a layer's groups while picking them
```

