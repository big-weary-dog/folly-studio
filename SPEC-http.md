# Folly Studio — static files and the HTTP API

Part of the [build contract](SPEC.md).

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
POST   /api/guest    { name }                 → { user, flash, profile }  a guest (SPEC-access "Guests")
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
POST   /api/looks    { title, summary?, layers, duration?, bpm?, globals?, automation?, ideaId?, chain?, origin? }
                                              → { look, imported? }  origin: an import (SPEC-offline "Look files"):
                                              201 added, or 200 updating the importer's look it names, `imported`
                                              'added' | 'updated' | 'unchanged'; 429 at 500 looks (an account's
                                              most, which an idea's new look also keeps to: it fails)
GET    /api/looks/:id                         → { look }             mine, or shared
PUT    /api/looks/:id { title?, summary?, layers?, duration?, bpm?, globals?, automation?, shared?, reviewed?,
                     flashOverride?, chain?, restoredFrom?, versionName? } → { look }  owner only (reviewed: a
                                              curator); layers without chain: 2 converted; applied to the look as
                                              stored once its code is checked, so overlapping saves each keep a version
GET|PUT /api/looks/:id/versions[/:n]          the owner's versions: SPEC-history
DELETE /api/looks/:id                         → { ok: true }         owner, or an admin if shared
POST   /api/looks/:id/bake                    → 202 { bake }      owner, or a curator if shared; queued (SPEC-baking)
GET    /api/looks/:id/frames[?compress=1|zstd|zlib] → the baked .fseq   mine, or shared; 404 if none (attachment);
                                              503 + Retry-After while evicted frames are baked again
GET    /api/looks/:id/frames/wire             → 302 to its manifest; 202 { pending } + Retry-After while encoded
                                              (or baked again)
GET    /api/looks/:id/frames/:hash/manifest   → the stream manifest (immutable)        mine, or shared
GET    /api/looks/:id/frames/:hash/:n         → stream chunk n (immutable; br/gzip)  mine, or shared
GET    /api/looks/:id/preview/:key.webp       → the gallery preview (image/webp, immutable)  mine, or shared;
                                              `:key-still.webp` its still; 404 unless `key` is `listed.preview`
GET    /api/pi-bundle[/info]                  → the Pi bundle | { commit, bytes, builtAt }  curators (SPEC-offline
                                              "Downloading the Pi bundle"); POST /api/pi-bundle/link, GET /:token
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
its current layers and length (`bake.seconds` the duration it bakes now); large-area flashing in any bake blocks (flashing on small regions only
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
total, check?, critique?, draft?, tokens? }` in ms (`tokens = { input, cached, output }`); `rounds = [{ kind, ms,
outcome? }]` its model's rounds and `how` how it was made (SPEC-generators "The idea log"); `explore` the level it was made at and `took` what its look took from
each draft (SPEC-generators "Explore"). A refinement has `refine = { critique?, fix? }` and the look it changes as
`lookId` from the start; `changes` (ready) says what changed, `verdict` how its critique round ended (`revised`,
`unchanged`, …), and `undone: true` that it was undone.
`look = { id, owner, ownerName, title, summary, layers, duration, bpm?, shared, ideaId?, reviewed, reviewedBy?,
flashOverride?, bake?, chain, createdAt, updatedAt }`
(`bake`: see Baked frames).

