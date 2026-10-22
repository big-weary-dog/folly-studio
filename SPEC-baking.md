# Folly Studio — where bakes run (part of the contract)

How the render box (SPEC "Baked frames") runs on a server without bubblewrap, and the admin's setting for how
much baking may cost. `src/box-library.ts` and `src/render-box.ts` hold the first, `src/baking.ts` the second.

## Library only

Bubblewrap is the first choice wherever it runs. Where bubblewrap is missing (or cannot make its namespaces), the render box bakes only looks whose every layer's
and module's code is a library pattern's file exactly (SHA-256 against `public/patterns`' files the index lists;
a composite has no code of its own, so its sub-layers' modules are checked), as its own process under the same prlimits, scope, `nice` and wall clock, with an empty environment, in the same
stdlib-only `node:vm` realm, with no bubblewrap. A look with any other code is refused (422: "This server bakes
without bubblewrap, so only looks made of unchanged library patterns; Layer 2's Fire is custom code."), at the
request and again in the box. Without prlimit or the box's files → 503.
The library's patterns are our own code (CLAUDE.md lets tests run them too): anything else stays untrusted and
runs only under bubblewrap. A library-only box runs no generator's render check (SPEC-generators): it could only
refuse the code. `GET /api/baking`'s `box` says which box this is.

## The bake setting

Admin → Baking (`/admin/baking`) sets how the render box runs, kept in
`<STUDIO_DATA>/baking.json` as `{ mode, customCode? }` and read at each bake, so it takes effect without a restart (a missing or
broken file is `on`). **On**: as SPEC "Baked frames" says. **Throttled**: still one at a time, at `nice` 19 whatever
`STUDIO_BAKE_NICE` says, and each render (a bake's or a gallery preview's) starts at least 30 s after the last one
ended, waiting outside the lane so wire encodes go on. **Off**: no render-box renders; a bake is refused (503: "An
admin turned baking off."), Check & bake's button says so, and previews come only from bakes already made. Bakes
under way finish; ones still queued fail with that reason. The page also shows what the render box can do here
(bubblewrap, library only and why, or unavailable and why).

```
POST   /api/looks/:id/bake          → 202 { bake } (SPEC "HTTP API"); 503 while baking is off or there is no render
                                    box, 422 for custom code in a library-only box, 429 when the queue is full
GET    /api/baking                  → { mode, customCode, box: { ok, libraryOnly, reason? } }  everyone signed in
PUT    /api/admin/baking  { mode?, customCode? } → the same, after writing baking.json; admins only (403); 400 names
                                    the problem
```

## Custom code

The same page's **Custom code** switch says whether looks may take new pattern code. It is off unless an admin turns
it on (a missing or broken file is off). Off, a look saved (POST or PUT /api/looks, or a look a generator makes or
refines) may carry only code the server has already: a library pattern's file exactly (by SHA-256), or code in a look
the person can see (theirs or shared, any version), so tuning params, restoring a version and copying a gallery look
go on as before. Anything else is refused (403, naming the module), and a generator's idea that needs it fails with
that reason. The generators count as new code: a prompted model's extensions and modules given as code are errors
its repair rounds see ("compose from the library alone"). The Studio's code editor is read-only while it is off and
says why. Looks already saved play and bake as before.
