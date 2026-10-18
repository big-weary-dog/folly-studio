# Folly Studio — what this is, and where it could go

## The idea in one paragraph

Anyone with an account types a show idea ("a coral reef breathing in slow blues, with fish
darting up the spires"). The idea becomes **pattern code**: small per-LED functions of space and
time, stacked as layers on groups of the cathedral, the way xLights stacks effects on model
groups. The owner sees it immediately on a WebGL model of all 4,870 LEDs, tweaks the code and
its sliders live, saves it, shares it to a gallery, and exports it toward the real Folly (an
xLights/FPP `.fseq` today, live sACN later).

## What exists in this prototype

| Piece | Where | Notes |
|---|---|---|
| The rig | `tools/build_rig.py` → `public/data/rig.json` | The one installation-specific file. The Folly's is built through `td/python/make_pixel_csv.py`, so it lights exactly the LEDs TouchDesigner, Mirage and the relay do. Adds fixtures (each arch, face, petal…), a tagged xLights-style group tree, and how Mirage draws each fixture. |
| Pattern runtime | `public/js/pattern-core.js`, `public/sandbox.html` | Stdlib, compile, layer compositing, DMX packing. Runs only in a sandboxed, network-less, cookie-less iframe. |
| Library | `public/patterns/` | A dozen geometric/maths patterns to start from and to teach the generators. |
| Studio UI | `public/index.html`, `public/js/` | Groups tree · 3D view · layers + params · code editor · transport · export. |
| Timeline | `public/js/ui/timeline*.js` | Clips with fades place each layer in time; a look runs `duration` seconds; importing a look sequences it after this one. |
| Accounts & storage | `server.js`, `src/` | Zero-dependency Node: scrypt passwords, hashed session tokens, JSON-file store, per-user ideas and looks, a shared gallery, curator role. |
| Idea → code | `src/generate/` | `sketch` (offline keyword matcher), `claude` (one API call), `fleet` (boxed worker, experimental). |
| `.fseq` export | `public/js/fseq.js` | FSEQ v2, 40 fps, 80 × 510 channels, the same addressing as the xLights layout. |

## The pattern model

A pattern is a function `pixel(p, t, P) → [r, g, b]` called for every LED, every frame. `p`
carries everything that makes the Folly interesting to address:

- **Space three ways**: whole-cathedral `x y z`, metres `X Y Z`, and `lx ly lz` normalised to the
  pixels the layer lands on (TouchDesigner's *selection* space — "a pattern fills what it lands
  on").
- **Polar on the façade**: `a` and `r` round the layer's centre — rose-window spins, spirals,
  ripples.
- **Along the wire**: `u i n` place each LED on its fixture, so chases and meteors run along
  arches and spires. (This is the "strand axis" `td/claude_docs/shows.md` lists as an open
  question.)
- **Structure**: `zone`, `fixture`, the rig's attrs (the rose's `ring` / `sector`), `is(tag)`, a stable `seed`
  per LED.

Layers composite `add` / `over` / `max` / `multiply` with a level — the same operations
`shows.md` maps to xLights' Normal/Max/Mask.

A layer is a **chain of modules**: warps move the pixel (mirror, kaleidoscope, scroll), sources draw,
filters rework the colour, some by another source (meteors masked by clouds). Every look also has
**globals**: speed as a clock (so a change never lurches, `shows.md`'s open question 7), master
level, hue and saturation, an energy and macros patterns read, a palette by role as in TouchDesigner,
and automation lanes on the timeline, so any look can be tweaked without touching code.

**Why JavaScript and not a formula language?** It's what an AI writes best and what people can
read and tweak, and frame-level state (particles, flocking, cellular automata via `frame()`)
needs a real language. The cost is that it has to be sandboxed. A natural next step is a
**formula tier**: a pure-expression subset that compiles to JS *and* to GLSL, so a look could
become a TouchDesigner GLSL TOP feeding `pixel_mapping` unchanged.

## Turning ideas into code: three tiers

1. **Sketch** (no AI): picks and tunes library patterns by keywords. Instant, free, always on —
   the fallback and the demo mode.
2. **Claude, one shot**: one Messages API call with the pattern guide, the group ids, library
   examples and the show taste from `shows.md`. Seconds, cents. Right for most ideas.
3. **Fleet, deep work**: an agent that can *iterate* — render frames headlessly, look at them,
   fix its own errors, build multi-look shows, sync to music. Minutes and dollars. Right for
   "make me a 4-minute show for this song", or for curators.

A future loop worth building: when a generated look throws in the sandbox, the studio sends the
error back to the generator for an automatic repair turn.

## Fleet: what it can do, and how it fits

What I found in `fleet/`:

- **Shape**: a coordinator Claude Code session and workers, each in its own tmux window and git
  worktree, talking through **raises** (`stuck`, `approach`, `ready`, `report`, …), gated by a
  headless **review** (PASS/FAIL recorded per head SHA), merged by the coordinator. An **OK
  board** (`localhost:8787`) posts asks to the owner.
- **Script-driven mode** is the integration point: `fleet up --no-coordinator`, then
  `fleet spawn <name> --here --brief …`, and the script reads raises from `fleet inbox` /
  `$STATE/inbox.jsonl` and answers with `fleet send`. A `report` raise hands back a file with no
  PR or review — exactly "here is your look.json".
- **Untrusted briefs** — and a stranger's show idea *is* one — go through `--box`: bubblewrap,
  no network, read-only tools snapshot (it can include Chromium for screenshots), private HOME,
  per-worker relay capped at **50 model attempts**, **30 min** wall clock, memory/CPU limits when
  systemd is available. The broker only lets the worker raise and report status.

Fit, honestly:

- ✅ The box is the right security story for running an agent on public input.
- ✅ `report` raises + the inbox give a clean, pollable hand-off.
- ⚠️ **Boxed Claude is refused today** — network isolation blocks direct API access, so only
  boxed Codex (`--model gpt-*`, via the ChatGPT subscription relay) works. Our adapter uses that.
- ⚠️ Fleet is one machine, tmux and the owner's sign-in. A public web server shouldn't shell
  into it. Better: the web app writes jobs to a queue, and a **foundry** machine running Fleet
  *pulls* jobs and posts results back. No inbound ports to the foundry.
- ⚠️ A whole agent session per idea is heavy. Use Fleet for deep requests and curator work, not
  every submission.
- 💡 Curator work fits Fleet's existing PR flow: "turn this gallery look into a TouchDesigner
  effect" or "into an xLights sequence" is a normal fleet worker on `show-builder`, reviewed and
  merged like any change.
- 💡 The **OK board** could become the curator approval queue for "run this on the real Folly".

## Getting to the real Folly

| Path | Status | How |
|---|---|---|
| `.fseq` | in the prototype | Render N seconds at 40 fps in the sandbox → FSEQ v2 → play in xLights or on FPP. Channel `(universe−1)·510 + channel` matches the xLights layout (Arch Main 1 → 19381 ✓). |
| Mirage / relay preview | next | A tiny "transmitter" (the relay in reverse): browser → WebSocket → sACN to `relay.js`, so Mirage shows a studio look, or to the F48V5 on playa. Curator-only. |
| Headless player | later | The show controller runs the studio runtime headless, playing approved look JSON straight to sACN. Looks stay source, not renders. |
| TouchDesigner | later | Formula-tier looks compile to a GLSL TOP feeding `pixel_mapping` → `folly_output`. |

## Safety and care

- **Code never runs where it can hurt**: sandboxed iframe (opaque origin, CSP `default-src
  'none'`, no cookies or network), never on the server. A watchdog reloads the sandbox if a
  pattern hangs.
- **Photosensitivity guard**: bakes fail review on large-area flashing over 3 a second (small regions
  only warn), and the live preview dims such a strobe and asks before showing it.
- **Power and white limit**: `folly_output` already caps white; the export should estimate peak
  current and apply the same limit.
- **Review gate**: only curator-`reviewed` looks are eligible for the playa.

## Roadmap

1. Timeline, next: crossfades between imported looks, and markers for sections and cues
   (`folly_cues`, `shows/show.tsv`).
2. Music: load a track, a shared clock, `beat(t, bpm)` locked to it, `.fseq` with media header.
3. Generator repair loop and "remix this look" prompts.
4. Live output to Mirage and the Folly; the formula tier and TD export.
5. Hosting: SQLite instead of JSON files, magic-link or OAuth sign-in, the foundry job queue.
