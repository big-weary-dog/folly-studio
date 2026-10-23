# Folly Studio — offline on the Pi, and look files (part of the contract)

The same Studio, run on the FPP Pi with no internet (the Pi profile), and the files that carry looks between two
Studios. `src/profile.ts` holds the profile; `public/js/ui/look-file.ts` the files. Installing it on the Pi:
`pi/SETUP.md` (from a USB stick, or downloaded from the hosted Studio: below) or `pi/STUDIO.md` (the `pi` branch).

## The Pi profile

The offline installer requires Node ≥ 22.18. It stages the tree, native dependencies and configuration, then
tests the staged engine without sending lights before swapping it into place. An existing Studio env keeps its
settings, with `PI_PIN` synchronized to the engine's PIN. A failed activation or service check restores the previous
tree and env and restarts the services that were running. Studio data stays outside the replaced tree.

`STUDIO_PROFILE` is `hosted` (unset: the public site, as the rest of the contract describes) or `pi`. Under `pi`:

- **No generators.** No model registry is read and no generator runs; ideas left in the data stay as they are.
  The routes that make or read ideas, models and their access are not there (404): `/api/ideas…`,
  `POST /api/looks/:id/refine`, `/api/models`, `/api/admin/models`, `/api/admin/ideas/…`, `/api/invite` and
  `/api/admin/invites…`, `/api/admin/people…`. `GET /api/me` has no `access`.
- **`profile`.** `POST /api/signup`, `/api/login`, `/api/guest` and `GET /api/me` answer `profile: 'hosted' | 'pi'` beside
  `user`. Under `pi` the app has no Ideas tab, no Refine panel and no Models or Access tab under Admin; its home is
  My looks, and `/ideas` leads there. The tutorial (SPEC-tutorial) leaves out its steps on Ideas.
- **The lights.** `/pi` (below) is the Pi's own Studio Live engine, not a dry run, and is open to curators as well
  as admins. Their header has **Lights** (`/pi/`, the engine's control page).
- **Defaults.** `STUDIO_PREVIEWS` is `front` (no browser on the Pi), `STUDIO_FRAMES_MAX_BYTES` 1 GB (an SD
  card), and a bake runs at `STUDIO_BAKE_NICE` 19 within `STUDIO_BAKE_MEMORY` 384 MB, one at a time, so it never
  takes the engine's CPU; each setting still wins.
- **Listening.** `HOST` may be any address. Under `hosted` the server refuses to start on anything but loopback
  (`127.0.0.1`, `localhost`, `::1`): the public site is reached through its tunnel.

Everything else is the hosted Studio's: accounts (the Pi's own), looks, versions, the gallery, bakes (library only
without bubblewrap: SPEC-baking), `/live` and bug reports.

## The Pi preview

With `PI_PREVIEW_URL` set (a Studio Live engine on loopback, started with `--base /pi`: a dry run on the hosting
machine, the real one on the Pi), `GET /pi`, `/pi/*` and the socket `/pi/ws` pass through to it unchanged, for
signed-in admins only (curators too under the Pi profile): no session is 401, anyone else 403, and a socket from
another origin 403. Pages keep the engine's own CSP; an engine that is down is 502. The socket carries the engine's
protocol (`pi/src/protocol.ts`): text frames up to 1 KB from the page, and a relaying page's binary frames
(SPEC-live "Relay to the lights"). Unset, there is no `/pi`.

The engine started with `--base /pi` serves its page and socket at `/` as well, so the ops hub's link to
`:4043/` reaches it in both Pi setups: the engine alone, and the engine behind Studio. On the Pi it listens on the
network (`bind` `0.0.0.0`): its page there is outside Studio's sign-in, gated by the engine's PIN alone (set one),
and still plays only looks made of library modules, never code. Hosted, it stays on loopback.

## Downloading the Pi bundle

The hosted Studio serves the Pi's offline bundle (`npm run pi:bundle`, pi/SETUP.md) of the commit it runs, so a laptop
or the Pi itself (online through a hotspot) downloads in one file what the USB stick carries. `npm run host` makes it
at deploy time, before the restart (`--no-pi-bundle` skips it), outside the checkout and outside `dist/`, and names it
to the service as `STUDIO_PI_BUNDLE`; nothing is built or fetched at request time. Unset, or its file missing, there
is no bundle: the routes are 404 and the page says so.

It is `folly-studio-pi-<commit>.tar` (12 hex characters), holding one folder, `folly-studio-pi/`: `folly-studio-pi.tgz`,
`install.sh` and `SETUP.md`, the stick's files (looks are the person's own to add as `looks/`). It holds only the
commit's tracked files, its build, `node_modules` and the pinned bubblewrap `.deb`s: never an env file, Studio's
data, keys or anything else of the hosting machine's; `npm run host` refuses to serve one whose listing names any
(`tools/pi-bundle-check.ts`).

**Who.** Signed-in curators and admins (no session 401, anyone else 403, guests too). For curl, the page mints a
**link**: a random token, good for 1 hour and any number of downloads, kept in memory (a restart forgets it; at
most 20 live, the oldest dropped); it needs no cookie, so whoever holds it may download until it expires.

```
GET  /api/pi-bundle/info    → { commit, bytes, builtAt }  curators; 404 when there is no bundle
GET  /api/pi-bundle         → the bundle  curators
POST /api/pi-bundle/link    → { path: '/api/pi-bundle/<token>', expires }  curators
GET  /api/pi-bundle/:token  → the bundle  no session; 404 for a token unknown or expired
```

The bundle is sent from the one file `STUDIO_PI_BUNDLE` names (nothing in the request names a path) as
`application/x-tar` with its `Content-Length`, `Content-Disposition: attachment; filename="folly-studio-pi-<commit>.tar"`
and `Cache-Control: private, no-store` (the tunnel never caches it); `HEAD` gives the same headers.

**The page.** Admin → **Pi bundle** (`/admin/pi-bundle`): the commit, size and build time, **Download** (the
browser's own download of `GET /api/pi-bundle`), and **Copy curl link**, which mints a link and shows, ready to copy,
`curl -fo folly-studio-pi.tar '<origin><path>'` and when it expires. Without a bundle it says the server has none.
A curator opens the page by its address, without the tabs, as any Admin page. The Pi profile has no tab for it.

## Look files

A look file is JSON, `application/json`, named for its title (`<slug>.json`):

```
{ "origin", "title", "summary", "chain": 2, "duration", "layers", "bpm"?, "globals"?, "automation"? }
```

the look's words, `chain`, and what plays (SPEC-history "What plays"), as the Studio's Export → Look JSON writes it.
`origin` names the look wherever it is copied: the look's `origin` when it came in by an import, else its own id (ids
are random, so one Studio's never stands for another's); `GET /api/looks/:id` answers it when set. A file without
`origin` (written before it was) imports as a new look each time.
Several looks go in one file as `{ "looks": [look file] }` (`folly-looks-mine-<date>.json`,
`folly-looks-gallery-<date>.json`).

- **Export many.** My looks and the Gallery have **Export all**: every look the page lists (not just those a search
  shows), fetched one at a time with `GET /api/looks/:id`, as one file. A look gone since the list (404) is left
  out; any other failure downloads nothing and names the look, so a backup is never quietly short.
- **Import.** My looks has **Import**: a file picker taking one or more files, each a look file or a file of looks.
  Each look is `POST /api/looks` with its `origin`, title, summary, `chain` and what plays, so the same checks apply.
  A look already among the importer's own (its id or its `origin` is the file's `origin`) is **updated**: the file
  overrules it, as a `PUT` of the title, summary and what plays would (`how: import`), with every check a `PUT` has
  (the Custom code switch, the body limit, a bake and review dropped when the frames change), so a change to what
  plays is a new version and what the importer had, edits made since the last import included, stays in its History
  (SPEC-history "Versions"); it keeps its sharing, and its review as any such save does. One that already reads and
  plays as the file is **unchanged**. Any other look is **added**: the importer's, unshared, with no idea, keeping the `origin`. A
  look without `chain` is converted as any such `POST` is (SPEC "Looks"). One look refused (400, or past the 256 KB
  body) does not stop the rest: the page says how many were added, updated and unchanged, and names each one that
  failed, with the server's reason.

## Playing on the lights

Under the Pi profile, with `PI_PREVIEW_URL` set, Studio puts looks on the lights through the engine (`pi/`), which
plays a **queue** (the jukebox): what plays now, then each look queued, in order. The engine holds the queue; Studio
and the engine's control page (`/pi/`) both add to it. Custom code never reaches the engine.

**Two ways a look plays.**
- **Live**: a look made only of library modules (every module has a `ref` the library has; editing a module's code
  drops its `ref`, SPEC "Looks"). Studio sends the saved look with its modules by `ref` and no code; the engine
  resolves it against its own library (`resolveLook`, the same clone, so the same code), and its live controls work
  as for its own looks. Allowed only while the admin's **Live library looks** is on.
- **Baked**: any look whose bake is current (`bake.status` done, `ok`, `layersHash` the look's now). Studio sends the
  look's id, title and `bake.frames.sha256`; the engine reads `<frames>/<lookId>.fseq` itself (its `frames` setting,
  Studio's `<STUDIO_DATA>/frames`, as `light` is Studio's `light.json`), checks the SHA-256, parses it strictly
  (`src/frames.ts` `parseFseq`, uncompressed, the rig's channels and fps, at most 128 MB), and plays its frames as baked: each LED's channels
  are the look's colour, out through the same light transform, master, blackout, fades and flash guard. A baked
  item has no live controls. The engine loads an item's frames when it is next, off the frame loop, so the switch
  never waits; a missing or changed file skips the item, saying so. A Pi without bubblewrap bakes only looks of
  unchanged library code (SPEC-baking "Library only").

Studio picks the way: live when it may (the controls work), else baked, else it refuses, saying why ("Has custom
code: bake it (Check & bake) to play it on the lights…", "Live looks are off: bake it…").

**The queue** (the engine's, in memory; a restart empties it). At most 20 items, each
`{ key, id, title, kind: 'look' | 'live' | 'baked', by?, duration }`: `look` is one of the engine's own
(`pi/looks`). An item plays its whole pattern once from its start, its `duration` (a bake's length), then the next
starts. Moving on, the queue fades the one out over its last second (`FADE.queue`, 1 s) and the next in over its
first; play now and skip fade the same way, or over the `fade` they give (SPEC-liveplay). Each direction is capped
at half of its own look's duration. With nothing queued, what
plays loops on, except in Jukebox (SPEC-liveplay "Modes"), whose fades are `FADE.jukebox` (4 s each way, at most half
the pattern) and which picks the next itself. A flash-guard trip dips to `safe` and pauses the queue until someone plays or skips.
What the mode allows, who drives, and the page: `SPEC-liveplay.md`, part of this contract.

The engine binds its control server before validating local looks (including layers), prepares the safe look,
then opens output and starts playback. A safe look that cannot prepare stops startup. Every failure and signal
uses the same cleanup, sending black before closing output; signals first fade out over one second. If a later
fallback cannot prepare the safe look, it plays independent black frames. The flash guard's monotonic clock counts
skipped frame slots too, across look switches and loops.

**HTTP** (Pi profile with `PI_PREVIEW_URL`; others 404):

```
GET  /api/lights[?lookId]  → { liveLooks, mode, canQueue, canDrive, engine: boolean, play?: { kind } | { error } }
                             engine: the feed is connected; play: how that look would play
POST /api/lights/queue  { lookId, at?: 'now' | 'next' | 'end' (default), fade? }
                           → { kind: 'live' | 'baked' }  400 says why it cannot play; 403 not allowed;
                             409 the queue is full, or now in Jukebox; 503 the engine is not connected
GET  /api/lights/looks?from=mine|gallery
                        → { looks: [{ id, title, ownerName, duration, preview?, play: { kind } | { error } }] };
                          curators; preview: its gallery preview's key, as GET /api/looks gives it
PUT  /api/admin/lights  { liveLooks, mode } → the same; admins only; kept in <STUDIO_DATA>/lights.json
                             (default liveLooks on, mode jukebox)
```

Queuing is for whoever may use `/pi` (curators and admins), on looks they may open. The queue itself, as the engine
has it, reaches Studio's pages in the feed's `now` (SPEC-live "Following /pi").

**The engine's socket** (`pi/src/protocol.ts`) gains, from any page that said hello:
`{ type: 'queue', id, at? }` (one of its own looks), `{ type: 'unqueue', key }`, `{ type: 'move', key, to }`,
`{ type: 'next' }` (skip to the next item now); and, as Studio's feed sends it,
`{ type: 'send', at?, fade?, by, item: { kind: 'live', look } | { kind: 'baked', id, title, sha256, duration } }`,
up to 64 KB (other messages stay at 1 KB; who may send it: SPEC-liveplay). Its state gains `queue`, `paused`,
and the playing look's `kind` and `left` (seconds left of its pattern; null while nothing is queued). Studio's feed
says `PI_PIN` in its hello when the engine has a PIN. While a baked item plays, the engine's `source` has
`baked: true` and no layers: `/live` shows its title and "Baked: on the lights only" over a dark view.

**Pages.**
- **Studio** (the editor's Export menu, the phone's Look tab, and each card on My looks and the Gallery): **Play on
  the lights** → Play now · Play next · Add to queue, for those who may; off, with the reason, when it cannot play.
  It plays the saved look (unsaved changes: "Save first"). In Jukebox it offers no Play now.
- **`/pi/`** (the engine's page) and, on the Pi, **`/live`** for curators (the others see the stage): the
  live play controller (SPEC-liveplay "The page"). `/live`'s adds Studio's looks (Mine, Gallery) to the lights'
  own and, on a laptop, the stage's 3D view; it talks to the engine on `/pi/ws` through Studio's proxy, as `/pi/`
  does (the PIN too), so a control used there makes `/pi` drive the stage.
- **`/live/control`**, following the Pi: the same queue, read only, with **Open the lights** (`/pi/`); `/live` shows
  "Up next" under the title.
- **Admin → Light**: **Live library looks** on the lights (on, or baked looks only), and the **Mode** (Jukebox or
  Live Play).
