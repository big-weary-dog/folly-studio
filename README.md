# Folly Studio

A web app where people describe a light show in a sentence, get it as pattern code in layers on the Gothic
Folly's 4,870 LEDs, and shape it live on a model of the sculpture from a laptop or a phone. Looks that should play
are baked to frames in a sandbox, checked for flashing, approved by a curator and exported as `.fseq` for FPP or
xLights.

![The Studio: groups, the Playa view, layers, a module chain and the timeline](docs/screenshots/laptop-studio.jpg)

## Quick start

Node ≥ 22.18 and Python 3.

```sh
npm ci                 # the dependencies (TypeScript, Vite), exactly as package-lock.json pins them
npm start              # builds the app into dist/, then http://127.0.0.1:8780/ (data in ./data/; sign up, then
                       #   describe an idea)
npm run dev            # the same with Vite's dev server and hot reload, on http://127.0.0.1:5173/
npm run check          # typecheck, lint, then every test: green before anything is done
npm run e2e            # the Mirage match: our .fseq through sACN into Mirage, every LED compared
npm run perf           # the live preview on an emulated phone at 4× CPU slowdown
npm run build-data     # rebuild public/data/rig.json from ../pixel-map/, palettes.json from ../td/palettes/
```

- Bakes need bubblewrap (`apt install bubblewrap`) and unprivileged user namespaces; without them baking is off.
- The AI generator: `STUDIO_GENERATOR=claude` with `ANTHROPIC_API_KEY`. The default, `sketch`, works offline.
- Curators: `STUDIO_CURATORS=alice,bob`.
- `e2e` and `perf` use Playwright from `npm root -g`; `e2e` also needs `E2E_DEPS` (a folder with
  `three@0.160.0`) and `relay/node_modules`.
- Run `npm run build-data` after any change to `../pixel-map/` or the pixel CSV pipeline; never edit the
  Folly's `rig.json` by hand.

## Read next

| Document | For |
|---|---|
| [DESIGN.md](DESIGN.md) | What was built, why, the trade-offs and the limits, with screenshots |
| [SPEC.md](SPEC.md) | The contract: the rig file, pattern code, looks, the sandbox protocol, the HTTP API, baked frames |
| [docs/HOSTING.md](docs/HOSTING.md) | Running it at home: what runs where, tunnels, settings, backups |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Layout, dependencies, TypeScript, the rules and why, security invariants, budgets, adding an installation |
| [IDEAS.md](IDEAS.md) | Where it could go next |
