# Folly Studio — where bakes run (part of the contract)

How the render box (SPEC "Baked frames") runs, the admin's setting for how much baking may cost, and the rule that
only library code saves. `src/render-box.ts` holds the first, `src/baking.ts` the second, `src/library-gate.ts` the
third.

## Verification

Fresh renders, cache reuse and adoption of another look's frames all rerun the server's checks with the current
light and flash settings. Frames must match the requested baked length, rig step and complete sparse channel
layout. A reported layer error fails the bake; the box's own `ok` can never make it pass. Bakes use a stable FSEQ
identifier so identical rebakes have identical file hashes.

Before attaching a record, after storing its frames, the queue rechecks the look's render fields and baked length;
a look deleted or changed meanwhile gets no record, and the frames it stored are removed.
Review requires a bake of both the current render fields and `min(duration, configured bake cap)` seconds (the
default duration when omitted). Restoring evicted frames refreshes their checks while retaining the review.
Verification timestamps preserve check order even when the host's wall clock steps backward.

## The box

The render box bakes stored looks, whose code is always the library's ("Library only" below), as its own process
under prlimits, a systemd scope, `nice` and a wall clock, with an empty environment, in a stdlib-only `node:vm`
realm. Without prlimit, env or the box's files → 503. `GET /api/baking`'s `box` says whether it runs here.

## The bake setting

Admin → Baking (`/admin/baking`) sets how the render box runs, kept in `<STUDIO_DATA>/baking.json` as `{ mode }`
(any other key there is ignored) and read at each bake, so it takes effect without a restart (a
missing or broken file is `on`). **On**: as SPEC "Baked frames" says. **Throttled**: still one at a time, at `nice` 19
whatever `STUDIO_BAKE_NICE` says, and each render (a bake's or a gallery preview's) starts at least 30 s after the
last one ended, waiting outside the lane so wire encodes go on. **Off**: no render-box renders; a bake is refused
(503: "An admin turned baking off."), Check & bake's button says so, and previews come only from bakes already made.
Bakes under way finish; ones still queued fail with that reason. The page also says whether the render box runs here
(and why not).

```
POST   /api/looks/:id/bake          → 202 { bake } (SPEC "HTTP API"); 503 while baking is off or there is no render
                                    box, 429 when the queue is full
GET    /api/baking                  → { mode, box: { ok, reason? } }  everyone signed in
PUT    /api/admin/baking  { mode }  → the same, after writing baking.json; admins only (403); 400 names the problem
```

## Library only

Looks take only library patterns, on every server, and nothing turns that off. A look saved (POST or PUT
/api/looks, an import) has each module name a library module by `ref` alone, or carry a library pattern's current or
earlier committed file exactly (by SHA-256 against `public/patterns`' files the index lists, hidden ones too, and the
shipped `public/patterns/history.json` catalogue of earlier ones). A composite has no code of its own: one whose
`code` is not empty is custom, and its sub-layers' modules are checked. Anything else is refused with 403, naming
the module ("Only looks made of unchanged library patterns save; Layer 2's Fire is custom code."). So tuning params,
restoring a version and copying a gallery look go on as before. The Studio has no code editor and its pickers offer
only library modules. Stored looks hold refs alone (SPEC-looks "Modules"), so every read, and so every bake, has
library code only. A PUT or import that keeps a module the library refuses is 403, whatever else it changes; one
replacing the layers with library modules saves, as their repair.
On saving or importing, exact historical copies of patterns still in the library move to its current code,
keeping their params for the library's upgrade hooks, so imported looks play and bake.
The catalogue is rebuilt with `node tools/pattern-history.ts` from the indexed library files in committed history;
it contains hashes only, never executable code.
