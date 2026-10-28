# Folly Studio

A web app where people describe a light show in a sentence, get it as pattern code in layers on the Gothic Folly
(City of Gods' 2,114 LEDs by default; the playa build's 4,870), and shape it live on a model of the sculpture from a
laptop or a phone. Looks that should play are baked to frames in a sandbox, checked for flashing, approved by a
curator and exported as `.fseq` for FPP or xLights.

![The Studio: the Groups drawer beside the Playa view, layers, a module chain and the timeline](docs/screenshots/laptop-studio.jpg)

## Quick start

Node ≥ 22.18 and Python 3.

```sh
npm ci                 # the dependencies, exactly as package-lock.json pins them
npm start              # builds the app into dist/, then http://127.0.0.1:8780/ (data in ./data/; sign up, then
                       #   describe an idea)
npm run dev            # the same with Vite's dev server and hot reload, on http://127.0.0.1:5173/
npm run check          # typecheck, lint, then every test: green before anything is done
```

- Bakes need bubblewrap (`apt install bubblewrap`) and unprivileged user namespaces; without them only looks made
  of unchanged library patterns bake (SPEC-baking). Admins can throttle baking or turn it off (Admin › Baking).
- Models: people pick one per idea from `data/models.json` (Opus with `ANTHROPIC_API_KEY`; Sol and Luna through the
  Codex CLI after `codex login`). Admins (`STUDIO_ADMINS=you`) change it under Admin › Models; docs/HOSTING.md
  "Models" has the file and the setup.
- Curators: `STUDIO_CURATORS=alice,bob`.
- The rigs come from a lighting checkout (The-Gothic-Folly/lighting, `LIGHTING_DIR`, by default `../lighting`):
  `npm run build-data` after its pixel maps change; never edit a rig by hand.
- CONTRIBUTING has every command (the browser checks `smoke`, `perf` and `e2e`, and what they need), the settings
  and the show data.

## Read next

| Document | For |
|---|---|
| [DESIGN.md](DESIGN.md) | What is built, why, the trade-offs and the limits |
| [SPEC.md](SPEC.md) | The contract's entry point, ground rules and links to each area |
| [SPEC-rig.md](SPEC-rig.md) | The rig file, 3D view, light and output |
| [SPEC-looks.md](SPEC-looks.md) | Saved looks and the timeline |
| [SPEC-sandbox.md](SPEC-sandbox.md) | The sandbox protocol, core exports and FSEQ helpers |
| [SPEC-http.md](SPEC-http.md) | Static files, updates and the HTTP API |
| [SPEC-frames.md](SPEC-frames.md) | Baked frames: rendering, checks, storage, streaming and downloads |
| [SPEC-library.md](SPEC-library.md) | The contract's pattern code: the pixel, the stdlib, modules and the warp contract, the library, globals, palettes |
| [SPEC-generators.md](SPEC-generators.md) | The contract's generators, model registry and access (invite codes, limits) |
| [docs/HOSTING.md](docs/HOSTING.md) | Running it at home: what runs where, tunnels, settings, backups |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Layout, dependencies, TypeScript, the rules and why, security invariants, budgets, adding an installation |
| [IDEAS.md](IDEAS.md) | Where it could go next |
