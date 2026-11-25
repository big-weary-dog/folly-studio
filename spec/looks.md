# Folly Studio — looks, versions and the timeline

Part of the [build contract](../SPEC.md).

## Looks (what gets saved)

A look is a stack of layers, composited bottom to top like xLights rows reversed (index 0 is the
bottom). The rules below are `shared/schemas/look.ts`; its types (`Layer`, `Module`, `Globals`, …) are the
browser's too:

```jsonc
{ "title": "Coral reef", "summary": "…", "duration": 30, "bpm": 120, "chain": 2, "layers": [
  { "id": "l1", "title": "Sea", "groups": ["cathedral"], "tags": ["all"], "blend": "add" | "over" | "max" | "multiply",
    "level": 1, "clips": [{ "start": 0, "end": 12, "fadeIn": 2, "fadeOut": 3 }], "soften": { "radius": 0.15, "mode": "wire" },
    "modules": [
      { "id": "m1", "kind": "source", "title": "Chase", "ref": "single-strand",
        "params": { "speed": 40, "colours": { "pick": "body/accent", "rotate": 0.25 } } },
      { "id": "m2", "kind": "source", "title": "Clouds", "ref": "clouds", "params": {}, "as": "input" },
      { "id": "m3", "kind": "filter", "title": "Mask", "ref": "mask", "input": "m2",
        "params": { "amount": { "mod": "global", "name": "storm", "from": 0, "to": 1 } } },
      { "id": "m4", "kind": "warp", "title": "Twist", "ref": "twist", "params": {} }
    ] }
],
  "globals": {
    "palette": { "name": "carnival", "low": ["#6700cb"], "body": ["#ee008e"], "accent": [], "high": ["#f9e9cf"] },
    "macros": { "storm": { "value": 0.2, "min": 0, "max": 1 } } },
  "automation": { "storm": [[0, 0], [30, 1]] } }
```

`groups` is an array of the rig's group ids (union). Missing, the layer plays on the rig's root; `[]` (with no tags)
is a valid pick that lights nothing (the Studio picks them in its Groups drawer: spec/studio.md). `tags` (optional, ≤ 16 of
`[a-z0-9-]{1,32}`) make a layer portable: when it names no groups, or one this rig lacks, the layer takes its
known ids plus every group carrying one of its tags (a rig without them lights nothing there); where all its
ids are known, tags change nothing. An unknown id in a layer without tags is an error. Editing a
layer's groups by hand clears its tags. Blend: `add` sums light (default: 50 % and 50 % make
68 %), `over` replaces where the layer has alpha × level, `max` keeps the brighter channel, `multiply` tints what is
below.

- **Modules**: 1–8 per layer, ids unique in it (`[A-Za-z0-9_.:-]{1,64}`), each naming a library module by `ref`
  (`[a-z0-9-]{1,64}`; a composite names none). A body's modules are refs and params: `code` on a module or a layer
  is ignored. The server keeps a module as its `ref` and params, never its code (`src/library-refs.ts`): every read
  (the API, versions, bakes, previews, exports) fills `code` with the current file of the entry `ref` names, hidden
  ones too, whatever was stored ('' for a ref the library lacks). A stored module whose ref the library lacks, or
  that has none, takes the ref of the one entry whose current file its stored code is exactly (by SHA-256); else it
  keeps its ref. A look
  and each version keep the hash of the code they were saved with (`codeHash`, never handed out). When the library
  changes that code, a read gives the look without its bake or review (`reviewed` false, no `reviewedBy` or
  `flashOverride`), to be baked and reviewed afresh, and the version `reviewed` false. Every rule on a look's
  modules (this one, the save check, the library-only step, a bake's key) walks them by one walk
  (`shared/look-modules.ts`): each module that runs code, in order, a layer that is one source and composites'
  sub-layers' modules at any depth among them, a composite itself (no code: spec/library "Composites") never.
  Filters and updates see the look as a read gives it, so what it leaves out stays out. A
  module whose `ref` the library has is standard: it keeps the
  library's title (`shared/standard-modules.ts`; the API puts a renamed one's back). The Studio plays each module's
  code from its ref's library file (hidden ones too, `GET /api/library`), whatever the look holds ('' for a ref the
  library lacks). A save's modules must each name a library module (spec/frames "Library only"); `params`
  override the code's defaults (≤ 64; a string ≤ 256 characters: a pick, a choice or text).
  A stored module's `live` (offers to the archived Live Play) is ignored on read and dropped.
  `enabled: false` skips it; `input` names an earlier source; `on`
  (a warp's or filter's) attaches it to the source or composite just above it, past the others attached to it
  (spec/library "Attached modules"); `as` is only
  `'input'`; `blend` as for layers, or `under` (a source's only). `kind` is `source`, `warp`, `filter` or
  `composite`: no code, its `layers` 1–4 sub-layers, each a chain of its own that counts as one source to the chain
  round it (spec/library "Composites"); ids are unique across a layer's sub-layers too. A stored layer with `code`
  (+ `params`) and no `modules` reads and plays as a one-source chain; a body's layer has `modules`.
- **chain**: `2`, the one rule (spec/library "Modules"). Without it a warp bends every module after it, on through blurs and
  trails, so a look without `chain: 2` (stored, or a body to `POST`/`PUT` without it) is converted once on its way
  in (`shared/chain-order.ts`, by the code its refs name), exactly wherever it can be: warps leading a stage move to its end, reversed; a stage
  after a stage end gets copies of the warps it read; two sources bent differently turn over (the first goes
  `under`, or adds or maxes as the second did); otherwise a warp stop (a blur of radius 0, `ref: 'blur'`) splits the
  stage. Where it cannot (more than 8 modules, or trails reading a pixel a warp changed), each warp moves to the end of
  its stage and the summary says which layers changed. Trails that do not declare their stage (`ref: 'trails'`)
  get `const stage = 'history'`. Stored looks are converted at start (their versions too); a bake of an exact
  conversion keeps its place.
- **Soften** (optional): `{ radius: 0–1.5 m, mode: 'wire' | 'space' | 'both' (default 'wire') }`, a blur at the end
  of the chain (spec/library "Spatial modules"); radius 0 is none. New layers in the Studio and generated layers get
  `DEFAULT_SOFTEN`; a layer without it has none.
- **Colours** (spec/library "Palettes"): a colour param's value is a pick string (≤ 200 characters, not checked: a bad one plays
  the default, as a bad hex does), `[r, g, b]`, or `{ pick, blend?, range?, rotate? }` (checked: tokens, `step`
  or `smooth`, two numbers 0..1, a number 0..1 or a binding). A layer's `palette`, a role remap the core does not read,
  is dropped on the way in and from stored looks at start (`dropRemaps`).
- **Globals** (all optional): `palette` as role lists (≤ 16 `#rrggbb` each; a bare name from
  `data/palettes.json` is filled in on save; default `chapel`); `macros` ≤ 16, names
  `[a-z][A-Za-z0-9_]{0,31}` but `palette` and `bpm`, `{ value, min = 0, max = 1, mod? }`. A stored look's `speed`,
  `level`, `hue`, `saturation` (lanes, live names) are ignored; its `energy` is read as a macro `energy`
  (its value, else 0.5) where stored, automated or followed (`upgradeGlobals`, on read; never rewritten). A macro with a `mod` (an LFO
  or a stored tempo binding, never offered, spec/library "Param bindings"; never the envelope) is a **modulator**: it moves by itself each
  frame, `value` its value when the mod is lifted, and params bound to it (`{ mod: 'global', name }`) follow it in
  step. Each frame a lane wins over the mod, the mod over the value. One level only: a modulator follows faders
  (macros without a mod): a global binding, or an LFO's `amount` or `pace`, naming a modulator is
  refused by the schema and dropped by the core.
  A stored look's `globals.live` (the archived Live Play's controls) is ignored on read and dropped.
- **Automation**: `{ <macro>: [[t, v], …] }`, ≤ 16 lanes of ≤ 256 points, t 0–600 s ascending (to
  the ms); linear between points, held before the first and after the last; it replaces the static value.
- **What plays** (`PLAYS`), versions and History: `spec/looks "Versions and History"`, part of this contract.
- `data/palettes.json` (`tools/build_palettes.py [--check]`, from `tools/data/palettes/*.csv` and
  `tools/data/palettes/themes.txt`; sRGB swatches grouped by role):
  `{ version: 1, roles: [low, body, accent, high], palettes: [{ name, theme, low, body, accent, high }] }`. A look
  stores a palette's colours, not its theme.
  Vampire ball palettes: `blood` (clean reds), `crimson` (red/violet), `amethyst` (violet), `requiem`
  (red/gold), `dracula` (red/cobalt), `gargoyle` (blue/silver) and `nightshade` (violet/green).
  Their lows remain visible through gamma 2.2 LED output.

### Library only

Stored looks hold library modules alone (spec/frames "Library only"). A module is library when its `ref` names a module
the index lists (its stored code, if any, is ignored, as every read ignores it), or, with no such ref, when its code is
exactly (by SHA-256) the current file of one. Each data folder is brought under this rule (`src/library-only-data.ts`),
by hand alone: `node tools/library-only.ts [--data <dir>] [--apply]`, with the server stopped. The server never runs
it, so stored looks may still hold code. Without `--apply` it is a dry run: it lists what it would do and writes
nothing. With it:

- it copies `looks.json` and `users.json` beside themselves (`<name>.pre-library-only-<time>.json`) and stops,
  changing nothing, if a copy fails or the folder is in use;
- a module naming a retired pattern (`src/retired-patterns.ts`) is switched to today's closest library pattern, a
  preset's modules in its place: butterfly-classic to butterfly, plasma-classic to plasma, lighthouse-classic to
  lighthouse (a module naming the preset, the pattern's name before, too). The preset's source takes the module's id, blend, `as` and `enabled`, and of its params those that
  mean the same there (Colours; lighthouse's Beams as Bars); the preset's warps follow attached to it (`on`), ahead
  of what was attached. A layer holding tendril or stained-glass, which have no match, is dropped, the look kept; so
  is a layer a switch would take past 8 modules;
- a look whose layers have any other module is dropped, with its frames (its previews and wire frames go at the
  server's next start, as no look names them); so is a version with one. Each drop, the dry run's too, says why: the
  module that is custom code, or the shape that breaks. Every kept version, and the look itself, has its number
  written, so none is renumbered;
- kept modules (composites' sub-layers' too) name their entry as `ref` and carry its current file. A look whose
  code changes so plays differently: its bake, frames and review
  (`reviewed`, `reviewedBy`, `flashOverride`) go, to be baked and reviewed afresh; a version whose code changes loses
  its `reviewed`;
- looks lose `ideaId` and users `access`, which nothing reads;
- each look changed is listed, the dry run's too, by look id, title and owner: each layer switched or dropped and
  why, and apart, each module whose stored code was not its ref's current file (an edited or earlier copy, played as
  the library's). `migrations.json`'s `library-only` and `retired-patterns` (when it ran) mark it done, so it never
  runs again; a folder with only the first gets the step again, for the switch. Without the library it changes
  nothing.

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

How the Studio edits a look (its groups, timeline, chain, modulators, colours and the phone's panels): `spec/studio.md`,
part of this contract.

## Look files

A look file is JSON, `application/json`, named for its title (`<slug>.json`):

```
{ "origin", "title", "summary", "chain": 2, "duration", "layers", "bpm"?, "globals"?, "automation"? }
```

the look's words, `chain`, and what plays (spec/looks "What plays"), as the Studio's Export → Look JSON writes it,
each module as its library `ref` and params, without code (the library it is imported into supplies it). An import
takes modules as any save does: code a module carries is ignored, and each must name a library module (SPEC
"Modules"). The
FSEQ exports are unchanged.
`origin` names the look wherever it is copied: the look's `origin` when it came in by an import, else its own id (ids
are random, so one Studio's never stands for another's); `GET /api/looks/:id` answers it when set. A file without
`origin` (written before it was) imports as a new look each time.
Several looks go in one file as `{ "looks": [look file] }` (`folly-looks-mine-<date>.json`,
`folly-looks-gallery-<date>.json`, or `folly-looks-gallery-approved-<date>.json`).

- **Export many.** My looks and the Gallery have **Export all**: all own looks, or all the looks the Gallery lists.
  Those are approved ones (`gallery-approved` in the filename) unless a curator turns the **Approved** toggle off. Search never narrows the export. Busy progress and the completion toast count the looks being exported.
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
  (library modules only, the body limit, a bake and review dropped when the frames change), so a change to what
  plays is a new version and what the importer had, edits made since the last import included, stays in its History
  (spec/looks "Versions"); it keeps its sharing, and its review as any such save does. One that already reads and
  plays as the file is **unchanged**. Any other look is **added**: the importer's, unshared, keeping the `origin`. A
  look without `chain` is converted as any such `POST` is (SPEC "Looks"). One look refused (400, or past the 256 KB
  body) does not stop the rest: the page says how many were added, updated and unchanged, and names each one that
  failed, with the server's reason.

## Versions and History

A look's saved versions (`src/look-versions.ts`, served by `src/api-looks.ts`) and the Studio's History drawer
(`public/js/ui/history/`). The routes are in SPEC "HTTP API".

### What plays

`PLAYS = layers, duration, globals, automation, bpm` (`shared/plays.ts`, re-exported by `look.ts`), with
`playsOf(look)` (layers and duration always, the others when set) and `playsChanged(a, b)`. A version, the bake's
render fields, the sandbox's extras, the JSON export and the Studio's save and steps all take their
fields from it: a field added to `PLAYS` reaches them all (`test/plays.test.ts`). `title` and `summary` are the
look's words, not what plays.

### Versions

A save that changes what plays keeps what was there as a version (`src/look-versions.ts`): `{ n, how, name?, from?,
ideaId?, ask?, title, summary, layers, duration, bpm, globals?, automation?, savedAt, reviewed? }`. `n` counts up
and is never reused; `how` is `auto` (a save), `ai` (an AI refinement: its `ideaId` and what it `ask`ed), `restore`
(of version `from`) or `import` (a look file overruling it: spec/looks "Look files"); `reviewed = { by,
flashOverride? }` when a curator had reviewed it. The look holds its own
number and making as `look.version` (`GET` answers its owner with the number alone). The last 20 unnamed versions
are kept, and every named one (at most 50). A version without `n` is numbered by its place; one without `bpm`
reads as the look's tempo (`tempoGuessed`). Versions are their owner's alone: others, curators too, never
see them.

A change to the frames also drops the bake and its frames and clears `reviewed`: anything but `bpm` on a look that
does not move to the beat, where the tempo is only a grid (a bake's render fields hold it on a look that does: a
tempo nobody flash-checked), unless it plays as a reviewed version (a restore). A version's `bpm` is null when the
look had none.

A restore is an edit plus a save (`PUT /api/looks/:id` with `restoredFrom: n`; 400 when the look has no version
`n`). Content that plays exactly as a version a curator reviewed
(`playsOf`, compared canonically) keeps that review, and its frames are baked again (often a stored bake); anything
else is reviewed afresh.

`GET /api/looks/:id/versions` → `{ versions: [versionListed] }` lists them newest first, the look as saved on top,
and `GET /api/looks/:id/versions/:n` → `{ version }` has one with its content (404 when none); both answer 404 to
anyone but the owner:
`versionListed = { n, how, name?, from?, ideaId?, ask?, savedAt, title, layerCount, duration, bpm, tempoGuessed?,
reviewed, current?, shared?, palette }`: `current` the look as saved (its `shared` too), `palette` up to 8 of its
colours (the house palette when it has none), `tempoGuessed` when its `bpm` is the look's; `version` adds `summary`,
`layers`, `globals` and `automation`.

### Named versions

A name (1–80 characters) keeps a version past the 20: at most 50 of a look's versions are named (409 for one more).
`PUT /api/looks/:id { …, versionName }` is "Save a named version…": the save, then the version the look is now (new or
not) takes the name. `PUT /api/looks/:id/versions/:n { name }` → `{ version: versionListed }` names version `n`, the
look as saved or a kept one (404 when none), or `{ name: null }` unnames it, and the next save prunes it with the
rest; both are the owner's alone (404 to anyone else). A version keeps its name when it is kept and when it is
restored from (the restore is a version of its own, unnamed).

### The History drawer

In the Studio, History (`ui/history/`) is a drawer beside the view, opened from the bar, with two tabs and Undo and
Redo. Only the steps model and the keys are in the main bundle; the drawer loads when first opened.

**Steps** (`history/steps.ts`, held by the store as `st.history`): this session's edits of the look, oldest first,
from "Opened the look" (or "New look"). Each edit through `st.edit(fn, { step?, kind?, merge? })` that changes
the look's content (title, summary, what plays) is a step, named for what it changed ("Level 70%", "Edited the code
of “Glow”", "Added a layer") unless `step` names it; edits that share a `merge` key are one step (a preset's layers
and globals). Quick edits to one thing (a drag, typing) fold into one step until 1.5 s pass, a pointer up or a focus
change seals it. The list is linear, like Photoshop's: clicking a step (or Undo, Ctrl/⌘+Z; Redo, Ctrl/⌘+Shift+Z or
Ctrl+Y) plays the look as it was then and greys the later steps; a new edit drops them. A jump puts back content,
never the look's id, owner or sharing. A save marks its step (it stays across undo); a look away from its saved step
is unsaved. The keys are ignored while typing in a field or a dialog. At most 200 steps are kept.

A toast's Undo (a deleted layer, module or clip) is ordinary undo: it undoes its own step while it is the step now,
and says so otherwise.

**Versions** lists the look's versions newest first (its own saved looks only), each with a strip of its palette's
colours and tags (Saved, In gallery, Reviewed). Preview plays one in the view in place of the work (`st.previewing`
holds the work, which still decides `dirty` and what saves), the view says "Previewing version n", and editing and
saving wait; "Back to my work" puts the work back, "Restore this version" makes it the work, as a step, and saves.
Preview and restore include the version's title and summary as well as what plays.
"Save a named version…" asks a name and saves; ✎ on a version names it, renames it, or (left empty) unnames it.
Named ones are tagged Named.
