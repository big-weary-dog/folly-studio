# Folly Studio — offline on the Pi, and look files (part of the contract)

The same Studio, run on the FPP Pi with no internet (the Pi profile), and the files that carry looks between two
Studios. `src/profile.ts` holds the profile; `public/js/ui/look-file.ts` the files. Installing it on the Pi:
`pi/STUDIO.md`.

## The Pi profile

`STUDIO_PROFILE` is `hosted` (unset: the public site, as the rest of the contract describes) or `pi`. Under `pi`:

- **No generators.** No model registry is read and no generator runs; ideas left in the data stay as they are.
  The routes that make or read ideas, models and their access are not there (404): `/api/ideas…`,
  `POST /api/looks/:id/refine`, `/api/models`, `/api/admin/models`, `/api/admin/ideas/…`, `/api/invite` and
  `/api/admin/invites…`, `/api/admin/people…`. `GET /api/me` has no `access`.
- **`profile`.** `POST /api/signup`, `POST /api/login` and `GET /api/me` answer `profile: 'hosted' | 'pi'` beside
  `user`. Under `pi` the app has no Ideas tab, no Refine panel and no Models or Access tab under Admin; its home is
  My looks, and `/ideas` leads there. The tutorial (SPEC-tutorial) leaves out its steps on Ideas.
- **The lights.** `/pi` (below) is the Pi's own Studio Live engine, not a dry run, and is open to curators as well
  as admins. Their header has **Lights** (`/pi/`, the engine's control page).
- **Defaults.** `STUDIO_PREVIEWS` is `front` (no browser on the Pi) and `STUDIO_FRAMES_MAX_BYTES` 1 GB (an SD
  card); either setting still wins.
- **Listening.** `HOST` may be any address. Under `hosted` the server refuses to start on anything but loopback
  (`127.0.0.1`, `localhost`, `::1`): the public site is reached through its tunnel.

Everything else is the hosted Studio's: accounts (the Pi's own), looks, versions, the gallery, bakes (503 without
bubblewrap), `/live` and bug reports.

## The Pi preview

With `PI_PREVIEW_URL` set (a Studio Live engine on loopback, started with `--base /pi`: a dry run on the hosting
machine, the real one on the Pi), `GET /pi`, `/pi/*` and the socket `/pi/ws` pass through to it unchanged, for
signed-in admins only (curators too under the Pi profile): no session is 401, anyone else 403, and a socket from
another origin 403. Pages keep the engine's own CSP; an engine that is down is 502. The socket carries the engine's
protocol (`pi/src/protocol.ts`): text frames up to 1 KB from the page. Unset, there is no `/pi`.

## Look files

A look file is JSON, `application/json`, named for its title (`<slug>.json`):

```
{ "title", "summary", "chain": 2, "duration", "layers", "bpm"?, "globals"?, "automation"? }
```

the look's words, `chain`, and what plays (SPEC-history "What plays"), as the Studio's Export → Look JSON writes it.
Several looks go in one file as `{ "looks": [look file] }` (`folly-looks-mine-<date>.json`,
`folly-looks-gallery-<date>.json`).

- **Export many.** My looks and the Gallery have **Export all**: every look the page lists (not just those a search
  shows), fetched one at a time with `GET /api/looks/:id`, as one file.
- **Import.** My looks has **Import**: a file picker taking one or more files, each a look file or a file of looks.
  Each look is `POST /api/looks` with its title, summary, `chain` and what plays, so the same checks apply; it
  becomes the importer's, unshared, with no idea. A look without `chain` is converted as any such `POST` is (SPEC
  "Looks"). One look refused (400, or past the 256 KB body) does not stop the rest: the page says how many came in
  and names each one that did not, with the server's reason.

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
  never waits; a missing or changed file skips the item, saying so. A bake is made where bubblewrap is (the
  render box; without it a bake is 503), so a Pi without bubblewrap has none to play.

Studio picks the way: live when it may (the controls work), else baked, else it refuses, saying why ("Has custom
code: bake it to play it on the lights", "Live looks are off: bake it to play it on the lights").

**The queue** (the engine's, in memory; a restart empties it). At most 20 items, each
`{ key, id, title, kind: 'look' | 'live' | 'baked', by? }`: `look` is one of the engine's own (`pi/looks`). An item
plays its whole pattern once from its start, its `duration` (a bake's length), then the next starts. Moving on, the
queue fades the one out over its last second (`FADE.queue`, 1 s) and the next in over its first; play now and skip
fade the same way. With nothing queued, what plays loops on. A flash-guard trip dips to `safe`
and pauses the queue until someone plays, skips or resumes it.

**HTTP** (Pi profile with `PI_PREVIEW_URL`; others 404):

```
GET  /api/lights                     → { liveLooks, canQueue, engine: boolean }   engine: the feed is connected
POST /api/lights/queue  { lookId, at?: 'now' | 'next' | 'end' }
                                     → { kind: 'live' | 'baked' }  400 says why it cannot play; 403 not allowed;
                                       503 the engine is not connected
PUT  /api/admin/lights  { liveLooks } → the same; admins only; kept in <STUDIO_DATA>/lights.json (default on)
```

Queuing is for whoever may use `/pi` (curators and admins), on looks they may open. The queue itself, as the engine
has it, reaches Studio's pages in the feed's `now` (SPEC-live "Following /pi").

**The engine's socket** (`pi/src/protocol.ts`) gains, from any page that said hello:
`{ type: 'queue', id, at? }` (one of its own looks), `{ type: 'unqueue', key }`, `{ type: 'move', key, to }`,
`{ type: 'next' }` (skip to the next item now), `{ type: 'resume' }`; and, as Studio's feed sends it,
`{ type: 'send', at?, by, item: { kind: 'live', look } | { kind: 'baked', id, title, sha256 } }`, up to 64 KB (other
messages stay at 1 KB). Studio's proxy passes pages no `send`, so through Studio its checks hold; on the Pi the
engine binds to `127.0.0.1` (`pi/STUDIO.md`), so nothing reaches it another way. Its state gains `queue`, `paused`,
and the playing look's `kind` and `left` (seconds left of its pattern; null while nothing is queued). Studio's feed
says `PI_PIN` in its hello when the engine has a PIN. While a baked item plays, the engine's `source` has
`baked: true` and no layers: `/live` shows its title and "Baked: on the lights only" over a dark view.

**Pages.**
- **Studio** (the editor's Export menu, the phone's Look tab, and each card on My looks and the Gallery): **Play on
  the lights** → Play now · Play next · Add to queue, for those who may; off, with the reason, when it cannot play.
  It plays the saved look (unsaved changes: "Save first").
- **`/pi/`** (the engine's page): **Up next**, the queue with who added each, ↑ to move up, × to remove, **Skip**;
  each of its looks has **Queue** beside play; the playing item's time left.
- **`/live/control`**, following the Pi: the same queue, read only, with **Open the lights** (`/pi/`); `/live` shows
  "Up next" under the title.
- **Admin → Light**: **Live library looks** on the lights (on, or baked looks only).
