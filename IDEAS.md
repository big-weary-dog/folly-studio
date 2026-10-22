# Folly Studio — where it could go

Folly Studio turns a show idea into pattern code on the Gothic Folly, previews it on a phone or a laptop, bakes it
in a box, and exports frames a curator approved. What is built, and why, is in [DESIGN.md](DESIGN.md); this file is
the roadmap.

## Next

1. **Real hardware.** Play studio `.fseq` files (plain, sparse, zstd) on FPP and in xLights, then on the Folly
   through `sacn-play`, curator-approved bakes only.
2. **Music.** Load a track; one clock for the song and the look; `beat(t, bpm)` locked to it; `.fseq` with a media
   header.
3. **The preview matches the bake for stateful patterns.** Run `frame()` at fixed 40 fps steps in the preview.
4. **Timeline.** Crossfades between imported looks; markers for sections and cues
   (`folly_cues`, `shows/show.tsv`).
5. **Power.** Apply the limit the bake already estimates (`estPeakAmps`), as `folly_output` caps white.

## Later

- **A formula tier.** A pure-expression subset of pattern code that compiles to JS and to GLSL: a look becomes a
  TouchDesigner GLSL TOP feeding `pixel_mapping` unchanged, and rigs far larger than 4,870 LEDs preview on the GPU.
- **Fleet for deep work.** Agents that iterate on rendered frames, build multi-look shows and sync to music, for
  curators and long requests. The foundry as a pull queue: the web app writes jobs, a machine running Fleet pulls
  them and posts results back, so no inbound port reaches it.
- **Curator work in Fleet's PR flow.** "Turn this gallery look into a TouchDesigner effect" (or an xLights sequence)
  as a normal worker on `show-builder`, reviewed and merged like any change; the OK board as the approval queue for
  "run this on the real Folly".
- **Hosting.** SQLite instead of JSON files; magic-link or OAuth sign-in.
- **Beyond RGB.** RGBW pixels and other DMX fixtures in the rig's output.
