# Folly Studio — the sandbox protocol

Part of the [build contract](SPEC.md).

## Sandbox protocol

Pattern code runs in a dedicated module Worker, never on the app page's thread (a `while (true) {}` there would
freeze the tab). Vite builds `js/sandbox-worker.ts` with the core into one script, `/assets/sandbox-worker-<hash>.js`,
which the server sends with its own CSP, `CSP_WORKER`: `default-src 'none'; script-src 'unsafe-eval'` (no network
and no script loads, `import()` included; `'unsafe-eval'` for the compiler's `new Function`). The worker runs at the
app's origin, so its first module (`js/worker-lockdown.ts`) deletes, before any pattern code runs, what would reach
the origin's storage, the network or other contexts from its global and `navigator`, prototypes included
(`indexedDB`, `caches`, `navigator.storage`, `navigator.locks`, `fetch`, `BroadcastChannel`, `Worker`, …). It has
no cookies or DOM, and the compiler shadows globals besides (`core/compile.ts`). The dev server sends it without a CSP.

The relay (`js/sandbox-relay.ts`, `openSandbox(toApp) → { post(msg), close() }`) runs in the app page: it starts the
worker, relays the messages below both ways (direct calls on the page's side, `postMessage` to the worker) and keeps
time. A `close()`d relay terminates its workers, the probes' too (`js/sandbox-probe.ts`), and says nothing more.

| app → relay | relay → app |
|---|---|
| `{ type: 'init', rig, library? }` (library: `[{ name, code }]` sources for `use`) | `{ type: 'ready' }` (the worker has prepared the scene) |
| `{ type: 'look', layers, globals?, automation?, bpm? }` (as saved) | `{ type: 'compiled', layers: [{ id, ok, error?, params, modules: [{ id, ok, error?, params, upgraded? }] }] }` (`params`: the first source's schema; `upgraded`: each param a module's `upgrade()` changes, `[saved, upgraded]`, SPEC-library) |
| `{ type: 'frame', seq, t }` | `{ type: 'frame', seq, rgb: Float32Array(count×3), errors: [{ id, module?, error }], ms, layerMs: { <layer id>: ms } }` (rgb transferred from the worker; `ms` the frame's, `layerMs` each layer's, timed in the worker) |
| `{ type: 'render', seq, start, frames, fps, brightness, light }` (light: the settings, Light and output; brightness: a linear cap) | `{ type: 'progress', seq, done }` … then `{ type: 'rendered', seq, channels: Uint8Array(frames × frame channels) }` |

Compute is decoupled from drawing: the app keeps one `frame` request in flight and asks at 40 fps, stepping down to
30 and then 20 while the worker's `ms` (smoothed) is over budget, 80 % of the frame interval, and back up once it is
well under the faster rate's; the 3D view draws at display rate when something changed, and idles otherwise. A layer
whose smoothed `layerMs` is over 40 % of a 40 fps frame's budget (8 ms) is marked heavy on its card.
A layer that throws or returns NaN goes black for that frame and is reported in `errors`. Live frames keep
the look's clock continuous across a new look (`prepareLook(look, previous)`); renders start it afresh, as bakes do.
Watchdog (the relay's): a frame, live or exported, running over 1 s, or new code compiling for
over 0.7 s, has hung. The relay terminates the worker, finds the layer to blame (the one being
compiled, or each layer run alone for one frame in a throwaway worker), starts a fresh worker
without it and reports it as an error starting `Pattern hung`; it stays paused until its code
changes. Every `frame` request is answered within 1.5 s. A worker that cannot load is an `error` before `ready`, and
the app stops. The app (runtime.ts) closes the relay and opens a fresh one if it stops answering for 4 s (8 s during
an export, while the relay probes a hung layer), and when an export is cancelled.

`pattern-core.ts` exports (used by the sandbox's worker, the boxes and the Node tests), and its types (`Scene`,
`PreparedLayer`, `PreparedLook`, `Compiled`, `ParamSchema`, `Pixel`, `G`, `LayerInput`, …):
`STDLIB`, `compilePattern(code) → { kind, pixel, frame, params }` (throws on syntax error / no `pixel`),
`compileModule(code, kind) → { kind, pixel | warp | filter, frame, params, picks }` (`picks`: the instance's colours,
SPEC-library "Palettes"), `readPick(value) → { groups, blend, range, rotate } | null` and `pickText(groups)` (a pick read leniently,
and as text), `readText(value) → string | null` (a text param's value: printable ASCII, at most `TEXT_MAX`, 256,
characters), `layerModules(layer) → modules`
(a layer with `code` and no `modules` → one source), `flatModules(modules) → modules` (a composite's too, depth first),
`attachedTo(modules, j) → id | null` (the source whose attached run module j may join),
`compileLayer(layer) → compiled[]` (throws `title: error`), `setLibrary([{ name,
code }])`, `prepareScene(rig) → scene` (throws on a malformed rig), `groupsByTag(scene, tag) → [group]` (outermost
first), `pixelsForGroups(scene, ids, tags?) → Int32Array` (SPEC-looks "Looks"), `tagMask(scene, tag) → Uint8Array`,
`tagCentres(scene, tag) → [[X, Y, Z]]`, `FLASH` (the default limits), `flashLimits(partial?) → limits` and
`new FlashWatch(scene, limits?, { record? })` (Baked frames, Checks), `prepareLayer(scene, layer, compiled | compiled[])
→ prepared`
(keeps `normalizeClips(layer.clips)`; a chain with spatial modules or `soften` gets its stage buffers here),
`neighbourGraph(scene) → { space, wire }` (each CSR: pixel k's neighbours `nb[off[k]]…nb[off[k + 1] − 1]` at
distances `d`, nearest first; Int32Array, Int32Array, Float32Array; cached on the scene), `MAX_RADIUS` (1.5),
`BLUR_MODES`, `DEFAULT_SOFTEN`, `prepareLook({ globals, automation, bpm }, previous?) → look`,
`renderFrame(scene, preparedLayers, t, out?, look?, result?) → { rgb, errors }` (an optional previous result reuses
its object and errors array, clearing errors each frame; level × `layerEnvelope`, or a wipe's
`transitionWeight` per pixel; skips layers at 0; allocation-free per layer; sets each prepared layer's `ms`, its time this frame), `normalizeGlobals(globals)`, `automationAt(points, t)`, `PALETTE_ROLES`,
`DEFAULT_PALETTE`, `MODULE_KINDS`, `OLD_GLOBALS`, `upgradeGlobals(look)`,
`toChannels(scene, rgb, out?) → Uint8Array(frame channels)` (in the rig's colour order, the colours as previewed:
bakes and Live), the output transform (Light and output; `core/light.ts`, the only module that reads the settings'
fields): `LIGHT` (the defaults), `lightOf(settings)` (bounded, defaults where missing), `prepareLight(scene, light?)`,
`lightByte(v, light) → 0..255` (the curve alone, white, for showing it), `ledChannels(scene, rgb, prepared, out?, cap = 1) →
Uint8Array(frame channels)` (the Export dialog's .fseq) and `ledLight(light?) → Float32Array(768)`
(each encoded byte's light per colour, 0..1, as the LEDs give it at full output), and for the
timeline `layerEnvelope(clips, t) → 0..1`, `normalizeClips(clips) → clips | null` (lenient: drops
bad and overlapping clips), `transitionWeight(…)` and `TRANSITIONS` (SPEC-looks "Timeline"),
`lookDuration(look) → seconds`, `DEFAULT_DURATION` `MIN_DURATION`
`MAX_DURATION` `MAX_CLIPS`.

`fseq.ts` exports `writeFseq({ channelCount?, frames, stepMs = 25, data: Uint8Array, media?, ranges?, compression? })
→ Uint8Array` (FSEQ v2.0). `ranges: [[startChannel, count], …]` (0-based, ascending, ≤ 255) writes a
sparse file: each frame holds only the ranged channels, so `channelCount` is their total.
`writeFseqHeader` takes the same metadata without `data` or `compression` and returns just the uncompressed
header; a streaming caller appends exactly `frames × channelCount` bytes. Both writers share the header encoder.
`compression: { type: 'zstd' | 'zlib', blocks: [{ frame, bytes }] }` writes a compressed file
instead of `data` (type 1 / 2; each block one whole zstd frame or zlib stream of its frames,
compressed by the caller; ≤ 255 blocks, so the block count's high nibble in byte 20 stays 0).
Header length = 32 + 8 × blocks (u32 first frame, u32 compressed length) + 6 × ranges (u24 start,
u24 count). `fseqBlocks(frames, per = 80) → [[first, count], …]` splits frames into ≤ 255 blocks.
`ledRanges(rig) → [[start, count], …]` is the channels the rig's LEDs use; `exportShape(rig) → { fps, stepMs,
frameChannels, ranges, used }` is what the Export dialog writes (the rig's fps, its whole frame, the LEDs' ranges and
their total), and `packFrames(full, frames, frameChannels, ranges)` squeezes rendered frames to those ranges in place.
