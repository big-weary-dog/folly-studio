# Live rendering on the Pi: what's heavy, and how to speed it up

Measured on the dev machine (Ryzen 7 8700F, Node 22.18, loaded by other fleet jobs, so A/B numbers are the lowest of
5 alternating runs in one process). Bench: `tools/live-bench.ts` (branch `fleet/perf`). Prototypes:
`reports/perf/prototypes.patch`, each behind an env flag, worktree only.

**The rigs.** The Pi renders `rig.json` (City of Gods): **2,114 px**, which `expandRose` widens to 70,401 channels.
`rig-folly.json` is the 4,870 px one. The brief's "4,870 LEDs (City of Gods)" mixes the two up.

## Summary

| | City of Gods (Pi) | Folly rig |
|---|---|---|
| Mean tick over all 73 looks (16 sources, 51 presets, 4 Pi looks, 2 stacks) | 2.3 ms | 4.8 ms |
| `pi:heartbeat-plasma` (the Pi's default look) | 5.6–6.3 ms | 8.8–14 ms |
| Heaviest single looks (plasma, tunnel, growth, aurora, bonfire) | 4–5.5 ms | 7–12 ms |
| 3–4 layer stacks | 6–9 ms | 11–17 ms |
| First frame after a switch (nearest-LED grid build) | 60–120 ms | 100–170 ms |
| Heap allocated per frame, heavy looks | 1.5–2.7 MB (~100 MB/s) | 4–9 MB |
| heartbeat-plasma with the three exact prototypes | **−32%** (6.25 → 4.26 ms) | −35% (8.7 → 5.6) |

The coordinator's dry-run engine on this machine agrees: heartbeat-plasma renders at 5.2 ms on average, 59 ms at
worst, using 22–25% of a core, with 817 late frames an hour.

**Pi estimate (not measured; needs Phase 0 below).** Single-thread JS runs very roughly **~10× slower on a Pi 4**
(A72, 1.5–1.8 GHz) and **~3.5× slower on a Pi 5** (A76, 2.4 GHz) than this machine (Geekbench-class single-core
ratios). heartbeat-plasma would take ~60 ms on a Pi 4 and ~22 ms on a Pi 5 today, and ~43 ms and ~15 ms with the
prototypes. The budget is 25 ms a frame, shared with fppd, Studio (idle at 0.2% of a core), GC and timer jitter.
Aim for **≤ 12 ms mean and ≤ 20 ms p95 on the Pi**.
- **Pi 5:** the quick wins make every Pi look and most presets fit.
- **Pi 4:** the quick wins are not enough. It also needs layer-parallel workers and, for the heaviest looks, kernel
  work, or relay mode.

## Where the time goes (heartbeat-plasma, tunnel, 3-layer stack; CPU profile self time)

| Part | Share | Why |
|---|---|---|
| `settle` + `nearest` + `buildNear` (place.ts) | 13–17% | A warp moves every pixel. `runChain` then settles each source's pixel, a nearest-LED search over a cell's candidate list. This happens even when the source never reads LED fields (bars, clouds, fire). |
| Module code itself (`pixel`, `warp`) | 10–20% | turbulence, scroll, mirror and anchor: noise and trig per pixel. |
| `perlin3` | 8–11% | turbulence, clouds and fbm call it several times per pixel. It is already lean. |
| `fadeInto` + `labOf` + `toValue` (OKLab) | 8–15% | `mix(swatch(b), swatch(b+1))` in smooth bars, and palette ramps. A cube root ×3, then a table `toValue` ×3, for each fade. |
| `runChain` overhead (`setPixel`, `toColour`, `blendInto`, `bend`) | 10–13% | Per-pixel object writes and closure calls. |
| `ledByte` + `ledChannels` | 6–10% | `Math.pow` for each of 6,342 channels. That is 0.35 ms here and 1.0 ms on the Folly rig, every look. |
| GC | 2–3% (and the tail) | `swatch`, `pal`, `mix`, `hsv` and `hex` return a fresh array per pixel. |
| blur (presets' default `soften`) | 3–6% | Presets only; the Pi's own looks have no soften. |
| composite (add, via `addLight`) | 0.1–0.3 ms a layer | Tabled already. Not worth it. |
| flash guard | 0.05–0.2 ms | Not worth it. |
| rose expansion + power compressor | ~0.1 ms | Not worth it. |

Per-module cost, by ablation (render with that module's function made a constant, City of Gods, ms):

- **heartbeat-plasma:** turbulence 3.4, bars 2.4, heartbeat 1.1.
- **tunnel:** clouds 2.4, scroll 2.1, mirror 2.0, colour-wash 1.6, anchor 1.2.
- **growth:** turbulence 2.0, bars 1.9, reorder 1.0.

A warp's share includes the settles it causes.

## The leads, with numbers

| Lead | Verdict |
|---|---|
| Gate source `settle()` by `readsLed` (~15%?) | **Confirmed, bigger, but only gated by params.** Gating on the code regex alone gains nothing: bars, clouds, fire and lightning call `toward()`, which reads `p.u` for `along`. Gating that treats `toward()` as reading LEDs only when a param value is `along`, `petal` or `ring` (and `region()` always) gives: heartbeat-plasma render **6.6 → 4.2 ms (−36%)**, plasma −40%, growth −45%, tunnel −30%. It also drops the 100 ms grid build when nothing reads LEDs. |
| Gamma LUT in `ledByte` (~8–10%?) | **Confirmed and exact.** ledChannels 0.35 → 0.05 ms (City of Gods) and 1.0 → 0.1 ms (Folly). That is 8% of heartbeat-plasma's tick and 40–50% of a light look's (safe: 0.55 → 0.28 ms). |
| OKLab ramps as per-frame tables (~15%?) | **Not prototyped as tables.** A 256-slot OKLab memo cache, which is exact, gained **nothing**, so the cost is the fade's arithmetic, not repeated conversions. A 256-entry ramp table per slot would cut most of the 8–15% but **changes values** (see risks). |
| Reuse swatch/pal/mix arrays | **Plausible, not prototyped.** GC is 2–3% of CPU here, at ~100 MB/s of allocation. Its bigger cost is the tail: the 59 ms worst frames on this machine, more on a Pi's smaller caches. |

The gap to Folly Mix (0.33 ms for a plasma on 4,870 px) is structural: per-pixel closures, a pixel object and fresh
colour arrays, against typed-array kernels. Quick wins close maybe 1.5×, not 10×.

## Optimizations, ranked by gain per effort

"Exact" means every LED byte matches the unchanged code. The bench's `bytes#` hash was equal for all 73 looks on both
rigs, and the core tests (core, warps, warp-contract, light, standard-modules, patterns, presets, bake, pi engine,
power) pass with all three prototypes on.

| # | Change | Gain | Effort | Exact? | Risk, and the test that holds it |
|---|---|---|---|---|---|
| 1 | **Gamma table in `ledChannels`**: per channel, the least value that sends each byte (found by bisecting `ledByte` itself) plus a 4,096-slot start index | −0.3 ms a frame (CoG), −0.9 (Folly), every look | S | Yes: 0 of 1.07 billion float32 inputs differ, at 3 gamma, gain and floor settings | The table is rebuilt for each new gain. Fades change gain every frame, so use `pow` there; trims use `pow` too. Test: a dense float sweep, table against `ledByte`. |
| 2 | **Settle only for modules that read LED fields** (`needsLed`: the code regex, `region()`, and `toward()` only on an LED direction) | −30 to −45% on warp looks; ~0 elsewhere | S–M | Yes, on all library looks | A module that reads LED fields in a way the check misses gets stale LED fields: wrong colours, no error. Choice params must be fixed between prepares (they are on the Pi; check Studio's param edits re-prepare). Test: every library source and filter after a moving warp, gated against ungated, byte-equal. Add a line to SPEC "Modules" (the warp contract). |
| 3 | **Nearest-LED grid built at prepare**, and cached by pixel set across looks | First-frame spike 100–120 ms → 11–25 ms here (~1 s → ~0.2 s on a Pi 4) | S | Yes | None. On the Pi, prepare looks at start-up, not in the tick that switches (today `load()` runs inside `tick()`). |
| 4 | **Fewer per-pixel arrays**: out-param paths inside the core (`slotSwatch`, `ramp`, `walkSlot`, `toColour`), so the arrays patterns get back stay fresh | 2–5% mean, most of the GC tail | M | Yes if only core-owned arrays are reused | Aliasing if a reused array escapes to pattern code. Test: frames are hot (allocation per frame below a bound, in the bench), plus the bytes# hash. |
| 5 | **Layer-parallel `worker_threads`** on the Pi's 4 cores: each layer renders in its own worker into a SharedArrayBuffer; main composites in order, then runs the guard, ledChannels and power | ~1.5–2× on 2–4 layer looks, limited by the heaviest layer | L | Yes (same code, same order) | Pattern state is per worker (fine, it is per layer anyway); look switches and live controls must reach every worker in the same frame. Test: the bytes# hash, workers on against off. |
| 6 | OKLab ramp tables (256 per slot, rebuilt at palette or rotate changes) | ≤ 10% on palette-heavy looks | M | **No**: values move ≤ ~1/255 | Bakes made before the change stop matching live renders after it, and Studio's preview moves with it. Needs the owner's OK and a regenerated `power-golden`, if it is touched. |
| 7 | Typed-array kernels for the hot library modules (bars, turbulence, clouds), Folly Mix style | Up to 5–10× on those modules | XL | Only with care | A second module contract. Only if a Pi 4 must render the heaviest looks itself. |

The perlin3, composite, flash guard and power stages are not worth touching.

## Measuring the Pi (Phase 0 in pi/INSTALL.md)

This needs `tools/live-bench.ts` in the Pi's checkout: commit it to dev first (build plan step 1), or copy it from
`fleet/perf`. The person runs these on the Pi as `fpp`, in `/home/fpp/folly-studio`, with the show stopped:

```sh
cat /proc/device-tree/model; nproc; lscpu | grep -iE 'model name|max mhz'
vcgencmd measure_clock arm; vcgencmd measure_temp; vcgencmd get_throttled   # 0x0 = never throttled
node tools/live-bench.ts --only pi:,preset:plasma,preset:tunnel,stack --frames 400 --json ~/bench-pi.json
node tools/live-bench.ts --frames 200 > ~/bench-all.txt              # every look; ~2 min on a Pi 5
# The engine as live, beside fppd, no page, nothing sent: read fps, render ms (worst) and late from its stats lines.
npm run pi -- --dry-run --http 0 --look heartbeat-plasma --seconds 300 --stats 10
top -b -d 10 -n 6 | grep -E 'fppd|node'                              # in a second shell, during the dry run
vcgencmd get_throttled                                               # again, after 5 min of load
```

The dry run must not collide with the installed `studio-live` unit: run it while that unit is stopped, or with
`--http 0` and `--dry-run` as above, which opens no port and sends no DDP. Pass when heartbeat-plasma's tick is
≤ 12 ms mean and ≤ 20 ms p95, and the dry run shows 40 fps with `late` under 0.1% of frames over 5 minutes, with
fppd running.

## Relay mode: the Pi plays frames a laptop's browser renders

**What the browser has.** Checked in the code: the sandbox Worker's frame (`sandbox-worker.ts` `onFrame`) is
`renderFrame`'s Float32 rgb, encoded 0..1, **before any light transform**. The preview transform (`shownLight`, the
gain) happens only in the viewer. That is exactly the `rgb` the engine passes to `guard.observe` and `ledChannels`. So
the browser sends the look's values and the Pi keeps the whole output path for every frame: master, blackout and
fades; the flash guard; `ledChannels` with `pi/light.json`; the rose; the power compressor. The browser renders the
2,114 cells, and the Pi expands the rose.

**What to send** (measured over 400 frames of City of Gods):

| Format | Size a frame | At 40 fps | LED bytes that differ from the float frame |
|---|---|---|---|
| Uint16 | 12.4 KB (deflate: 11.7 for heartbeat-plasma, 6.3 for fire) | ~4 Mbit/s | 0.03–0.08%, ±1 at rounding edges |
| Uint8 | 6.2 KB | ~2 Mbit/s | **9–23%**: the gamma 2.2 curve sends input codes 0–14 as black, and only 184 of 256 output codes are reachable |
| Float32 | 24.8 KB | ~8 Mbit/s | 0 (exact) |

Send **Uint16**. The Folly rig would be ~28.5 KB a frame (~9 Mbit/s). Quantising takes ~0.1 ms in the browser.

**Latency, jitter, buffer.** Wi-Fi to the Pi is not measured: rules keep me off 192.168.8.x. Typical Wi-Fi gives a
few ms median, p99 in the tens of ms, and occasional 100–300 ms stalls (power save, channel scans). To measure it in
Phase 0, from the laptop on DustyRose, run `ping -i 0.025 -c 2400 -s 1400 <pi>` and read p50, p99 and max.
- **Buffer:** p99 jitter plus 2 frames. Start at **200 ms (8 frames)** and make it configurable.
- **Render ahead:** looks are fixed-step and deterministic in show time, so the browser can render ahead by the
  buffer, tagging each frame with its frame index. A buffer then costs nothing for a look that plays on its own.
- **Knob changes:** a knob push lands when its frame plays, one buffer later (200 ms). Stateful modules (history,
  life) cannot rewind, so a push can't skip the queue. Live control's own fades are 50 ms, so 200 ms will be felt on
  a fader. Accept it, or offer a low-latency setting (a 60–80 ms buffer) for a good link.

**Delay and disconnect.** The Pi notices by **starvation, not by the socket**. A Wi-Fi drop sends no FIN, and TCP can
take minutes to notice.
- The Pi notices on the first tick whose frame index is missing.
- It holds the last frame for up to 100 ms.
- Past that, it dips through black to its own render: the same look if it is library-only (the Pi has the library
  and the look's source), else `safe`.
- Over a ~200 ms buffer, the switch starts within ~0.3 s of the last frame sent. The relay resumes only when someone
  picks it again, or after 1 s of steady frames, never mid-flap.

**Browser throttling.**
- **Hidden tab:** the Live stage's loop is `requestAnimationFrame` (stage.ts), and the Studio preview stops when
  `document.hidden` (preview.ts), so both stop in a hidden tab. Relay must pace frames from a timer **in the sandbox
  Worker**. Chrome's background throttling hits the page's timers: at most 1 Hz after 5 minutes hidden (intensive
  throttling). Message delivery between the Worker and the page is not throttled, and the socket can stay in the page.
  To verify on real Windows Chrome in Phase 0: 10 minutes hidden, frames still at 40 fps.
- **Sleep:** a sleeping laptop stops everything. The page should take a Screen Wake Lock while relaying and say so.
  The Pi's fallback covers the rest.

**One sender at a time.** It is a lease:
- The first socket to send `relay-start` (with the PIN, if one is set) holds it. Any other is refused with who holds
  it.
- The lease ends at close, at `relay-stop`, or after 1 s of starvation.
- Today the Pi's socket takes only 1 KB text frames (`maxPayload: 1024`), and Studio's `/pi` proxy closes any binary
  frame from the page (`src/pi-preview.ts`). Relay needs a binary `frame` message, allowed only for the lease holder
  and bounded to `count × 6 + header` bytes. That means a change to SPEC-live, `pi/src/protocol.ts` and the proxy.

**What stays on the Pi, every frame:** the flash guard (a strobe dips to `safe` just as it does for a local render),
`ledChannels` with the Pi's light settings, the master, blackout and fades, the rose expansion and the power
compressor. These don't depend on what made the rgb. A relayed frame is data, so it is parsed and bounded: length
checked, values are 0..65535 by construction.

## Build plan: engine speed-ups (render on the Pi)

1. **Bench in the repo.** Commit `tools/live-bench.ts` (without `--ab`), with one line in CONTRIBUTING. Add a vitest
   that renders every library source and filter after a moving warp and after none (a few frames each) and records
   each output's byte hash. That test is the byte-equality guard for steps 2–4.
2. **Phase 0 on the Pi** (commands above). Record the model, CPU, and the bench and dry-run numbers in
   `pi/INSTALL.md`. Decide Pi 4 or Pi 5 targets from them.
3. **Gamma table** (#1): `light.ts`, exact, with `pow` while the gain changes and when trims are set. Test: a dense
   sweep, table against `ledByte`. Done when ledChannels is ≤ 0.1 ms here and bytes# is unchanged for every look.
4. **Gated settle** (#2): the SPEC "Modules" line first, then `needsLed` in `render.ts`. Done when heartbeat-plasma's
   render is ≤ 4.3 ms here (min of 5) and the step-1 test is byte-equal.
5. **Grid at prepare, prepared off the tick** (#3): build the grid in `prepareLayer` when the chain warps, cache it by
   pixel set, and prepare looks at engine start, not inside `tick()`. Done when no frame after warm-up exceeds 3× the
   mean, here and in the Pi dry run's worst ms.
6. **Allocations** (#4): core-owned out-params. Done when heavy looks allocate < 200 KB a frame and the dry run's
   worst ms is ≤ 2× its mean on the Pi.
7. **Pi 4, or still over budget:** layer workers (#5), then kernels (#7) for bars, turbulence and clouds.
   **Done for the whole plan:** on the Pi, with fppd running, every `pi/looks` look and the heaviest five presets
   tick ≤ 12 ms mean and ≤ 20 ms p95, and a 10-minute dry run holds 40 fps with late < 0.1%. On this machine, the
   heaviest Pi look's tick is ≤ 3.5 ms (Pi 5, ~3.5×) or ≤ 1.2 ms (Pi 4, ~10×).

## Build plan: relay mode (an option)

1. **Spec first.** In SPEC-live and pi/README: a relay lease (`relay-start`/`relay-stop`, PIN as `hello`), a binary
   `frame` message (u32 frame index, u32 look rev, then Uint16 rgb × count × 3), the buffer, the starvation fallback,
   and the proxy allowing binary frames from the lease holder.
2. **Pi side** (`pi/src/server.ts`, a new `pi/src/relay.ts`, `engine.ts`):
   - The lease, and a bounded jitter buffer keyed by frame index.
   - At each tick in relay mode, the engine takes that frame's rgb instead of `renderFrame`, then runs the same guard,
     ledChannels and output path.
   - On starvation: hold the last frame 100 ms, then dip to its own render.
   - Tests:
     - a scripted sender at 40 fps with injected jitter, gaps and a second sender;
     - the guard trips on a relayed strobe;
     - for the same rgb, the output bytes equal the local path's.
3. **Studio side** (Live tab):
   - A "Relay to the lights" toggle (admins and curators, as `/pi`).
   - The sandbox Worker renders ahead on its own timer, at the Pi's clock (the existing `sock.clock` offset), quantises
     to Uint16 and posts each frame.
   - The page forwards each frame to `/pi/ws`, takes a Wake Lock, and shows the buffer, misses and lease holder.
4. **Phase 0 measurement:** ping jitter over DustyRose, then 30 minutes of relay at the default buffer.
5. **Done when:**
   - the 30 minutes play at 40 fps with ≤ 0.1% of frames missing;
   - turning Wi-Fi off starts the Pi's fallback within 0.5 s;
   - a tab hidden for 10 minutes on real Windows Chrome keeps 40 fps;
   - a second sender is refused;
   - a knob push lands within buffer + 100 ms;
   - the smoke and e2e specs pass.
