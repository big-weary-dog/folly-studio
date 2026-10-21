# Folly Studio — where it could go

Folly Studio turns a show idea into pattern code on the Gothic Folly, previews it on a phone or a laptop, bakes it
in a box, and exports frames a curator approved. What is built, and why, is in [DESIGN.md](DESIGN.md); this file is
the roadmap.

## Done

From the first design notes, now built (the DESIGN.md section in brackets):

- The rig file: any installation, a tagged group tree, proven on a fictional rig too (§9).
- Pattern code: space three ways, polar on the façade, along the wire, structure fields (§3).
- Module chains, globals, palette roles from `td/palettes`, modulation, automation lanes (§4).
- The library as single ideas: modules on one set of rules (`public/patterns/index.json`), and presets for what took two (§4).
- Blur and soften: a native spatial filter on the rig's neighbours, soft edges by default (§4).
- Colour picks: every colour param takes roles, slots, literals, blend, range and rotate; one `colours` per source (§4).
- The timeline: clips with fades on show time, importing looks to sequence them (§5).
- The sandboxed preview, the render box, curator review of baked frames, the flash checks and guard (§6).
- Sparse `.fseq`, streamed frames, compressed downloads, `tools/sacn-play.ts`, the Mirage match (§7, §8).
- The Playa view, Mirage's look from the rig's render hints, in quality tiers (§10).
- Three generators: sketch, Claude with structured output, the opt-in Fleet foundry (§11).
- Home hosting: hashed assets, caches, low-priority bakes, a disk cap, backups (§12).

## Next

1. **Real hardware.** Play studio `.fseq` files (plain, sparse, zstd) on FPP and in xLights, then on the Folly
   through `sacn-play`, curator-approved bakes only.
2. **Music.** Load a track; one clock for the song and the look; `beat(t, bpm)` locked to it; `.fseq` with a media
   header.
3. **A repair loop.** When a generated look throws in the sandbox, send the error back to the generator for a fix;
   "remix this look" prompts.
4. **The preview matches the bake for stateful patterns.** Run `frame()` at fixed 40 fps steps in the preview.
5. **Timeline.** Automation of module params; crossfades between imported looks; markers for sections and cues
   (`folly_cues`, `shows/show.tsv`).
6. **Power.** Apply the limit the bake already estimates (`estPeakAmps`), as `folly_output` caps white.
7. **Presets as the generators' vocabulary.** Let a generated layer name a preset by ref (its modules' code filled
   in by the server), so the AI composes from recipes instead of copying code.

## Later

- **A formula tier.** A pure-expression subset of pattern code that compiles to JS and to GLSL: a look becomes a
  TouchDesigner GLSL TOP feeding `pixel_mapping` unchanged, and rigs far larger than 4,870 LEDs preview on the GPU.
- **Live output.** A curator-only transmitter: browser → WebSocket → sACN to `relay.js`, so Mirage or the F48V5
  shows a studio look live.
- **A headless player.** The show controller plays approved looks straight to sACN; looks stay source, not renders.
- **Fleet for deep work.** Agents that iterate on rendered frames, build multi-look shows and sync to music, for
  curators and long requests. The foundry as a pull queue: the web app writes jobs, a machine running Fleet pulls
  them and posts results back, so no inbound port reaches it.
- **Curator work in Fleet's PR flow.** "Turn this gallery look into a TouchDesigner effect" (or an xLights sequence)
  as a normal worker on `show-builder`, reviewed and merged like any change; the OK board as the approval queue for
  "run this on the real Folly".
- **Hosting.** SQLite instead of JSON files; magic-link or OAuth sign-in.
- **Beyond RGB.** RGBW pixels and other DMX fixtures in the rig's output.
