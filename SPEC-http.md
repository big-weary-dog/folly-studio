# Folly Studio — static files and the HTTP API

Part of the [build contract](SPEC.md).

## Static files

`npm run build` (Vite, `vite.config.js`) builds `public/` into `dist/`: `index.html` naming its entry module, the
modules it loads eagerly (`modulepreload`) and its stylesheet, and every other file under `assets/` with a content
hash in its name (`<name>-<8 characters>.<ext>`): modules and their split chunks, each view's stylesheet (imported
by the view's module and loaded with it), the data modules fetch (`new URL('../../data/rig-folly.json',
import.meta.url)`; both rigs ship), the favicon and the sandbox page. `.vite/manifest.json` says what each module
loads with it.
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

Look writes (`POST /api/looks`, `PUT` and `DELETE /api/looks/:id`, `PUT /api/looks/:id/versions/:n`) are limited per
account: 120 a minute, then 429 with `Retry-After`. An account keeps at most 500 looks, and its looks with their
versions hold at most 20 MB as stored: a new look past either, or a change that grows its looks past the bytes, is
429 "delete some first" (a change that does not grow them always saves).
What the server itself records on a look, its bake, is bounded and never refused, so a look at the cap still bakes.

```
POST   /api/signup   { username, password }   → { user, flash, rig }  (sets cookie)
POST   /api/login    { username, password }   → { user, flash, rig }
POST   /api/guest    { name? }                → { user, flash, rig }  a guest (SPEC-access "Guests")
POST   /api/logout                            → { ok: true }
GET    /api/me                                → { user, flash, rig } | 401
PUT    /api/me/tour  tour                     → { tour }  SPEC-tutorial
GET    /api/light                             → light  the light settings (Light and output), defaults where unset
PUT    /api/admin/light  light                → light, after writing <STUDIO_DATA>/light.json; admins only; 400 names
                                              the field
POST   /api/reports  report                   → 201 { id }  an F8 bug report (SPEC "Bug reports"): its own 3 MB
                                              body limit (413: send it again without the shot); 10 an hour per user
GET    /api/privacy                           → { reportDays }  no session needed: how long reports stay
GET    /api/admin/reports                     → { reports: [summary] }  admins only (403), newest first
GET    /api/admin/reports/:id                 → { report }  admins only; 404 when none
GET    /api/admin/reports/:id/shot            → image/jpeg  admins only; 404 when it has none
GET    /api/looks?scope=mine|gallery          → { looks: [listed] }  metadata only: no layers; the gallery: the
                                              approved looks, or for a curator every shared look (SPEC-access
                                              "Moderation")
POST   /api/looks    { title, summary?, layers, duration?, bpm?, globals?, automation?, chain?, origin? }
                                              → { look, imported? }  origin: an import (SPEC-looks "Look files"):
                                              201 added, or 200 updating the importer's look it names, `imported`
                                              'added' | 'updated' | 'unchanged'; 429 at the account's limits
                                              (above)
GET    /api/looks/:id                         → { look }             mine, or approved (a curator: shared)
PUT    /api/looks/:id { title?, summary?, layers?, duration?, bpm?, globals?, automation?, shared?, reviewed?,
                     hidden?, flashOverride?, chain?, restoredFrom?, versionName? } → { look }  owner only
                                              (reviewed, hidden: a curator, 403 for anyone else); layers without chain: 2 converted; applied to the look as
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
GET    /api/library                           → { patterns: [{ name, title, summary, tags, kind, category, code }] }
                                              (a preset: kind 'preset', its layers and globals?, code ''; a hidden
                                              module: hidden true, for the looks that use it, never shown)
```

API `GET`s answer `Cache-Control: private, no-cache` with an ETag (a reload or a poll revalidates to an
empty 304); other responses are `no-store`. JSON bodies of 1 KB or more are sent br (quality 5) or gzip
when the request accepts it, with `Vary: Accept-Encoding`; the ETag is the uncompressed body's. A list
holds `listed = { id, owner, ownerName, title, summary, duration, layerCount, shared, reviewed, hidden, bpm?,
sharedAt?, preview?, createdAt, updatedAt }` (`preview`: its gallery preview's key, when it has one); `GET /api/looks/:id`
has the rest.

`PUT reviewed: true` answers 409 with the reason unless the look has a passing render-box bake of
its current layers and length (`bake.seconds` the duration it bakes now); large-area flashing in any bake blocks (flashing on small regions only
warns: `bake.warning`) unless the curator gives `flashOverride`, their reason (3–500 characters), with a render-box
bake that fails only the flash check: it is kept as `look.flashOverride = { reason, by, at }` (and logged), and
cleared with the review (400 without `reviewed: true`). Changing what plays (`PLAYS`; `null` clears `bpm`, `globals`
or `automation`) makes a version, and a change to the frames drops the bake and clears `reviewed` (SPEC-history).
Clips that overlap
or fall outside 0–600 s, and a duration outside 1–600 s, are refused with 400.

`user`: SPEC-access.
`flash = { check, perSecond, delta, darker, area }`: the flash check's settings (Baked frames, Checks), for the
preview's guard; `check: false` (`STUDIO_FLASH_CHECK=off`) means nothing is dimmed or blocked.
`look = { id, owner, ownerName, title, summary, layers, duration, bpm?, shared, reviewed, reviewedBy?, hidden,
hiddenBy?, flashOverride?, bake?, chain, createdAt, updatedAt }` (`hidden`: SPEC-access "Moderation"; `hiddenBy` the
curator, for the owner and curators)
(`bake`: see Baked frames).

