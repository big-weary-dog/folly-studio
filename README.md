# Folly Studio

A web app where people describe a light show in a sentence, get it as pattern code in layers on the Gothic Folly
(City of Gods' 2,114 LEDs by default; the playa build's 4,870), and shape it live on a model of the sculpture from a
laptop or a phone. Looks that should play are baked to frames in a sandbox, checked for flashing, approved by a
curator and exported as `.fseq` for FPP or xLights.

![The Studio: the Groups drawer beside the Playa view, layers, a module chain and the timeline](docs/screenshots/laptop-studio.jpg)

## Quick start

Node ≥ 22.18 and Python 3.

```sh
npm ci                 # the dependencies (TypeScript, Vite), exactly as package-lock.json pins them
npm start              # builds the app into dist/, then http://127.0.0.1:8780/ (data in ./data/; sign up, then
                       #   describe an idea)
npm run dev            # the same with Vite's dev server and hot reload, on http://127.0.0.1:5173/
npm run check          # typecheck, lint, then every test: green before anything is done
npm run smoke          # the app in a browser at a laptop's and a phone's size, sign-up to bake
npm run e2e            # the Mirage match: our .fseq through sACN into Mirage, every LED compared
npm run perf           # the live preview on an emulated phone at 4× CPU slowdown
npm run build-data     # rebuild public/data/rig.json (City of Gods) and rig-folly.json, palettes.json
```

- Bakes need bubblewrap (`apt install bubblewrap`) and unprivileged user namespaces; without them baking is off.
- Models: people pick one per idea from `data/models.json` (Opus with `ANTHROPIC_API_KEY`; Sol and Luna through the
  Codex CLI after `codex login`; Sketch offline). Admins (`STUDIO_ADMINS=you`) change it on the Models page.
  docs/HOSTING.md "Models" has the file and the setup.
- Curators: `STUDIO_CURATORS=alice,bob`.
- `smoke`, `perf` and `e2e` run on Playwright Test with its Chromium (`npx playwright install chromium`, or
  `PLAYWRIGHT_BROWSERS_PATH`); `e2e` also needs `E2E_DEPS` (a folder with `three@0.160.0`) and
  `relay/node_modules`.
- Run `npm run build-data` after any change to `../city-of-gods/pixel-map/`, `../pixel-map/` or the pixel CSV
  pipeline; never edit a rig by hand.

## Read next

| Document | For |
|---|---|
| [DESIGN.md](DESIGN.md) | What was built, why, the trade-offs and the limits, with screenshots |
| [SPEC.md](SPEC.md) | The contract: the rig file, looks, the sandbox protocol, the HTTP API, baked frames |
| [SPEC-library.md](SPEC-library.md) | The contract's pattern code: the pixel, the stdlib, modules and the warp contract, the library, globals, palettes |
| [SPEC-generators.md](SPEC-generators.md) | The contract's generators, model registry and access (invite codes, limits) |
| [docs/HOSTING.md](docs/HOSTING.md) | Running it at home: what runs where, tunnels, settings, backups |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Layout, dependencies, TypeScript, the rules and why, security invariants, budgets, adding an installation |
| [IDEAS.md](IDEAS.md) | Where it could go next |
