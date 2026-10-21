# Jukebox: Play on the lights (offline phase 2) — plan

The contract is the new section **"Playing on the lights"** in `SPEC-offline.md` (SPEC.md is at its cap, untouched).
This is the short version and the order of work.

## What the queue is

The engine's (pi/), in memory: what plays now, then up to 20 queued items, played in order. Each item plays its
**whole pattern** once (its duration, or its bake's length), fading out over its last second, and the next fades in
over its first. Nothing queued: the current look loops on, as today. A flash-guard trip dips to `safe` and **pauses**
the queue until someone plays, skips or resumes. A restart empties it.

An item is one of:
- `look`: one of the engine's own (`pi/looks`), queued from `/pi/`.
- `live`: a Studio look made only of library modules, sent by Studio by `ref` with no code; the engine resolves it
  against its own library (same clone) and plays it through the flash guard, controls and all.
- `baked`: any Studio look with a current, ok bake (custom code included). The engine plays its frames.

Studio picks live when allowed, else baked, else refuses with the reason (custom code / live looks off → "bake it").

## How baked frames reach the engine

Same machine, so by file, not over the socket (a 30 s bake is ~18 MB). Studio sends `{ id, title, sha256 }`; the
engine reads `<frames>/<lookId>.fseq` from Studio's data folder (new engine setting `frames`, beside the `light`
setting that already points into `/home/fpp/folly-data`), checks the SHA-256 against what Studio sent, parses it with
`src/frames.ts`'s strict `parseFseq`, and maps the rig's channels to its LEDs. The bytes are the look's colour, so
they go out through the same light transform, master, blackout, fades and flash guard as a live look. It loads the
next item's frames ahead, async, so the frame loop never waits. Gone or changed (evicted, re-baked): the item is
skipped, saying so. The Pi bakes too, in the render box under bubblewrap, never starving the engine: one at a
time, `nice 19`, 384 MB (the Pi profile's defaults). A Pi without bubblewrap plays live looks only, and the UI
and docs say so.

## Who can add to it

Whoever may use `/pi` under the Pi profile: **curators and admins**, on any look they can open. Through Studio
(`POST /api/lights/queue`, which applies the toggle and the custom-code rule) or the engine's page at `/pi/`
(its own looks). Studio's proxy stops pages sending `send`, so the checks can't be skipped through Studio.

## The admin toggle

Admin → Light (Pi profile): **Live library looks** on the lights, on by default; off → baked looks only.
`PUT /api/admin/lights`, kept in `<STUDIO_DATA>/lights.json`. It governs what Studio sends; the engine's own
shipped looks (and `safe`) are untouched.

## Where it is in the UI

- **Studio editor** (Export menu; phone: Look tab) and **cards** on My looks and the Gallery: **Play on the lights**
  → Play now · Play next · Add to queue. Greyed with the reason when it can't play; plays the saved version.
- **`/pi/`** (engine page, the Pi's remote): an **Up next** list (title, live/baked, who added), ↑ / × per item,
  **Skip**, time left on what plays; a **Queue** button beside each of its looks.
- **`/live/control`** following the Pi: the queue read-only with a link to `/pi/`; **`/live`** shows "Up next" under
  the title. A baked item shows its title over a dark view there ("Baked: on the lights only"): `/live` viewers
  render code, and baked frames are not streamed to them in this phase.

## Steps (PRs into fleet/jukebox, then one into dev)

1. Engine: the queue, `send` for live looks, protocol and state, `/pi/` page's Up next (+ rebuilt `pi/page/dist`),
   tests.
2. Engine: baked items (`frames` setting, load/verify/play), tests with a fixture bake.
3. Studio: `/api/lights`, `/api/admin/lights` + the toggle, the feed sending (`PI_PIN`), the proxy filter, Play on the
   lights in the editor and cards, the queue on `/live/control` and `/live`. Smoke; pictures at 1366 and 390.
4. Baking on the Pi: the Pi profile's bake limits (`nice 19`, 384 MB), `npm run bake-bench`, and `pi/STUDIO.md`
   installing bubblewrap, checking user namespaces and measuring bakes in Phase 0.
5. The live page with jukebox control, phone first: `/live` on the Pi switches between the Folly and the track
   listing (now playing, up next: add, move, remove, skip), with the engine's live controls (macros, faders,
   blackout) beside them. Smoke; pictures at 1366 and 390 for each view.

## Decided

- Queuing for curators and admins (as `/pi`), not everyone signed in.
- The toggle covers Studio's sends only, not the engine's shipped looks.
- A queued look plays its entire pattern, then the next; each fades out and in.
