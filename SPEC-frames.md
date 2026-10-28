# Folly Studio — baked frames

Part of the [build contract](SPEC.md).

## Baked frames

Frames are the deliverable; the server never runs look code itself, it only parses and measures
bytes a box hands back. Anything a box says about itself is kept as `boxStats: { untrusted: true }`.
In the Studio on laptop, Export → Check & bake… opens a dialog (`ui/bake.tsx`) that
bakes the saved look, shows the checks (flash, peak power, length), plays the baked frames and, for a curator,
marks the look reviewed. A gallery card not yet reviewed gives a curator **Approve** (`ui/approve.tsx`): it bakes
the look unless it has a render-box bake (Baking…), then marks it reviewed if that passes; flashing asks the reason,
as here; any other failure says why and points to Check & bake.

- **Boxes.** `render-box` (authoritative): `src/render-box.ts` runs `render-box/render.ts` under bubblewrap
  (`--unshare-all`, no network, `--clearenv`, read-only node + its libraries + the core as one script
  (`src/core-script.ts`, from its source) / renderer.ts / fseq.ts / rig.json / `public/patterns` (for `use`), tmpfs
  /tmp, one empty writable /out; the look on stdin as `{ layers, globals?, automation?, bpm? }`), a cgroup (tasks,
  memory), prlimit (CPU s, file size; no RLIMIT_AS) and a wall-clock kill. Inside, layers run in a `node:vm` realm
  holding only the stdlib (defence in depth). Each frame has a 2 s CPU budget, checked after it returns;
  a 20 s VM wall-clock timeout stops a frame that never returns, even under CPU starvation.
  Without bubblewrap, the box checks its host's PID before loading and between frames and exits if reparented;
  a hung frame still has the same 20 s wall-clock limit.
  /out is a 1 MB tmpfs inside the box with only `frames.fseq` and
  `result.json` bound to the host, so each is capped by the file-size limit and nothing else the box writes reaches
  the host's disk. Without bubblewrap, library only; the bake setting and custom code: `SPEC-baking.md`.
  One bake at a time, under `nice` (`STUDIO_BAKE_NICE`, default 10), in a lane it shares with wire encodes
  (`src/bake.ts` `createLane`). `fleet-box` (advisory): the Fleet worker's own `frames.fseq` + `stats.json` (its `use`
  library: `patterns/` beside check.ts, else none). All three run the same core and `renderer.ts`.
- **Length.** A bake renders the look's `duration` from t = 0, honouring clips, but at most
  `STUDIO_BAKE_SECONDS` (hosted default 120 s, Pi default 600 s, ≤ 600) in the render box; `fleet-box/check.ts --bake`
  does the same (`--seconds` overrides). `look.bake.seconds` records what was baked; a bake is
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
  `parseFseqHeader(headerBytes, { fileBytes, maxBytes?, maxChannels? })` applies the same uncompressed metadata
  and size checks without reading the data, returning the metadata and `dataOffset` for file-backed playback.
  `analyzeFrames(parsed, scene, watch, light)` (the core's `prepareScene(rig)`, a recording `FlashWatch` and
  `ledLight(light)`, the light settings when it bakes; frames.ts imports only types, so the Fleet box runs a copy) → `{ frames, seconds, fps, peakBrightness,
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
  `.fseq`'s mtime) are evicted, never a reviewed look's, a fleet-box bake's or one being encoded. The
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
