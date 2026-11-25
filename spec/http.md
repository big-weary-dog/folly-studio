# Folly Studio — static files, the HTTP API, accounts and access

Part of the [build contract](../SPEC.md).

## Static files

`npm run build` (Vite, `vite.config.js`) builds `public/` into `dist/`: `index.html` naming its entry module, the
modules it loads eagerly (`modulepreload`) and its stylesheet, and every other file under `assets/` with a content
hash in its name (`<name>-<8 characters>.<ext>`): modules and their split chunks, each view's stylesheet (imported
by the view's module and loaded with it), the data modules fetch (`new URL('../../data/rig-folly.json',
import.meta.url)`; both rigs ship), the favicon and the sandbox's worker (`sandbox-worker-<hash>.js`). `.vite/manifest.json` says what each module
loads with it.
Nothing is inlined (no data: URLs, no inline script; the modulepreload polyfill is off). Beside each text file of 512 bytes or more the build writes `<file>.br` (quality 11) and `<file>.gz` (9) where smaller
(`tools/vite-compress.ts`), so nothing static is compressed per request.

`src/static.ts` (@fastify/static) serves `dist/` under the app CSP (`CSP_APP`): files under `assets/` with
`Cache-Control: public, max-age=31536000, immutable`, the sandbox's worker with `CSP_WORKER` (spec/library "Sandbox protocol"); the shell (`index.html`, for
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
POST   /api/guest    { name? }                → { user, flash, rig }  a guest (sets cookie): "Guests"
POST   /api/logout                            → { ok: true }
GET    /api/me                                → { user, flash, rig }  user null with no session
PUT    /api/me/password { password, next }    → { ok: true }  a new password ("Your account")
DELETE /api/me       { password }             → { ok: true }  the account and its looks gone; clears the cookie
PUT    /api/me/tour  tour                     → { tour }  spec/studio "Tutorial"
GET    /api/light                             → light  the light settings (Light and output), defaults where unset;
                                              no session needed
PUT    /api/admin/light  light                → light, after writing <STUDIO_DATA>/light.json; admins only; 400 names
                                              the field
POST   /api/reports  report                   → 201 { id }  an F8 bug report (SPEC "Bug reports"): its own 3 MB
                                              body limit (413: send it again without the shot); 10 an hour per user
GET    /api/privacy                           → { reportDays }  no session needed: how long reports stay
GET    /api/admin/reports                     → { reports: [summary] }  admins only (403), newest first
GET    /api/admin/reports/:id                 → { report }  admins only; 404 when none
GET    /api/admin/reports/:id/shot            → image/jpeg  admins only; 404 when it has none
GET    /api/looks?scope=mine|gallery          → { looks: [listed] }  metadata only: no layers; the gallery: the
                                              approved looks, or for a curator every shared look (spec/http "Accounts and access"
                                              "Moderation")
POST   /api/looks    { title, summary?, layers, duration?, bpm?, globals?, automation?, chain?, origin? }
                                              → { look, imported? }  origin: an import (spec/looks "Look files"):
                                              201 added, or 200 updating the importer's look it names, `imported`
                                              'added' | 'updated' | 'unchanged'; 429 at the account's limits
                                              (above)
GET    /api/looks/:id                         → { look }             mine, or approved (a curator: shared)
PUT    /api/looks/:id { title?, summary?, layers?, duration?, bpm?, globals?, automation?, shared?, reviewed?,
                     hidden?, flashOverride?, chain?, restoredFrom?, versionName? } → { look }  owner only
                                              (reviewed, hidden: a curator, 403 for anyone else); layers without chain: 2 converted; applied to the look as
                                              stored once its refs are checked, so overlapping saves each keep a version
GET    /api/looks/:id/versions                → { versions: [versionListed] }  the owner's: "Versions" in
                                              spec/looks, as are the two below
GET    /api/looks/:id/versions/:n             → { version }
PUT    /api/looks/:id/versions/:n { name }    → { version: versionListed }  names or unnames it
DELETE /api/looks/:id                         → { ok: true }         owner, or an admin if shared
POST   /api/looks/:id/bake                    → 202 { bake }  owner, or a curator if shared; queued; 503 while
                                              baking is off or there is no render box, 429 when the queue is full
GET    /api/looks/:id/frames[?compress=1|zstd|zlib] → the baked .fseq   mine, or shared; 404 if none (attachment);
                                              503 + Retry-After while evicted frames are baked again
GET    /api/looks/:id/frames/wire             → 302 to its manifest; 202 { pending } + Retry-After while encoded
                                              (or baked again)
GET    /api/looks/:id/frames/:hash/manifest   → the stream manifest (immutable)        mine, or shared
GET    /api/looks/:id/frames/:hash/:n         → stream chunk n (immutable; br/gzip)  mine, or shared
GET    /api/looks/:id/preview/:key.webp       → the gallery preview (image/webp, immutable)  mine, or shared;
                                              `:key-still.webp` its still; 404 unless `key` is `listed.preview`
GET    /api/baking                            → { mode, box: { ok, reason? } }  anyone, signed in or not
                                              (spec/frames "The bake setting")
PUT    /api/admin/baking  { mode }            → the same, after writing baking.json; admins only; 400 names the
                                              problem
GET    /api/admin/stats                       → stats  admins only ("Stats")
GET    /api/admin/accounts                    → { accounts: [account] }  admins only, as are the two below ("People")
PUT    /api/admin/accounts/:id { role?, disabled? } → { account }
DELETE /api/admin/accounts/:id                → { ok: true }  the account and its looks gone
GET    /api/library                           → { patterns: [{ name, title, summary, tags, kind, category, code }] }
                                              (a preset: kind 'preset', its layers and globals?, code ''; a hidden
                                              module: hidden true, for the looks that use it, never shown)
```

With no session, `GET /api/looks?scope=gallery`, `GET /api/looks/:id` and its frames and preview answer for
approved looks alone (spec/http "Visitors"); `scope=mine` is 401.

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
or `automation`) makes a version, and a change to the frames drops the bake and clears `reviewed` (spec/looks "Versions and History").
Clips that overlap
or fall outside 0–600 s, and a duration outside 1–600 s, are refused with 400.

`user`: spec/http "Accounts and access".
`flash = { check, perSecond, delta, darker, area }`: the flash check's settings (Baked frames, Checks), for the
preview's guard; `check: false` (`STUDIO_FLASH_CHECK=off`) means nothing is dimmed or blocked.
`look = { id, owner, ownerName, title, summary, layers, duration, bpm?, shared, reviewed, reviewedBy?, hidden,
hiddenBy?, flashOverride?, bake?, chain, createdAt, updatedAt }` (`hidden`: spec/http "Moderation"; `hiddenBy` the
curator, for the owner and curators)
(`bake`: see Baked frames).

## Accounts and access

Who has an account, what each role may do, and the Admin pages. `src/auth.ts` holds accounts and sessions.

### Accounts

`user = { id, username, role: 'member' | 'curator' | 'admin' }` (curators listed in `STUDIO_CURATORS`, admins in
`STUDIO_ADMINS`, or made so on People below, whichever is higher; an admin is also a curator), and `tour?` once they have met the tutorial (spec/studio "Tutorial"):
`tour = { seen: true, done: [path], at?: { path, step } }`, the paths finished and where one was left. An account
without it has not seen the tutorial. Signing up or in is limited per client address (100 a minute) and, for
failures, per address and username (10 a minute): 429 with `Retry-After`. Password hashes run 3 at once with 30
waiting; past that, 429 "busy". A route that needs a session is 401 without one; the app takes a 401 from anything
but `/api/me`, `/api/login`, `/api/signup` and `/api/guest` as the session ending, and goes back to sign-in.

**Guests.** The sign-in page's **Try it** lets anyone in as a guest in one click, with no name to type
(`POST /api/guest {}`, a guest named Visitor; `{ name }` names one: 1–24 letters, digits, spaces and `_ . ' -`,
trimmed; 10 a minute per client address, beside the sign-in limits). A guest
is a session, not an account: nothing is written to the users, and `user = { id: 'guest-…', username: <name>, role:
'member', guest: true }` whatever the name says (a guest named for an admin is no admin). The cookie lets them back in
on that device for 7 days; at most 1,000 guest sessions live at once, the oldest dropped first (anyone can
make one). A guest only reads: every mutating route but `/api/logout`, `/api/login`, `/api/signup`
and `/api/guest` is 403 "Guests can't save", so they make no looks, bakes, reports or tour. The Studio keeps a
guest's work in that browser
(localStorage, the Studio's look as saved, written as it changes) and opens it again on `/studio`; Save asks them to
log in or sign up, since saving is for accounts, and the work comes along: the first account to open a blank Studio
in that browser gets it, unsaved, and the browser's copy goes once that account saves or discards it. Their name
shows with a Guest tag; it is untrusted text, shown only as text.

**Visitors.** Approved looks are open to anyone, with no session: the gallery's list, a look, its preview and its
frames answer a visitor as they would a member, and any other look is 404 (spec/http.md). `/` and `/gallery` show a
visitor the gallery, and a share link, `/studio/<id>`, opens its look in the Studio, under a header with Gallery,
Try it and Log in. There the visitor is a guest without a session: their work is kept in that browser, and Save
asks them to log in or sign up. Every other page, and anything else the server is asked, sends them to sign in.

### Your account

**Account** (`/account`, in the user menu; no guest has one) changes the password and deletes the account. There is
no email, so a forgotten password cannot be reset or recovered: Account and sign-up say so plainly.

- **Changing the password** takes the current one and a new one (sign-up's rules). It ends the account's other
  sessions; this one stays.
- **Deleting the account** takes its password and a confirm saying how many looks go, and how many are shared. It
  deletes the account, its sessions, and every look it owns: shared ones leave the gallery too, with
  their frames and previews. A copy someone else saved of one is theirs and stays. The browser is signed out, on
  sign-in. The username is free again.
- A change or a deletion whose password changed, or whose session ended, while it was checked is 409: of two at once,
  one stands.
- A wrong password is 403 "That is not your password.". Wrong ones are limited as failed sign-ins are, 10 a minute per
  address and account, then 429 with `Retry-After`.

### Who may do what

A look is its owner's: only they edit it, and others see it only when it is shared and approved (Moderation below);
curators see every shared look. Only they delete it, but for an
admin, who may delete any shared look: Delete on its gallery card and in the Studio's gallery notice, after a confirm
naming the look and its owner. Asking for what a look does not allow them, anyone else is told it is not found
(404), shared or not, so an unshared or unapproved look is never revealed.
A curator may also mark a look they can see reviewed (from the gallery, Approve), hide it, and bake it; admins are curators too, and alone use the Admin
pages and their `/api/admin` routes (403 for anyone else; each such route names its role, or the server does not
start).

### Moderation

A shared look is **approved** when a curator has marked it reviewed (SPEC "Baked frames") and no curator has hidden
it. Only approved looks are in the gallery and open for anyone but their owner and curators; the rest are 404 to
them, frames and previews too. A change to the frames clears the review, so an edited look waits for review again.
A curator **hides** a shared look from its gallery card (Hide; Unhide brings it back): `hidden` stays on the look
through edits and through unsharing and sharing again, until a curator unhides it, and the look is approved again
only when it is also reviewed. My looks tags its owner's shared looks that are waiting for review or hidden. Curators' gallery has an **Approved**
toggle beside search that starts on; off, it shows the rest too, each tagged (Reviewed, Hidden), and the page says
how many wait for review. Search and Approved apply together, and approving or hiding a card updates the list at once.
Anyone with an account may **Report this look** on a card someone else shared: a short note, sent as a report
(SPEC "Bug reports") that names the look, for an admin to read.

**The gallery is home** for everyone, guests and visitors too: `/`, the header's brand and signing in without a
`next` lead to it, showing approved looks. An empty My looks points to it, where a look is picked and saved as one's own.

### Admin

Phone Admin keeps quick operator tasks; see [spec/studio "Phones"](studio.md#phones).

Admins' header has one more item, **Admin** (`/admin`, which opens its first tab), where everyone else's has none.
Its tabs are pages of their own: Light (`/admin/light`, SPEC "Light and output"), Baking (`/admin/baking`,
spec/frames "The bake setting"), People (`/admin/people`, People below), Reports (`/admin/reports`, SPEC "Bug
reports") and Stats (`/admin/stats`, Stats below). `/light` and `/reports` lead to their tab, query kept; `/models`, `/access`, `/admin/models` and
`/admin/access` lead to Light. Anyone else who opens one sees an explanation that Admin pages require an admin
account, without the page's controls.
The browser uses the same admin permission as the server; admin API calls remain refused (403).
Leaving a Light draft asks before discarding it, including switching Admin tabs.
Light downloads the saved settings; while a draft differs, download waits for Save or Revert.

### People

People lists every account, newest first: its name, role, when it was made, how many looks it has and how many are
shared, and whether it is disabled; a search narrows it by name.
`account = { id, username, role, serverRole?, createdAt, looks, shared, disabled }`, `serverRole` the role
`STUDIO_ADMINS` or `STUDIO_CURATORS` gives it.

- **Role**: member, curator or admin, kept with the account. The server's lists still count: an account they name
  is at least that role, and People offers nothing lower (409 if asked).
- **Disable**: the account's sessions end and it cannot sign in ("This account is disabled.", 403) until it is
  enabled again. Its looks stay, shared ones in the gallery.
- **Delete**, after a confirm naming the account and how many looks go: as the account deleting itself ("Your
  account"), no password asked.
- An admin changes none of these for themselves (409): Account is theirs, and no admin locks themselves out.

### Privacy

**Privacy** (`/privacy`) is open to anyone, signed in or not, and linked from the sign-in page and the user menu
(guests' too). It says, plainly and briefly, what Studio keeps and for how long:

- **Accounts**: the username, a salted password hash, the role, when it was made and the tutorial's progress; no
  email or real name. Usernames show in the gallery.
- **Looks**: what each account saves, with its versions, bakes and previews; shared ones show in the gallery.
- **Visitors**: counted with a hash of the address and browser under a salt made each day and never written; no
  address is stored (Stats below). Behind the tunnel, the journal lines carry the visitor's country.
- **Bug reports** (F8 and Report this look, spec/studio "Bug reports"): the note, a screenshot when it is on, the page's state
  (the unsaved look, the page's errors and messages) and the server's last warn and error lines, with the account's
  name. The state and log lines are scrubbed (spec/studio "Bug reports"); the note and screenshot are kept as sent, so the page
  asks people to leave secrets out of them. Admins read them, and they go after `GET /api/privacy`'s `reportDays`
  (`STUDIO_REPORTS_DAYS`).
- **Cookies and storage**: one cookie, `studio_session`, the sign-in (30 days, a guest's 7), and nothing to track;
  the browser keeps a guest's work, the tutorial's place and view settings in its own storage.
- **Deleting**: Account's Delete account removes the account, its sessions and every look it owns at once; a
  guest's work goes with the browser's site data. Bug reports age out as above.

The page has no controls; a signed-out visitor gets a link back to sign in.

### Stats

The server counts in memory, from its start (a restart starts again; nothing is written), and Stats shows the counts:
today's as tiles, then the server's uptime, memory (RSS and heap) and 1-minute load; bakes finished in the last 24
hours, failed, and waiting now; each day's counts (the server's local days, the last 7 with requests); and the 10
latest requests that took 1 s or more.
`stats = { startedAt, uptime, memory: { rss, heap }, load, days: [{ day, visitors, people, views, requests, errors,
slow }], slowest: [{ at, method, route, status, ms }], bakes: { done, failed, waiting } }`, `days` newest first: `views` app pages served, `visitors` the browsers that loaded one, `people` the
accounts that made a signed-in request, `errors` 5xx answers. A **visitor** is the client's address (the tunnel's
forwarded one under `STUDIO_TRUST_PROXY`) and User-Agent hashed with a random salt made each day and never written,
so a day's visits tell apart without keeping who made them, and days do not link; at most 100,000 a day are told apart.

Each request worth reading is one journal line: `[studio] [http] GET /api/looks/:id 200 12ms 3.4KB v=1a2b3c4d NZ`:
the method; the API route's pattern (other paths as asked, without the query, cut to 80 printable characters); the
status, time and body size (`-` when streamed); `v=` the visitor's hash for that day; and, under `STUDIO_TRUST_PROXY`,
Cloudflare's `CF-IPCountry` when it is two capital letters. No query, cookie, header or address is written. Files
(`/assets`, `/data`, …), frame chunks and previews are counted but written only when they fail (4xx, 5xx)
or are slow. Nothing per frame: one hook per HTTP request, a hash only for a
line or a page.

When a local day ends, its counts are one journal line, with the bakes and the server's state at that moment:
`[studio] [stats] 2026-11-24 visitors=12 people=3 views=40 requests=900 errors=0 slow=2 bakes=5/0/0 uptime=86400s
rss=120MB`, `bakes` done/failed/waiting as in `stats.bakes`. A day the server started partway through counts from its
start.

### No AI

Studio has no AI: no Ideas page (`/ideas` leads home), no Refine, no invite
codes and no Models or Access tabs; sign-up says nothing of AI. The server has no idea, model, invite or people
routes, and leaves an older data folder's `ideas.json`, `invites.json`, `models.json` and `ideas-log/` unread.
