# Folly Studio — the sandbox protocol

Part of the [build contract](SPEC.md).

## Sandbox protocol (runtime.ts ⇄ sandbox.html)

The app embeds `<iframe sandbox="allow-scripts">` on the sandbox page, which the build makes self-contained
(`tools/vite-sandbox.ts`): `public/sandbox.html` with `js/sandbox-worker.ts` and the pattern core as one classic
script in a `<script type="text/x-folly-worker" id="pattern-worker">` data block, and `js/sandbox-relay.ts` as one
inline script, both minified, at `/assets/sandbox-<hash>.html` (runtime.ts imports its URL as
`'../sandbox.html?sandbox'`; the dev server builds it for each request at `/sandbox.html`). It is served with
`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; sandbox allow-scripts`
(opaque origin, no network, no cookies), so it loads nothing. The sandbox's first `ready` and the app's `init` go by
`postMessage(msg, '*')` (the app checks `event.source === iframe.contentWindow`); `init` carries a `MessagePort`, and
every message after it goes over that channel, both ways (Chrome takes about a millisecond to unpack each window
message between a page and an opaque-origin frame; a port's take microseconds).

Pattern code never runs on the sandbox page's thread (a same-process iframe shares the app's).
The page starts a Worker from a Blob holding the data block's script, the core and its runner, all in one function
scope (it inherits the CSP, so no network either), relays messages to it and keeps time.

| app → sandbox | sandbox → app |
|---|---|
| `{ type: 'init', rig, library? }` + a `MessagePort` (library: `[{ name, code }]` sources for `use`) | `{ type: 'ready' }` (also sent once on load, before init) |
| `{ type: 'look', layers, globals?, automation?, bpm?, clock? }` (as saved; `clock: 'fresh'`: the clock not continued from the look before, SPEC-live) | `{ type: 'compiled', layers: [{ id, ok, error?, params, modules: [{ id, ok, error?, params, upgraded? }] }] }` (`params`: the first source's schema; `upgraded`: each param a module's `upgrade()` changes, `[saved, upgraded]`, SPEC-library) |
| `{ type: 'frame', seq, t, set? }` | `{ type: 'frame', seq, rgb: Float32Array(count×3), errors: [{ id, module?, error }], ms, layerMs: { <layer id>: ms } }` (rgb transferred; `ms` the frame's, `layerMs` each layer's, timed in the worker) |
| `{ type: 'render', seq, start, frames, fps, brightness, light }` (light: the settings, Light and output; brightness: a linear cap) | `{ type: 'progress', seq, done }` … then `{ type: 'rendered', seq, channels: Uint8Array(frames × frame channels) }` |
| `{ type: 'relay', on, rev?, next?, frame?, index?, at?, fps?, duration?, lead?, set?, clock? }` (SPEC-live "Relay to the lights": the engine's slot `index` at epoch ms `at`, `frame` the look's at slot `next`, `lead` frames to render ahead; or the editor's `clock` in their place; `on: false` stops) | `{ type: 'relayed', bytes: ArrayBuffer }` (a frame as the engine takes it, transferred; untrusted: the page checks its length) |

Compute is decoupled from drawing: the app keeps one `frame` request in flight and asks at 40 fps, stepping down to
30 and then 20 while the worker's `ms` (smoothed) is over budget, 80 % of the frame interval, and back up once it is
well under the faster rate's; the 3D view draws at display rate when something changed, and idles otherwise. A layer
whose smoothed `layerMs` is over 40 % of a 40 fps frame's budget (8 ms) is marked heavy on its card.
A layer that throws or returns NaN goes black for that frame and is reported in `errors`. Live frames keep
the look's clock continuous across a new look (`prepareLook(look, previous)`); renders start it afresh, as bakes do.
A frame's `set: { values, bpm, beat0, offset, paces? }` is set in place on the prepared look first, as a live engine sets its
own (`js/live-set.ts`; SPEC-live "Following /pi"): globals and macros by name, the tempo, the downbeat, the clock, and `paces` (each pace fader's phase offset, so a
modulator's LFO stays where the Pi has it).
Watchdog (the page's): a frame, live or exported, running over 1 s, or new code compiling for
over 0.7 s, has hung. The page terminates the worker, finds the layer to blame (the one being
compiled, or each layer run alone for one frame in a throwaway worker), starts a fresh worker
without it and reports it as an error starting `Pattern hung`; it stays paused until its code
changes. Every `frame` request is answered within 1.5 s. A worker relaying renders on its own timer between
requests, at most 4 frames a turn; a respawned worker relays again at the page's next `relay`. The app (runtime.ts) tears the iframe
down and reloads it only if the page itself stops answering for 4 s (8 s during an export, while the page probes a
hung layer).

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
Uint8Array(frame channels)` (the Export dialog's .fseq and the Pi's output) and `ledLight(light?) → Float32Array(768)`
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
