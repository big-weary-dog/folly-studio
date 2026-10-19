# Contributing to Folly Studio

You need Node ≥ 22.18 (it runs TypeScript by stripping the types) and Python 3; `npm ci` installs the
dependencies from `package-lock.json`. `SPEC.md` is the contract between the pieces; change it first, in the same
change.

## Run, check, regenerate

```sh
npm ci                       # the dependencies, exactly as locked (after a pull that changes the lockfile, too)
npm start                    # builds the app (vite build → dist/), then http://127.0.0.1:8780/ (PORT, HOST;
                             #   data in STUDIO_DATA, default ./data/); `node server.js` serves the last build
npm run dev                  # Vite's dev server with HMR (Preact's: components keep their state) on
                             #   http://127.0.0.1:5173/ (DEV_PORT), /api sent to the Node server on PORT
                             #   (tools/dev.mjs); the sandbox page is built on each request
npm run build                # public/ → dist/: content-hashed files, the manifest, the sandbox page
npm run check                # typecheck, lint, then every test: run it before you call anything done
npm run typecheck            # tsc -p . (checks only; nothing is emitted)
npm run lint                 # oxlint (.oxlintrc.jsonc), then node tools/budgets.mjs; exit 1 on errors
npx oxlint src/app.ts        # oxlint alone, on a file or a folder
npm test                     # vitest run: test/**/*.test.{js,ts} (vitest.config.js; a fresh build of the app
                             #   included), then every skipped test and why
npx vitest run test/core.test.js     # one file (`-t <name>` for one test); `npm run test:watch` reruns on save
npm run build-data           # rebuild public/data/rig.json from ../pixel-map/, palettes.json from ../td/palettes/
npm run smoke                # the app in Chromium at 1366 × 768 and 390 × 844: sign up, an idea, the Studio, a code
                             #   error, the timeline, a bake (Playwright Test, test/e2e/smoke.spec.js)
npm run perf                 # the preview on an emulated phone: the look's cost against a reference workload, the
                             #   phone computing it above the 20 fps floor (where the runner keeps up), Playa's Auto
                             #   stepping down on slow frames; software-GL fps only reported (test/e2e/perf.spec.js)
npm run e2e                  # our .fseq through sACN and the relay into Mirage, every LED compared byte for byte
                             #   (test/e2e/mirage.spec.js; E2E_DEPS, relay/node_modules: see "Browser checks")
```

Useful settings: `STUDIO_GENERATOR` (`sketch` default, `claude` with `ANTHROPIC_API_KEY`,
`fleet` with `STUDIO_FOUNDRY=on`), `STUDIO_CURATORS` (usernames), `STUDIO_SECURE_COOKIES=1` behind HTTPS,
`STUDIO_TRUST_PROXY=1` behind a tunnel on this machine, `STUDIO_FRAMES_BROTLI_QUALITY` (9),
`STUDIO_FRAMES_MAX_BYTES` (2GB). `docs/HOSTING.md` covers running it at home behind a tunnel, and
`npm run backup` makes a dated `.tar.gz` of the data.

The render-box tests need bubblewrap (`apt install bubblewrap`) and unprivileged user
namespaces. Without them they skip (`ctx.skip(condition, reason)`) and the run ends listing each skipped test and
why (`test/skip-reporter.js`). The data tests need `python3`. Run
`npm run build-data` after any change to `../pixel-map/`, `td/python/make_pixel_csv.py`, `td/config/` or Mirage's
`src/config.js`; `test/data.test.js` fails while `rig.json` is stale. Never edit the Folly's by hand.

## Dependencies

Use a dependency whenever it makes life easier. Pin the exact version (`npm install --save-exact`), commit
`package-lock.json` (CI installs with `npm ci`), and add a line here saying why. They are installed at setup (and
the browser's bundled at build time), never fetched at run time and never from a CDN: the app, the sandbox and the
boxes work offline on the playa. What ships to the browser is measured against its budgets (below), and the
sandbox and the boxes take only our own code and the stdlib.

| Package | Why |
|---|---|
| `typescript` 7.0.2 | `tsc` checks types (`npm run typecheck`, no emit); 7 is the native compiler, with the same CLI |
| `vite` 8.3.4 | Builds `public/` into `dist/` (hashed names, a manifest, split views and styles, the sandbox page); the dev server |
| `@types/node` 22.20.5 | The types of Node 22's built-ins, for `tsc` |
| `oxlint` 1.88.0 | The lint (`.oxlintrc.jsonc`): reads `.js` and `.ts` alike, in well under a second; `tools/budgets.mjs` does the rest |
| `vitest` 5.0.5 | Runs the tests through the app's Vite config: `.ts` and Vite's imports as the build sees them, a process per file, a watch mode |
| `@playwright/test` 1.56.1 | The browser checks (`smoke`, `perf`, `e2e`); pinned to the Chromium it drives (build 1194, as in `/opt/pw-browsers`) |
| `preact` 11.0.1 | The UI's components in TSX (5 KB gzipped): JSX builds the nodes, keyed lists and re-renders replace hand-kept DOM |
| `@preact/signals` 2.11.3 | The UI's state (the look, the selection, playback, layout): what is derived is computed, and a signal bound to text updates it without a render |
| `@preact/preset-vite` 2.10.6 | JSX for Preact in the build (Oxc) and Preact's HMR in `npm run dev` (Prefresh, dev only) |
| `@babel/core` 7.29.7 | The preset's peer: Prefresh's transform on the dev server only; nothing of it ships |
| `zod` 4.6.7 | The shapes both sides share (`shared/schemas/`): looks, the API's bodies, the generators' output and its JSON Schema; types by `z.infer` |
| `fastify` 5.12.7 | The HTTP server: routing, JSON bodies and their size limit, hooks (CSRF, caching), `trustProxy`, `inject` |
| `@fastify/cookie` 11.1.3 | Reads and sets the session cookie |
| `@fastify/rate-limit` 11.2.1 | The login limits: attempts per IP, failed ones per IP and username |
| `@fastify/static` 10.1.6 | Serves `dist/`: the build's precompressed copies, ETags and Last-Modified, ranges, no dotfiles |
| `@fastify/accept-negotiator` 2.1.1 | br or gzip from Accept-Encoding (q values, `*`) for API JSON and frame chunks, as @fastify/static picks |

### Browser checks

`npm run smoke`, `perf` and `e2e` are Playwright Test specs in `test/e2e/` (`playwright.config.js`, one test at a
time, WebGL on SwiftShader). Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` is found without
it) or from `npx playwright install chromium` (CI does this); it is never fetched while a check runs, and
`@playwright/test` moves only together with the browsers. `smoke` and `perf` start the real server on a temporary
data folder and a fresh build (`test/e2e/studio.js`); `smoke` bakes, so it needs the render box. `e2e` needs
`relay/node_modules` (`cd ../relay && npm install`), and three.js 0.160.0, which Mirage loads from a CDN: the spec
serves it from a local copy (`page.route`) in `E2E_DEPS`, a folder where `npm install three@0.160.0` was run. three
is not a devDependency on purpose: it would add 31 MB to every `npm ci`, CI's included, for a check that also needs
the relay's own install and minutes of Mirage on software GL, and so runs by hand, not in CI.

## TypeScript

`tsconfig.json` covers everything and emits nothing (`allowJs` with `checkJs` off: `.js` files are read, `.ts` and
`.tsx` files checked; JSX is Preact's, `jsxImportSource: "preact"`):
Vite builds the browser's code, and Node runs the server's, the boxes' and the tests' `.ts` as it is, stripping the
types (Node ≥ 22.18, no flag). So, enforced by `erasableSyntaxOnly` and `verbatimModuleSyntax`:

- only syntax that erases: no `enum`, `namespace`, parameter properties or `import x = require()`;
- `import type { … }` for anything used only as a type;
- relative imports name the real file, `.ts` included (`import { hash } from './stdlib.ts'`): Node maps nothing.
  `'<path>/sandbox.html?sandbox'` (its URL, `public/js/env.d.ts`) and style imports are Vite's.

oxlint parses and lints `.js`, `.mjs`, `.ts` and `.tsx` alike; `tools/budgets.mjs` checks every text file's size and
hygiene, and the line limits of the CSS, HTML and Python oxlint does not read.

The boxes take the core from its source too: `src/core-script.js` joins its modules into one script for the render
box's realm (stripping a `.ts` module's types with `node:module`), and the Fleet workspace gets copies of the
modules `check.mjs` imports, which Node runs as they are.

## Adding a new installation

Everything installation-specific is one file, `public/data/rig.json` (SPEC "Rig"); nothing else names the Folly.

1. Write a generator for it, as `tools/build_rig.py` is for the Folly (with `--check`), from the installation's
   own canonical LED list, so addresses are never typed twice. A tiny rig can be hand-written:
   `test/fixtures/rigs/mini.json` is a working example.
2. Give `axes` (its up, front and right), `output` (universes, channels per universe, colour order, fps),
   and one fixture per wire, panel, set of cells or flood, in pixel order, with `render` hints for the 3D view.
3. Group it xLights-style under one root, and tag the groups with the conventional tags (`all`, `arch`, `tower`,
   `rose`, `canopy`, `wash`, `front`, …): the library, the generators and portable looks find places by tag.
   Per-pixel numbers the patterns need (rings, sectors, rows) go in `pixels.attrs`.
4. Replace `public/data/rig.json`, point `npm run build-data` at the new generator, and run `npm run check`:
   `test/rig.test.js` holds it to the core's rules. Tests that pin the Folly (`data.test.js`, `rig-folly.test.js`,
   the counts in `core.test.js`) then read its rig from `test/fixtures/rigs/` instead.
5. Saved looks keep working where their layers carry `tags`; ones that name only the old rig's group ids need
   their groups picked again.

## Layout

| Path | Responsibility |
|---|---|
| `server.js` | Entry point: configuration from the environment, start, graceful stop |
| `src/app.ts` | `createServer()`: the store, auth, queues, frames cache, the API and the built app on one Fastify server |
| `src/api.ts`, `api-looks.ts`, `http.ts` | The HTTP API (SPEC "HTTP API"): accounts, ideas, the library and login limits; looks; its plumbing (the CSRF hook, JSON revalidated and compressed, errors as `{ error }`, 405s, the logger) |
| `src/auth.ts` | Accounts, scrypt hashes that carry their cost (re-hashed at login when older), sessions |
| `shared/schemas/` | zod schemas the server runs and the browser takes as types: `look.ts` (what a look may hold, the 400s naming the first problem), `generated.ts` (a generator's look cleaned leniently; its JSON Schema for structured output), `api.ts` (request bodies, users, ideas), `rig.ts` (the rig, the library index) |
| `src/store.js` | JSON-file storage under `STUDIO_DATA` |
| `src/static.ts` | The built app from `dist/` (@fastify/static: the precompressed copies, ETags, cache headers with `assets/` kept a year, the CSPs, the shell for SPA routes); the library and rig loaders |
| `vite.config.js`, `tools/vite-sandbox.js`, `tools/vite-compress.js`, `tools/dev.mjs` | The build (`public/` → `dist/`); the sandbox page, its scripts inlined; the `.br` and `.gz` copies of its text; `npm run dev` |
| `src/frames.js` | Pure: strict FSEQ parsing and frame analysis (brightness, flicker) |
| `src/bake.js`, `render-box.js`, `box-output.js`, `core-script.js` | The one-at-a-time bake queue and frame files; the render box under bubblewrap; what a box hands back, read as data; the core from its source for the boxes |
| `src/frames-wire.js`, `frames-cache.js`, `frames-http.ts`, `fseq-codec.js` | Baked frames on the wire: the stream encoder; the chunks and downloads kept by hash under a disk cap, made one job at a time by the encoder thread; their routes; FSEQ zstd/zlib blocks |
| `src/frames-worker.js` | The encoder thread, at nice 10 |
| `src/generate/` | Idea → look: the queue, adapters (`sketch`, `claude`, `fleet`), the prompt (cleaning: `shared/schemas/generated.ts`) |
| `render-box/render.mjs`, `renderer.mjs` | Bakes a look to `.fseq` inside bubblewrap; the frame loop it shares with `fleet-box/check.mjs` |
| `fleet-box/` | Checker and brief for a boxed Fleet worker |
| `public/index.html`, `css/` | The app shell and its styles: `base.css` (tokens, layout and components) on every page; `pages`, `studio`, `viewer`, `timeline`, `compose` imported by their views' modules, so Vite loads them with them |
| `public/sandbox.html`, `js/sandbox-relay.js`, `js/sandbox-worker.js` | The sandboxed pattern runner (SPEC "Sandbox protocol"): the page Vite inlines them into; the relay and watchdog; the Worker |
| `public/js/pattern-core.js`, `core/` | Pure: stdlib (with palettes), compile, scene (the rig, its groups and tags), timeline, render (module chains, DMX channels), globals (with automation and param bindings); re-exported; runs in the sandbox, the boxes and tests |
| `public/js/fseq.js` | Pure: FSEQ v2 writer |
| `public/js/frames-stream.js` | Streamed playback of baked frames, and their pure decoder |
| `public/js/runtime.js` | App side of the sandbox: iframe, adaptive frame rate, watchdog |
| `public/js/flash-guard.js` | Pure: the preview's flash guard, the bake check's rule on the frames shown |
| `public/js/viewer.js`, `viewer-gl.js` | The 3D view (SPEC "The 3D view"): the orbit camera, pointer and keys; the Points drawing |
| `public/js/playa/` | The Playa view, loaded on first use: `geometry.js` builds it from the rig's render hints, `renderer.js` draws (light texture, spill, bloom, tone map, tiers), `glsl.js` |
| `public/js/main.tsx`, `api.ts`, `types.ts` | The entry (renders the shell); the typed fetch wrapper; the client's view of the API's shapes |
| `public/js/ui/` | The UI, Preact components in TSX with signals for state. `app.tsx`: the shell, routing (history API, views loaded on first use) and the header, `session.ts` what views share with it (the user, navigation, the guard on unsaved edits); `auth`, `pages` (ideas, my looks, the gallery); `kit.tsx` toasts, dialogs, fields and helpers, `rose.tsx` the rose. The Studio: `studio.tsx` loads it, `studio-store.ts` holds its state (the look, replaced on each edit; the selection; layout) and saves, `studio-layout.tsx` lays out the panes; `preview.ts` drives the imperative 3D view and sandbox (one clock, the flash guard, baked playback) and `preview-view.tsx` wraps them; `layers`, `chain`, `params` (+ `bindings.ts`), `editor`, `shelf` (auditions), `look-globals`, `bake`, `export`; the timeline is `timeline.tsx` (+ `-state`, `-tools`, `-input`, `-auto`, `-model`); `layer-status.ts` is what the sandbox says; `model.ts` the rig, library and layer helpers |
| `public/patterns/` | The built-in library (`index.json` with each entry's `kind` and `category`, + one file each): sources, warps and filters, also the AI's examples |
| `tools/` | `build_rig.py` (+ `rig_render.py`: what Mirage draws), `build_palettes.py` (data), `sacn-play.mjs`, `budgets.mjs` (the checks oxlint lacks, with line budgets in `budgets.json`; oxlint's rules are `.oxlintrc.jsonc` at the root), `backup.mjs`, `frames-bench.mjs` (brotli quality against encode time) |
| `README.md`, `DESIGN.md`, `docs/` | What it is; what was built and why (`docs/screenshots/`); `docs/HOSTING.md`, hosting at home |
| `test/` | Vitest suites (`vitest.config.js`; `skip-reporter.js` lists skips and why); `fixtures/` (`build.js`: a fresh build of the app for the tests that serve it); `e2e/`: the Playwright Test browser checks (`smoke`, `perf`, `e2e`) |
| `dist/` | What `npm run build` makes; not committed |

Browser code imports only from `public/` and packages. Server code imports only `pattern-core.js`, `fseq.js`
and JSON from `public/`. Both take `shared/`: the server at run time, the browser as types only (`import type`), so
zod reaches the browser only if a view deliberately imports a schema; `shared/` itself imports only zod, itself and the
core's constants and data. oxlint checks all three, by import path.

## The rules, and why

| Rule | Why |
|---|---|
| Source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 | Small modules have one job, review well, and fit an agent's context. Patterns are AI examples, so they stay short. Over a limit, split by responsibility; never raise it. |
| Text files ≤ 64 KB (generated `rig.json` ≤ 1 MB), lines ≤ 120 | Diffs stay readable, and nothing large gets committed by accident. |
| Final newline, no trailing spaces, tabs, CRLF or BOM; valid JSON; syntax | Clean diffs, and no surprises on another machine. |
| `eval`, `Function`, `node:vm` only in the compiler (`core/compile.js`), the render box and `tools/` | Code generation is how untrusted code gets in, so it lives only behind the sandbox. |
| `child_process` only in `src/render-box.js`, `src/generate/fleet.js` and `tools/` | Processes are started only to box untrusted work. |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `dangerouslySetInnerHTML` in `public/js` | Titles and ideas are user data. Nodes built from JSX (text set as text) cannot inject markup. |
| No remote scripts, styles or imports in `public/` | It works offline on the playa, and the CSP allows only our origin. Packages are bundled by the build. |
| No `console` but `warn` and `error` in `src/` or `public/js/` | Server output goes through the logger (its one silenced line); the browser console stays quiet. |
| No `debugger`, no `.only` in tests | Leftovers that stall the app or skip the rest of the suite. |
| No secret-looking strings | Keys live in the environment, never in git. |
| No `Math.random` in `pattern-core.js`, the render box or the library | A bake must be reproducible: same look, same bytes. Use `rand`, `hash`, `noise`, `seed`. |
| Built-ins as `node:x`; the boundaries above | Server code never reaches the browser. A broken import path fails `tsc` (in `.ts`), the build or the tests. |
| oxlint's `correctness` and `suspicious` rules | Likely bugs. The few that are only noise here are off in `.oxlintrc.jsonc`, each with its reason. |
| Each area's lines of code within `tools/budgets.json` | Code shrinks by default; it grows only by a decision: raise that area's budget with a new `reason` beside it, in the same change. |

`// oxlint-disable-next-line <rule> -- <reason>` alone on the line above (or `oxlint-disable-line` at the end of
the line) silences that rule for that one line. It names its rules and the reason is mandatory: `tools/budgets.mjs`
rejects a silence without them, and any file- or block-wide `oxlint-disable`; oxlint reports one that silences
nothing. `max-lines` and the budgets' checks cannot be silenced. Who may use `eval`, `node:vm` and `child_process` is
a reviewed allowlist: the per-file overrides in `.oxlintrc.jsonc`.

## Security invariants

- **Pattern code is untrusted.** In the browser it runs in `<iframe sandbox="allow-scripts">`
  at an opaque origin, under `default-src 'none'` (no network, cookies or storage), inside a
  Worker, so a hang cannot freeze the tab; a watchdog replaces a hung worker or iframe. The app
  page and the server's own process never run it.
- **The render box** runs `render-box/render.mjs` under bubblewrap: `--unshare-all` (no
  network), `--clearenv`, read-only node and inputs, one writable `/out`, prlimits and a wall
  clock. Inside, patterns get a `node:vm` realm holding only the stdlib. No bubblewrap means
  503, never a fallback. A box's output is bytes the server parses strictly and measures.
- **CSRF.** Every mutation must be `Content-Type: application/json`, and if an `Origin` header
  is present it must match the host (the forwarded one only from a proxy on this machine, with
  `STUDIO_TRUST_PROXY`). Cookies are `SameSite=Lax`.
- **Sessions.** 32 random bytes in an `HttpOnly` cookie (`Secure` with
  `STUDIO_SECURE_COOKIES`); the store keeps only the token's SHA-256. 30-day expiry, at most 20
  per user. Passwords are hashed with scrypt at OWASP's minimum (N = 2^17, r = 8, p = 1) and per-user salts; each
  hash names its cost, and one made at less is hashed again at the next login. Logins are rate-limited per client
  address (behind the tunnel, the address it forwards), and failed ones per address and username.
- **The app page** loads only from our origin (`src/static.ts` CSP), runs no inline script (the build adds none:
  Vite's modulepreload polyfill is off) and builds DOM nodes from JSX, never HTML strings.

## Performance budgets

- As built, gzipped: the app's scripts, styles and sandbox page (`dist/assets/`) ≤ 165 KB; the login page (the
  shell, its entry and what that imports, the sign-in view) ≤ 40 KB. `test/build.test.js` measures both on a fresh
  build. Views and their styles load on first use.
- On the wire (`test/transfer.test.js`, the real server, the build and a model of a browser's cache): a cold
  Studio load (shell, modules, styles, sandbox, `rig.json`, API) ≤ 205 KB with br (240 KB gzip);
  a reload, even a day later, sends only the shell and its API calls, each a 304 (assets have
  content-hashed names, kept a year); lists carry no code, and idea polls back off.
- The Folly's 4,870 LEDs at 40 fps: the render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), skips layers outside their clips before any pixel work, and sleeps when idle.
- The sandbox answers every frame within 1.5 s or reports the layer as hung. Bakes run one at a
  time, under CPU, memory and wall-clock limits, at nice 10, never at the same time as a frame encode.
- `npm run lint` takes well under a second; keep it that way.

## Commits and pull requests

- One concern per commit, with `npm run check` green. Stage only `studio/` (and its workflow).
- Subject line: `Folly Studio: <what changed>`. The body says why, not how it got there.
- Interface changes update `SPEC.md` in the same commit. UI changes get a browser smoke test (`npm run smoke`,
  extended when the flow changes) and a screenshot in the PR (the smoke check saves one per step).
- Never commit `data/`, `.fseq` renders, keys or a hand-edited Folly `rig.json`.
- CI (`.github/workflows/studio.yml`) runs `npm ci`, the typecheck, the lint, every test, the build and
  `npm run smoke` on every push and PR that touches `studio/`, `pixel-map/` or the pixel CSV pipeline, and flags
  each skipped test, with its reason, as a warning. A separate job runs `npm run perf` and only reports.
- Commit `package-lock.json` with any change to `package.json`; never commit `dist/` or `node_modules/`.
