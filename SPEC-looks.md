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
ids are known, tags change nothing. An unknown id in a layer without tags is an error. Editing a
layer's groups by hand clears its tags. Blend: `add` sums light (default: 50 % and 50 % make
68 %), `over` replaces where the layer has alpha × level, `max` keeps the brighter channel, `multiply` tints what is
below.

- **Modules**: 1–8 per layer, ids unique in it (`[A-Za-z0-9_.:-]{1,64}`), `code` ≤ 20 kB each. The server keeps a
  module as its `ref` and params, never its code (`src/library-refs.ts`): every read (the API, versions, bakes,
  previews, exports) fills `code` with the current file of the entry `ref` names, hidden ones too, whatever was
  stored ('' for a ref the library lacks). A module whose code is not its ref's file, or that has no ref, takes the
  ref of the one entry whose current or earlier file its code is exactly (by SHA-256); else it keeps its ref. A look
  and each version keep the hash of the code they were saved with (`codeHash`, never handed out). When the library
  changes that code, a read gives the look without its bake or review (`reviewed` false, no `reviewedBy` or
  `flashOverride`), to be baked and reviewed afresh, and the version `reviewed` false. Filters and updates see the look as a read gives it, so what it leaves out stays out. A
  module whose `ref` the library has is standard: it keeps the
  library's title (`shared/standard-modules.ts`; the API puts a renamed one's back). The Studio plays each module's
  code from its ref's library file (hidden ones too, `GET /api/library`), whatever the look holds ('' for a ref the
  library lacks). A save may send a module as its `ref` alone; with custom code off (SPEC-baking "Custom code") each
  module must name a library module so, or carry a library file exactly; `params`
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
  `live`: the names the look offers as live controls: the look's macros and `bpm`, each once; absent, the macros
  without a mod. The Studio edits and shows it; nothing that plays a look reads it.
- **Automation**: `{ <macro>: [[t, v], …] }`, ≤ 16 lanes of ≤ 256 points, t 0–600 s ascending (to
  the ms); linear between points, held before the first and after the last; it replaces the static value.
- **What plays** (`PLAYS`), versions and History: `SPEC-history.md`, part of this contract.
- `data/palettes.json` (`tools/build_palettes.py [--check]`, from `tools/data/palettes/*.csv` and
  `tools/data/palettes/themes.txt`; sRGB swatches grouped by role):
  `{ version: 1, roles: [low, body, accent, high], palettes: [{ name, theme, low, body, accent, high }] }`. A look
  stores a palette's colours, not its theme.
  Vampire ball palettes: `blood` (clean reds), `crimson` (red/violet), `amethyst` (violet), `requiem`
  (red/gold), `dracula` (red/cobalt), `gargoyle` (blue/silver) and `nightshade` (violet/green).
  Their lows remain visible through gamma 2.2 LED output.

### Library only

Stored looks hold library code alone (SPEC-baking "Custom code"). A module is library when its code is a current or
earlier file (by SHA-256: `public/patterns`' files and `history.json`) of a module the index lists, hidden ones too:
the entry its `ref` names when it is, else the one entry whose file it is. A copy of a retired pattern (one
`history.json` names and the index no longer lists as a module) is not. Each data folder is brought under this rule once
(`src/library-only-data.ts`), by hand alone: `node tools/library-only.ts [--data <dir>] [--apply]`, with the server
stopped. The server never runs it, so stored looks may still hold code. Without `--apply` it is a dry run: it lists
what it would do and writes nothing. With it:

- it copies `looks.json` and `users.json` beside themselves (`<name>.pre-library-only-<time>.json`) and stops,
  changing nothing, if a copy fails or the folder is in use;
- a look whose layers have any other module is dropped, with its frames (its previews and wire frames go at the
  server's next start, as no look names them); so is a version with one. Each drop, the dry run's too, says why: the
  retired pattern it copies, or the module that is custom code. Every kept version, and the look itself, has its number
  written, so none is renumbered;
- kept modules (composites' sub-layers' too) name their entry as `ref` and carry its current file. A look whose
  code changes so plays differently: its bake, frames and review
  (`reviewed`, `reviewedBy`, `flashOverride`) go, to be baked and reviewed afresh; a version whose code changes loses
  its `reviewed`;
- looks lose `ideaId` and users `access`, the AI's;
- each drop is logged by look id, title and owner, and `migrations.json`'s `library-only` (when it ran) marks it
  done, so it never runs again. Without the library it changes nothing.

### Timeline

Sequencing lives on the look, xLights-style.

- `look.duration`: seconds the look runs, then loops; 1–600, default 30 (absent = 30).
- `look.bpm`: optional, 40–240; the editor's beat grid, the tempo of LFOs in `beats`, and `G.bpm`. A bake's key
  holds it when a binding counts beats or any module (including composite sub-layers) reads `G.bpm`, `G['bpm']`
  or `G["bpm"]`. Other uses of `G`, including palette-only code, keep their existing hashes.
  Beats count from the look's downbeat `beat0` (a PreparedLook field, 0: show time 0); `beat()` and LFOs in
  `beats` read it.
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
  e, p, out?, softness?)` (`core/timeline.ts`, pure) is a pixel's share at envelope `e`.
- Sequencing whole looks = importing another look's layers into this one, then placing clips.
- Preview loops over `duration`; bakes and `.fseq` exports render `duration` from t = 0.

How the Studio edits a look (its groups, timeline, chain, modulators, colours and the phone's panels): `SPEC-studio.md`,
part of this contract.

## Look files

A look file is JSON, `application/json`, named for its title (`<slug>.json`):

```
{ "origin", "title", "summary", "chain": 2, "duration", "layers", "bpm"?, "globals"?, "automation"? }
```

the look's words, `chain`, and what plays (SPEC-history "What plays"), as the Studio's Export → Look JSON writes it,
each module as its library `ref` and params, without code (the library it is imported into supplies it). An import
takes such modules, and older files' modules with code, matched to the library by exact file (SPEC "Modules"). The
FSEQ exports are unchanged.
`origin` names the look wherever it is copied: the look's `origin` when it came in by an import, else its own id (ids
are random, so one Studio's never stands for another's); `GET /api/looks/:id` answers it when set. A file without
`origin` (written before it was) imports as a new look each time.
Several looks go in one file as `{ "looks": [look file] }` (`folly-looks-mine-<date>.json`,
`folly-looks-gallery-<date>.json`, or `folly-looks-gallery-approved-<date>.json`).

- **Export many.** My looks and the Gallery have **Export all**: all own looks, or all shared looks in the Gallery.
  With the Gallery's **Approved** toggle on, only reviewed looks are exported, with `gallery-approved` in the
  filename. Search never narrows the export. Busy progress and the completion toast count the looks being exported.
  Looks are fetched one at a time with `GET /api/looks/:id`, as one file. A look gone since the list (404) is left
  out; any other failure downloads nothing and names the look, so a backup is never quietly short.
- **Import.** My looks has **Import**: a file picker taking one or more files, each a look file or a file of looks.
  Before saving, a preview names additions and replacements. Cancel changes nothing; Import as copies drops origins.
  A repeated origin within the selected files is shown as replacing an earlier import in that batch.
  Replacements explain that current contents are replaced and previous versions remain in History.
  Each look is `POST /api/looks` with its `origin`, title, summary, `chain` and what plays, so the same checks apply.
  For an import naming an `origin`, automation lanes for macros absent from the file's globals are dropped:
  these stale lanes do nothing, and must not prevent a server from importing its own exports.
  Lanes for present macros remain checked.
  A look already among the importer's own (its id or its `origin` is the file's `origin`) is **updated**: the file
  overrules it, as a `PUT` of the title, summary and what plays would (`how: import`), with every check a `PUT` has
  (library code only, the body limit, a bake and review dropped when the frames change), so a change to what
  plays is a new version and what the importer had, edits made since the last import included, stays in its History
  (SPEC-history "Versions"); it keeps its sharing, and its review as any such save does. One that already reads and
  plays as the file is **unchanged**. Any other look is **added**: the importer's, unshared, keeping the `origin`. A
  look without `chain` is converted as any such `POST` is (SPEC "Looks"). One look refused (400, or past the 256 KB
  body) does not stop the rest: the page says how many were added, updated and unchanged, and names each one that
  failed, with the server's reason.
