# Folly Studio — where bakes run (part of the contract)

How the render box (SPEC "Baked frames") runs on a server without bubblewrap, and the admin's setting for how
much baking may cost. `src/box-library.ts` and `src/render-box.ts` hold the first, `src/baking.ts` the second.

## Trusted verification

Fresh renders, cache reuse and adoption of another look's frames all rerun the server's checks with the current
light and flash settings. Frames must match the requested baked length, rig step and complete sparse channel
layout. A reported layer error fails the bake; the box's own `ok` can never make it pass. Bakes use a stable FSEQ
identifier so identical rebakes have identical file hashes.

Before attaching a record, after storing its frames, the queue rechecks the look's render fields and baked length.
Review requires a bake of both the current render fields and `min(duration, configured bake cap)` seconds (the
default duration when omitted). Restoring evicted frames refreshes their checks while retaining the review.
Verification timestamps preserve check order even when the host's wall clock steps backward.

## Library only

Every box bakes only library code ("Custom code" below). Bubblewrap is the first choice wherever it runs. Where
bubblewrap is missing (or cannot make its namespaces), the render box bakes as its own process under the same
prlimits, scope, `nice` and wall clock, with an empty environment, in the same stdlib-only `node:vm` realm, with no
bubblewrap. Without prlimit or the box's files → 503. The library's patterns are our own code (CLAUDE.md lets tests
run them too). A library-only box runs no generator's render check (SPEC-generators): it could only
refuse the code. `GET /api/baking`'s `box` says which box this is.

## The bake setting

Admin → Baking (`/admin/baking`) sets how the render box runs, kept in `<STUDIO_DATA>/baking.json` as `{ mode }`
(a `customCode` there is ignored: "Custom code") and read at each bake, so it takes effect without a restart (a
missing or broken file is `on`). **On**: as SPEC "Baked frames" says. **Throttled**: still one at a time, at `nice` 19
whatever `STUDIO_BAKE_NICE` says, and each render (a bake's or a gallery preview's) starts at least 30 s after the
last one ended, waiting outside the lane so wire encodes go on. **Off**: no render-box renders; a bake is refused
(503: "An admin turned baking off."), Check & bake's button says so, and previews come only from bakes already made.
Bakes under way finish; ones still queued fail with that reason. The page also shows what the render box can do here
(bubblewrap, or without it and why, or unavailable and why).

```
POST   /api/looks/:id/bake          → 202 { bake } (SPEC "HTTP API"); 503 while baking is off or there is no render
                                    box, 422 for custom code, 429 when the queue is full
GET    /api/baking                  → { mode, customCode, box: { ok, libraryOnly, reason? } }  everyone signed in
PUT    /api/admin/baking  { mode?, customCode? } → the same, after writing baking.json; admins only (403); 400 names
                                    the problem, and refuses customCode: true
```

## Custom code

Custom code is off on every server, and no setting, file or route turns it on: looks take only library patterns.
A look saved (POST or PUT /api/looks, an import) or baked may carry only library code: each layer's and module's
code is a library pattern's current or earlier committed file exactly (by SHA-256 against `public/patterns`' files
the index lists, and the shipped `public/patterns/history.json` catalogue of earlier ones). A composite has no code
of its own: one whose `code` is not empty is custom, and its sub-layers' modules are checked. Anything else is refused,
naming the module: saving 403, baking 422 at the request and again in the box, on every box ("Only looks made of
unchanged library patterns save and bake; Layer 2's Fire is custom code."). So tuning params, restoring a version and
copying a gallery look go on as before. The Studio's code editor is read-only and says why; pickers omit blank-code
entries. Looks already saved with other code still play in the browser and do not bake. A PUT or import that keeps
their layers is 403, whatever else it changes; one replacing the layers with library code saves, as their repair.
`baking.json`'s `customCode` is ignored; `GET /api/baking` says `customCode: false`, and `PUT /api/admin/baking`
with `customCode: true` is 400.
On saving or importing, exact historical copies of patterns still in the library move to its current code,
keeping their params for the library's upgrade hooks. This lets imported looks play and bake on a
library-only box.
The catalogue is rebuilt with `node tools/pattern-history.ts` from the indexed library files in committed history;
it contains hashes only, never executable code.
