# Folly Studio — looks and the timeline

Part of the [build contract](SPEC.md).

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
is a valid pick that lights nothing (the Studio picks them in its Groups drawer: SPEC-studio). `tags` (optional, ≤ 16 of
`[a-z0-9-]{1,32}`) make a layer portable: when it names no groups, or one this rig lacks, the layer takes its
known ids plus every group carrying one of its tags (a rig without them lights nothing there); where all its
ids are known, tags change nothing. An unknown id in a layer without tags is an error. Generators set both; editing a
layer's groups by hand clears its tags. Blend: `add` sums light (default: 50 % and 50 % make
68 %), `over` replaces where the layer has alpha × level, `max` keeps the brighter channel, `multiply` tints what is
below.

- **Modules**: 1–8 per layer, ids unique in it (`[A-Za-z0-9_.:-]{1,64}`), `code` ≤ 20 kB each and always
  stored (looks stay self-contained for the boxes); `ref` names the library entry it came from, and a module whose `ref` the library has is standard: it keeps the
  library's title (`shared/standard-modules.ts`; the API and generators put a renamed one's back), and a hand edit
  of its code drops `ref`, making it custom (while an admin has custom code off, new code is refused: SPEC-baking
  "Custom code"); `params`
  override the code's defaults (≤ 64; a string ≤ 256 characters: a pick, a choice or text).
  `live` optionally lists up to 64 unique param keys the creator offers in Live Play: only declared choice and
  colour params are offered. The Settings panel shows **Offer in Live Play** beside each eligible setting;
  unchecked by default. Offers belong to the module's ID within its layer, survive renaming and reordering,
  and disappear when the module or declared param disappears. Missing `live` offers none.
  The Look panel's **Live Play** list shows all offered faders, tempo, module settings and palette together.
  `enabled: false` skips it; `input` names an earlier source; `on`
  (a warp's or filter's) attaches it to the source or composite just above it, past the others attached to it
  (SPEC-library "Attached modules"); `as` is only
  `'input'`; `blend` as for layers, or `under` (a source's only). `kind` is `source`, `warp`, `filter` or
  `composite`: no code, its `layers` 1–4 sub-layers, each a chain of its own that counts as one source to the chain
  round it (SPEC-library "Composites"); ids are unique across a layer's sub-layers too. A layer with `code`
  (+ `params`) and no `modules` is a one-source chain.
- **chain**: `2`, the one rule (SPEC-library "Modules"). Without it a warp bends every module after it, on through blurs and
  trails, so a look without `chain: 2` (stored, or a body to `POST`/`PUT` without it) is converted once on its way
  in (`shared/chain-order.ts`), exactly wherever it can be: warps leading a stage move to its end, reversed; a stage
  after a stage end gets copies of the warps it read; two sources bent differently turn over (the first goes
  `under`, or adds or maxes as the second did); otherwise a warp stop (a blur of radius 0, `ref: 'blur'`) splits the
  stage. Where it cannot (more than 8 modules, or trails reading a pixel a warp changed), each warp moves to the end of
  its stage and the summary says which layers changed. Trails that do not declare their stage (`ref: 'trails'`)
  get `const stage = 'history'`. Stored looks are converted at start (their versions too); a bake of an exact
  conversion keeps its place.
- **Soften** (optional): `{ radius: 0–1.5 m, mode: 'wire' | 'space' | 'both' (default 'wire') }`, a blur at the end
  of the chain (SPEC-library "Spatial modules"); radius 0 is none. New layers in the Studio and generated layers get
  `DEFAULT_SOFTEN`; a layer without it has none.
- **Colours** (SPEC-library "Palettes"): a colour param's value is a pick string (≤ 200 characters, not checked: a bad one plays
  the default, as a bad hex does), `[r, g, b]`, or `{ pick, blend?, range?, rotate? }` (checked: tokens, `step`
  or `smooth`, two numbers 0..1, a number 0..1 or a binding). A layer's `palette`, a role remap the core does not read,
  is dropped on the way in and from stored looks at start (`dropRemaps`).
- **Globals** (all optional): `palette` as role lists (≤ 16 `#rrggbb` each; a bare name from
  `data/palettes.json` is filled in on save; default `chapel`); `macros` ≤ 16, names
  `[a-z][A-Za-z0-9_]{0,31}` but `palette` and `bpm`, `{ value, min = 0, max = 1, mod? }`. A stored look's `speed`,
  `level`, `hue`, `saturation` (lanes, live names) are ignored; its `energy` is read as a macro `energy`
  (its value, else 0.5) where stored, automated or followed (`upgradeGlobals`, on read; never rewritten). A macro with a `mod` (an LFO
  or a stored tempo binding, never offered, SPEC-library "Param bindings"; never the envelope) is a **modulator**: it moves by itself each
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
  holds it when a binding counts beats or any module (including composite sub-layers) reads `G.bpm`, `G['bpm']`
  or `G["bpm"]`. Other uses of `G`, including palette-only code, keep their existing hashes.
  Beats count from the look's downbeat `beat0` (a PreparedLook field, 0: show time 0), which only a live engine
  moves (tap tempo); `beat()` and LFOs in `beats` read it, so bakes are unchanged.
- `layer.clips`: optional `[{ start, end, fadeIn = 0, fadeOut = 0, transition? }]` in seconds (0–600, kept to
  the millisecond), ≤ 32 per layer, sorted, not overlapping (touching is fine). No or empty
  clips: the layer is always on.
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

How the Studio edits a look (its groups, timeline, chain, modulators, colours and the phone's panels): `SPEC-studio.md`,
part of this contract.
