# Folly Studio — baked frames, where bakes run and gallery previews

Part of the [build contract](../SPEC.md).

## Baked frames

Frames are the deliverable; the server never runs look code itself, it only parses and measures
bytes a box hands back. Anything a box says about itself is kept as `boxStats: { untrusted: true }`.
In the Studio on laptop, Export → Check & bake… opens a dialog (`ui/studio/bake.tsx`) that
bakes the saved look, shows the checks (flash, peak power, length), plays the baked frames and, for a curator,
marks the look reviewed. A gallery card not yet reviewed gives a curator **Approve** (`ui/gallery/approve.tsx`): it bakes
the look unless it has a render-box bake (Baking…), then marks it reviewed if that passes; flashing asks the reason,
as here; any other failure says why and points to Check & bake.

- **Boxes.** `render-box` (authoritative): `src/render-box.ts` runs `render-box/render.ts` as its own process in a
  fresh folder (the core as one script (`src/core-script.ts`, from its source), renderer.ts, fseq.ts and rig.json
  copied beside it, `public/patterns` linked for `use`, an empty out/; the look on stdin as `{ layers, globals?,
  automation?, bpm? }`), under `env -i`, a cgroup (tasks, memory), prlimit (CPU s, file size, which caps what it
  writes; no RLIMIT_AS) and a wall-clock kill. Inside, layers run in a `node:vm` realm holding only the stdlib. Each
  frame has a 2 s CPU budget, checked after it returns; a 20 s VM wall-clock timeout stops a frame that never
  returns, even under CPU starvation. The box checks its host's PID before loading and between frames and exits if
  reparented. The server reads only `frames.fseq` and `result.json` from out/, each bounded. Library code only; the
  bake setting: `spec/frames "Where bakes run"`.
  One bake at a time, under `nice` (`STUDIO_BAKE_NICE`, default 10), in a lane it shares with wire encodes
  (`src/bake.ts` `createLane`). Both run the same core and `renderer.ts`.
- **Length.** A bake renders the look's `duration` from t = 0, honouring clips, but at most
  `STUDIO_BAKE_SECONDS` (default 120 s, ≤ 600) in the render box. `look.bake.seconds` records what was baked; a bake is
  dropped if the layers or duration change before its record is attached (after its frames are stored). The box's wall-clock and CPU budgets
  default to 30 s + 1.5 s per second baked (at least 90 s / 120 CPU s).
- **Format.** The rig's fps, sparse FSEQ v2 covering only the rig's channels, its header's `uniqueId` from the
  trusted render inputs, including the rig, look, library and frame count (so a rebake is the same bytes)
  (the Folly: 40 fps, 33 ranges, 14,610
  ch; 20 s ≈ 11.7 MB, 120 s ≈ 70 MB, where full 40,800-ch frames would be ≈ 32.6 MB for 20 s). Files are
  capped at 64 MB, or ≈ 0.6 MB a second of `STUDIO_BAKE_SECONDS` when that is more
  (`STUDIO_BAKE_MAX_FRAMES` overrides).
  Both bake writers stream the header and packed frames to disk, keeping no whole-file frame buffer.
- **Checks** (`src/frames.ts`, pure): `parseFseq(bytes, { maxBytes, maxDataBytes = maxBytes, decompress? })`
  is strict (magic, v2.x, consistent header/offset/sizes, ranges within `maxChannels` (default 80 × 510; the
  rig's frame where the host knows it), data = frames ×
  channels). Compressed files (zstd, zlib) are read only with `decompress(type, bytes, size)`
  (`src/fseq-codec.ts` `inflateBlock`: node:zlib with `maxOutputLength`): the block index must
  start at frame 0 and ascend, its lengths fill the data exactly, frames × channels ≤
  maxDataBytes before anything is inflated, and each block inflate to exactly its frames, so a
  decompression bomb is refused. Empty index entries may only pad its end (FPP preallocates).
  `analyzeFrames(parsed, scene, watch, light)` (the core's `prepareScene(rig)`, a recording `FlashWatch` and
  `ledLight(light)`, the light settings when it bakes) → `{ frames, seconds, fps, peakBrightness,
  meanBrightness, darkFraction, estPeakAmps (20 mA/channel at 5 V), coverage, flicker: { maxHz, flaggedSeconds,
  regions, ok, small: { maxHz, flaggedSeconds, regions }, limits: { perSecond, delta, area } } }`. All of it is in
  the LEDs' light: each byte is decoded by the output correction (`v^gamma`, Output) first, so brightness, power
  and darkness (every channel under 1 % of its light) are what the LEDs give, not the colour values.
  Flicker (`core/flash.ts`, which the preview's guard runs too, on the same light): WCAG 2.3.1's general flash rate
  on big swings only, a flash being a pair of opposing swings of ≥ `delta` (0.5: half the light; WCAG's is 0.1)
  with the darker side < 0.8, over `perSecond` (3) in any 1 s. An LED's light here is its brightest channel, not
  its luminance, so a full red, blue or orange strobe is a full swing (saturated red flashing is a known trigger:
  WCAG's red flash rule). The whole rig and each top-level
  group watch their mean for swings; each swing is credited to the parts that made it (the group's LEDs in each
  grid cell 1/32 of the bounds' diagonal that changed by `delta` themselves between its extremes) and is large when they cover ≥ `area` (0.25) of the LEDs, or of the lit cells seen from the
  front or the side. Flashes are counted per cell (a later change of direction), so a wave crossing the rig flashes
  each place once a pass. Flashing over the limit on a large area fails `ok` (`regions`: the top-level groups where);
  elsewhere alone (on the real map: spirelets, rose window, wash) it goes to `small`, a warning. The limits come from
  `STUDIO_FLASH_PER_SECOND`, `_DELTA` and `_AREA` (`flashSettings(config)`, `src/box-output.ts`; `FLASH` when unset or
  out of range); `STUDIO_FLASH_CHECK=off` (local use, never a public server) still measures, but large-area
  flashing only warns.
- **Stored.** `<STUDIO_DATA>/frames/<lookId>.fseq` and `look.bake = { source, status:
  queued|running|done|failed, ok, reason?, warning?, checkedAt, layersHash, renderKey?, seconds?, analysis?, frames?: {
  bytes, sha256 }, boxStats? }`. Every record is the server's own check (`verifyBake`, `src/bake.ts`, using
  `src/box-output.ts`) of the bytes it attaches, whether rendered now or reused: with the current light and flash
  settings, the frames must be
  the asked shape (the rig's step, `seconds` × fps frames, every LED's channels) and the box must not have said a
  layer failed (its words can only fail a bake, never pass one). `ok` is false when the frames are missing, malformed,
  the wrong shape, from a box that said a layer threw or gave NaN, or flash over a large area (with the check on);
  `warning` says when only small regions flash. `layersHash` = SHA-256 of `renderFields(look)`.
  Bakes are deterministic: `renderKey` = SHA-256 over `renderFields(look)`, the seconds baked and a digest of
  the box's inputs (render.ts, renderer.ts, the core's modules, fseq.ts, rig.json, the library, the
  Node version). A bake request whose key a done render-box bake with stored frames has takes those frames,
  hard-linked, and checks them again instead of baking.
- **Disk cap.** `STUDIO_FRAMES_MAX_BYTES` (default 2 GB) bounds `frames/`: past it, the bakes used least
  recently (their `.fseq` files and hash folder; use = streamed, downloaded or baked, kept in the
  `.fseq`'s mtime) are evicted, never a reviewed look's or one being encoded. The
  record stays; asking for the frames bakes them again (`bakes.restore`), refreshing the checks even when the
  bytes come out the same. The review stays; the frames' SHA and wire cache identity stay when their bytes match.
  Beside them, by content hash (`hash` = 32 hex of SHA-256 over the wire version, chunk size and
  `frames.sha256`): `frames/<hash>/<n>.br`, `manifest.json` (written last), `<n>.gz` and
  `frames.<zstd|zlib>.fseq` (both made on first request). Looks with the same frames share a
  folder; folders no bake names are pruned.
- **Wire** (`src/frames-wire.ts` encodes, `public/js/frames-stream.ts` decodes). Chunks of 80
  frames, each decodable alone: one layout byte (0 frame-major, 1 frame-major deltas, 2 planar
  i.e. channel-major, 3 planar deltas; deltas are byte-wise mod 256 from the previous frame, the
  chunk's first frame against zeros), then the frames. Brotli picks the smallest layout per chunk
  (probed at quality 5) and compresses it at `STUDIO_FRAMES_BROTLI_QUALITY` (default 9; 11 is about 12 %
  smaller for about 13× the CPU: `tools/frames-bench.ts`), once, after a bake (or on first request for
  a bake without them; the wire then says 202). Encoding, the gzip copies and compressed downloads run in one
  worker thread at nice 10, one job at a time (`src/frames-worker.ts`). The gzip copy, for clients that do
  not take br (browsers send br only over HTTPS), picks its own layout, so it has its own ETag.
  Manifest: `{ version: 1, hash, frames, fps, channels, ranges, chunkFrames, chunks: [{ bytes }],
  bytes }` (brotli sizes). Manifest and chunks are served `Cache-Control: private,
  max-age=31536000, immutable` (private: who may fetch them is checked per request, and a look can stop being
  shared), chunks with `Content-Encoding: br` (else gzip, else none) and `Vary: Accept-Encoding`.
- **Playback** (`public/js/frames-stream.ts`): manifest, then chunk 0, then play; two chunks
  ahead are fetched, a seek fetches its chunk, deltas are undone in place once per chunk, and
  frames are read without allocating. On a phone, a cellular link, Save-Data or below 4G the
  first press of Play only shows the download size; the second plays.
- **Downloads.** `?compress=1` (zstd when this Node has `zlib.zstdCompress`, else zlib), `zstd` or
  `zlib`: FSEQ v2 with 80-frame blocks (zstd level 19, zlib 9), as FPP's FSEQFile writes them;
  plain (no `compress`) is the stored file, gzip transfer-encoded.

## Where bakes run

How the render box (SPEC "Baked frames") runs, the admin's setting for how much baking may cost, and the rule that
only library code saves. `src/render-box.ts` holds the first, `src/baking.ts` the second, `src/library-gate.ts` the
third.

### Verification

Fresh renders, cache reuse and adoption of another look's frames all rerun the server's checks with the current
light and flash settings. Frames must match the requested baked length, rig step and complete sparse channel
layout. A reported layer error fails the bake; the box's own `ok` can never make it pass. Bakes use a stable FSEQ
identifier so identical rebakes have identical file hashes.

Before attaching a record, after storing its frames, the queue rechecks the look's render fields and baked length;
a look deleted or changed meanwhile gets no record, and the frames it stored are removed.
Review requires a bake of both the current render fields and `min(duration, configured bake cap)` seconds (the
default duration when omitted). Restoring evicted frames refreshes their checks while retaining the review.
Verification timestamps preserve check order even when the host's wall clock steps backward.

### The box

The render box bakes stored looks, whose code is always the library's ("Library only" below), as its own process
under prlimits, a systemd scope, `nice` and a wall clock, with an empty environment, in a stdlib-only `node:vm`
realm. Without prlimit, env or the box's files → 503. `GET /api/baking`'s `box` says whether it runs here.

### The bake setting

Admin → Baking (`/admin/baking`) sets how the render box runs, kept in `<STUDIO_DATA>/baking.json` as `{ mode }`
(any other key there is ignored) and read at each bake, so it takes effect without a restart (a
missing or broken file is `on`). **On**: as SPEC "Baked frames" says. **Throttled**: still one at a time, at `nice` 19
whatever `STUDIO_BAKE_NICE` says, and each render (a bake's or a gallery preview's) starts at least 30 s after the
last one ended, waiting outside the lane so wire encodes go on. **Off**: no render-box renders; a bake is refused
(503: "An admin turned baking off."), Check & bake's button says so, and previews come only from bakes already made.
Bakes under way finish; ones still queued fail with that reason. The page also says whether the render box runs here
(and why not).

Its routes are in SPEC "HTTP API".

### Library only

Looks take only library patterns, on every server, and nothing turns that off. A look saved (POST or PUT
/api/looks, an import) has each module name a library module by `ref`, or, with no ref the library has, carry a
library pattern's current file exactly (by SHA-256 against `public/patterns`' files the index lists, hidden ones too).
A module naming a library module is that module: code it carries is dropped for the library's current file, so an
edited or earlier copy saves as the library's (its params kept, for the pattern's upgrade hooks). A composite has no
code of its own: one whose `code` is not empty, or that has no sub-layers, is custom, and its sub-layers' modules are
checked. Anything else is refused with 403, naming the module: a ref the library lacks plainly ("Layer 2's Tendril
names tendril, which the library does not have."), other code as custom ("Only looks made of unchanged library
patterns save; Layer 2's Fire is custom code."). So tuning params, restoring a version and copying a gallery look go
on as before. The Studio has no code editor and its pickers offer only library modules. Stored looks hold refs alone
(spec/looks "Modules"), so every read, and so every bake, has library code only. A PUT or import that keeps a module
the library refuses is 403, whatever else it changes; one replacing the layers with library modules saves, as their
repair.

## Gallery previews

Each shared look gets a looping preview for its card (`src/previews/`): the Playa view from the Studio's default
camera ('fit'), with the venue, at full quality, 260 × 228 px (drawn at 2× and scaled down), sampled at ~13 fps, over the 5 s that move the most (mean change from one
sample to the next, plus a tenth of the mean brightness so a dark stretch loses), its last 0.5 s crossfaded into its
first so it loops; an animated WebP (sharp; quality 50, else 40 or 30 to stay within 300 KB), and a WebP still (the
window's brightest sample) for reduced motion. They are made off the request path, one look at a time, when a look
is shared or a shared look changes (and for every shared look at start, the gallery's top first): from the look's
bake when that is current (a look being baked waits for it), else from the render box (at most 60 s, in the bake
lane). Kept in `<STUDIO_DATA>/previews/<lookId>-<key>.webp` and `-<key>-still.webp`, `key` naming what it renders (the look, its length and the rig);
a look keeps its old preview until the new one is written, and previews of looks no longer shared go at the next
start. A look without one shows its card's glass.
Shutdown stops queuing previews and waits for startup backfill and any active preview writes before closing storage.

The camera is the app's own Viewer (`public/js/preview-camera.ts`) in a headless Chromium (playwright-core's
headless shell, `src/previews/playa.ts`), started on first use and closed after a minute idle: no window, its own
profile, no port; it serves itself the viewer's source with the types stripped, so it needs no build. It asks for
the GPU (ANGLE on EGL, with no display; under WSL, Mesa's d3d12 driver when `/dev/dxg` is there) and logs the renderer it got,
as a warning when that is a software one. `STUDIO_PREVIEWS=front` draws them flat instead (the LEDs from the front:
z across, y up), without a browser; the tests and browser checks do.
