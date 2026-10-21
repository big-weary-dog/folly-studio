# Contributing to Folly Studio

You need Node ≥ 22.18 (it runs TypeScript by stripping the types) and Python 3; `npm ci` installs the
dependencies from `package-lock.json`. `SPEC.md` is the contract between the pieces; change it first, in the same
change.

## Run, check, regenerate

```sh
npm ci                       # the dependencies, exactly as locked (after a pull that changes the lockfile, too)
npm start                    # builds the app (vite build → dist/), then http://127.0.0.1:8780/ (PORT, HOST;
                             #   data in STUDIO_DATA, default ./data/); `node server.ts` serves the last build
npm run dev                  # Vite's dev server with HMR (Preact's: components keep their state) on
                             #   http://127.0.0.1:5173/ (DEV_PORT), /api sent to the Node server on PORT
                             #   (tools/dev.ts); the sandbox page is built on each request
npm run build                # public/ → dist/: content-hashed files, the manifest, the sandbox page
npm run check                # typecheck, lint, then every test: run it before you call anything done
npm run typecheck            # tsc -p . (checks only; nothing is emitted)
npm run lint                 # oxlint (.oxlintrc.jsonc), then node tools/budgets.ts; exit 1 on errors
npx oxlint src/app.ts        # oxlint alone, on a file or a folder
npm test                     # vitest run: test/**/*.test.{js,ts} (vitest.config.js; a fresh build of the app
                             #   included), then every skipped test and why
npx vitest run test/core.test.js     # one file (`-t <name>` for one test); `npm run test:watch` reruns on save
npm run build-data           # rebuild public/data/rig.json (City of Gods) and rig-folly.json, palettes.json
npm run smoke                # the app in Chromium at 1366 × 768 and 390 × 844: sign up, an idea, the Studio, a code
                             #   error, the timeline, a bake (Playwright Test, test/e2e/smoke.spec.js); the Models
                             #   page and an idea on a picked model (models.spec.js, a stand-in codex); F8 bug
                             #   reports, filed and opened as captured (report.spec.js)
npm run perf                 # the preview on an emulated phone: the look's cost against a reference workload, the
                             #   phone computing it above the 20 fps floor (where the runner keeps up), Playa's Auto
                             #   stepping down on slow frames; software-GL fps only reported (test/e2e/perf.spec.js);
                             #   a frame of each library source, three long chains and the whole library stacked,
                             #   against the same reference (library-perf.spec.js; no unit test asserts a time in ms)
npm run e2e                  # our .fseq through sACN and the relay into Mirage, every LED compared byte for byte
                             #   (test/e2e/mirage.spec.js; E2E_DEPS, relay/node_modules: see "Browser checks")
```

Useful settings: `STUDIO_MODELS` (the model registry, default `data/models.json`; `ANTHROPIC_API_KEY` for Opus, the
Codex CLI for Sol and Luna), `STUDIO_ADMINS` and `STUDIO_CURATORS` (usernames), `STUDIO_SECURE_COOKIES=1` behind HTTPS,
`STUDIO_TRUST_PROXY=1` behind a tunnel on this machine, `STUDIO_FRAMES_BROTLI_QUALITY` (9),
`STUDIO_FRAMES_MAX_BYTES` (2GB). Every setting is in `src/config.ts` and docs/HOSTING.md "Every setting";
`npm run config:check -- <file>` says whether a settings file would start the server. `docs/HOSTING.md` covers
running it at home behind a tunnel, and `npm run backup` makes a dated `.tar.gz` of the data.

The render-box tests need bubblewrap (`apt install bubblewrap`) and unprivileged user
namespaces. Without them they skip (`ctx.skip(condition, reason)`) and the run ends listing each skipped test and
why (`test/skip-reporter.js`). The rigs come from a lighting checkout (below, "Show data"); `npm run e2e` alone
needs a show-builder checkout (big-weary-dog/show-builder), for its `relay/` and `mirage/`: `SHOW_BUILDER_DIR`, by
default `../show-builder` beside this repo.

## Show data

The lighting repo (The-Gothic-Folly/lighting, John Keefe's) is the lighting system's single source of truth: the
pixel maps, the xLights shows, the Falcon's string config and the power model. Studio reads a checkout of it, never
writes one: `LIGHTING_DIR`, by default `../lighting` beside this repo (`tools/sources.py`,
`test/fixtures/sources.js`; set it in a worktree). `npm run build-data` builds `rig.json` from its
`city-of-gods/pixel-map/out/` and `rig-folly.json` from its `show-builder/pixel-map/`, universes from each one's
`xlights_networks.xml`; `pi/tools/build_power.py` builds `pi/data/power.json` from its `pixel-map/` Python.

Lighting fits the wiring in the Falcon (virtual strings, Direction, a short strip's offset), so the channels its
xLights models and sequences use stay put, and that channel space is what Studio sends. So
`tools/check_channels.py` holds the rigs to lighting as it is now: every LED on its xLights model's channels with
the model's nodes running the way our LEDs do, every Falcon string of the newest
`falcon-backups/*-cog-CERTIFIED.json` on whole LEDs of ours, each rose petal's string where the Pi expands it, and
no LED dark in the Falcon but inside a strip it trims. `test/data.test.js` runs it and `build_rig.py --check`
(skipping, saying so, without a checkout), so `npm run check` fails when lighting has moved: run
`npm run build-data`, and where the channels themselves moved, see what lighting changed before following it.

What lighting does not keep, and is only Studio's, is kept here in `tools/data/`: `output.json` (sACN, 40 fps, 510
channels a universe, as TouchDesigner sends), `views.json` (the Folly's cameras), `mirage.json` (the sizes Mirage draws
fixtures and scaffold with), and `palettes/` (the looks' palettes and their themes). They came from show-builder's
`td/config/`, `td/palettes/` and `mirage/src/`; they are Studio's choices, not the lighting system's, so they live
with Studio rather than in John's repo. `tools/pixel_rows.py` is make_pixel_csv's arithmetic (show-builder's
`td/python/make_pixel_csv.py`), the rows TouchDesigner, Mirage and the relay read. Run `npm run build-data` after
any change to them; `test/data.test.js` fails while a rig or `palettes.json` is stale. Never edit one by hand.

## Dependencies

Use a dependency whenever it makes life easier. Pin the exact version (`npm install --save-exact`), commit
`package-lock.json` (checks install with `npm ci`), and add a line here saying why. They are installed at setup (and
the browser's bundled at build time), never fetched at run time and never from a CDN: the app, the sandbox and the
boxes work offline on the playa. What ships to the browser is measured against its budgets (below), and the
sandbox and the boxes take only our own code and the stdlib.

| Package | Why |
|---|---|
| `typescript` 7.0.2 | `tsc` checks types (`npm run typecheck`, no emit); 7 is the native compiler, with the same CLI |
| `vite` 8.3.4 | Builds `public/` into `dist/` (hashed names, a manifest, split views and styles, the sandbox page); the dev server |
| `@types/node` 22.20.5 | The types of Node 22's built-ins, for `tsc` |
| `@types/ws` 8.18.1 | The types of the socket @fastify/websocket hands us |
| `oxlint` 1.88.0 | The lint (`.oxlintrc.jsonc`): reads `.js` and `.ts` alike, in well under a second; `tools/budgets.ts` does the rest |
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
| `@fastify/websocket` 11.3.1 | The live stage's socket: the upgrade runs through Fastify's hooks, so the session and Origin are checked as on any route |
| `ws` 8.22.0 | The server's own socket to the Pi's engine (`src/pi-preview.ts`, `src/live/pi-feed.ts`) and the live tests' client; the version @fastify/websocket brings |
| `@fastify/accept-negotiator` 2.1.1 | br or gzip from Accept-Encoding (q values, `*`) for API JSON and frame chunks, as @fastify/static picks |
| `playwright-core` 1.56.1 | Runs the headless Chromium that draws the gallery previews in the Playa view (`deploy/host.sh` installs its headless shell); the same version `@playwright/test` uses |
| `sharp` 0.35.5 | Writes the gallery previews' animated WebP from raw frames (prebuilt libvips; no ffmpeg on the host) |

### Browser checks

`npm run smoke`, `perf` and `e2e` are Playwright Test specs in `test/e2e/` (`playwright.config.js`, one test at a
time, WebGL on SwiftShader; `smoke` and `e2e` unset `DISPLAY` and `WAYLAND_DISPLAY`, since headless Chromium can hang on
a desktop display's, as under WSLg). Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` is found
without it) or from `npx playwright install chromium`; it is never fetched while a check runs, and
`@playwright/test` moves only together with the browsers. `smoke` and `perf` start the real server on a temporary
data folder and a fresh build (`test/e2e/studio.js`); `smoke` bakes, so it needs the render box. `e2e` needs
`relay/node_modules` (`cd ../relay && npm install`), and three.js 0.160.0, which Mirage loads from a CDN: the spec
serves it from a local copy (`page.route`) in `E2E_DEPS`, a folder where `npm install three@0.160.0` was run. three
is not a devDependency on purpose: it would add 31 MB to every `npm ci` for a check that also needs
the relay's own install and minutes of Mirage on software GL, and so runs by hand, not in `check`. It refuses to start
while anything sends sACN to port 5568 (a player left running would play over its frames), and names what does.

Each run writes its screenshots and traces to a folder of its own (`STUDIO_PW_OUT`, else a new
`folly-studio-playwright-<pid>-*` in the temp folder), so runs side by side never share files. The helpers a check
starts (`e2e`'s static server, relay and player) stay in the run's process group, so Ctrl-C reaches them, and are
stopped in `afterAll`; each carries its worker's pid in its environment, and before and after every run
`test/e2e/procs.mjs` kills those whose worker has gone and removes the folders of runs that have ended.

## TypeScript

`tsconfig.json` covers everything and emits nothing (`allowJs` with `checkJs` off: `.js` files are read, `.ts` and
`.tsx` files checked; JSX is Preact's, `jsxImportSource: "preact"`):
Vite builds the browser's code, and Node runs the server's, the boxes' and the tests' `.ts` as it is, stripping the
types (Node ≥ 22.18, no flag). So, enforced by `erasableSyntaxOnly` and `verbatimModuleSyntax`:

- only syntax that erases: no `enum`, `namespace`, parameter properties or `import x = require()`;
- `import type { … }` for anything used only as a type;
- relative imports name the real file, `.ts` included (`import { hash } from './stdlib.ts'`): Node maps nothing.
  `'<path>/sandbox.html?sandbox'` (its URL, `public/js/env.d.ts`) and style imports are Vite's.

oxlint parses and lints `.js`, `.mjs`, `.ts` and `.tsx` alike; `tools/budgets.ts` checks every text file's size and
hygiene, and the line limits of the CSS, HTML and Python oxlint does not read.

The boxes take the core from its source too: `src/core-script.ts` joins its modules into one script for the render
box's realm (stripping their types with `node:module`), and the Fleet workspace gets copies of the modules
`check.ts` imports, which Node runs as they are; the boxes' own scripts (`render.ts`, `check.ts`) import what sits
beside them, typed by `import type` from the repo. The server, the boxes, the tools and the core are TypeScript;
the tests stay JavaScript where they do not need types (`checkJs` is off), and library patterns are always plain
JavaScript.

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
   the counts in `core.test.js`) read `rig-folly.json`; City of Gods is pinned by `rig-cog.test.js`.
5. Saved looks keep working where their layers carry `tags`; ones that name only the old rig's group ids need
   their groups picked again.

## Layout

| Path | Responsibility |
|---|---|
| `server.ts` | Entry point: the settings read (`readConfig()`), a bad one refused by name, start, graceful stop |
| `src/config.ts`, `tools/config-check.ts` | Every setting the server reads, parsed with zod once at start (`readConfig()`) and passed down as `Config`; a module given none parses its environment (`configOf()`); `npm run config:check` |
| `src/app.ts` | `createServer()`: the store, auth, queues, frames cache, the API and the built app on one Fastify server |
| `src/api.ts`, `api-looks.ts` (+ `look-versions.ts`, its versions), `api-models.ts`, `api-access.ts`, `http.ts` | The HTTP API (SPEC "HTTP API"): accounts, ideas (and their long polls), the library and login limits; looks; the models; invite codes and people; its plumbing (the CSRF hook, JSON revalidated and compressed, errors as `{ error }`, the `routes()` table with each route's `public` or `role` (`forAdmins`; an `/admin` route without a role stops the server at start), 405s, the logger) |
| `src/auth.ts` | Accounts, roles (member, curator, admin), scrypt hashes that carry their cost (re-hashed at login when older), sessions; `sessionHook`, which holds each route to its config: a session unless `public` (401), and its `role` (403) |
| `shared/policy.ts` | `can(user, action, look)`: who may do what, the one answer the server and the browser both ask (the browser runs it, so it imports no zod). A look someone may not see is 404 to them |
| `shared/schemas/` | zod schemas the server runs and the browser takes as types: `look.ts` (what a look may hold, the 400s naming the first problem), `generated.ts` (a generator's look cleaned leniently; its JSON Schema for structured output), `api.ts` (request bodies, users, ideas; its account limits from `public/data/account.json`, which the sign-up form shows too), `rig.ts` (the rig, the library index), `models.ts` (the model registry, and `TRANSPORT_CAPS`: what each transport may do), `access.ts` (limits, invite and person bodies) |
| `shared/chain-order.ts` | Pure: looks from before the one rule converted so they render as they did (SPEC "Looks" > chain) |
| `shared/plays.ts` | What plays (`PLAYS`, `playsOf`, `playsChanged`): the one list versions, bakes, the stage, the sandbox, export and the Studio's save and undo read (SPEC "Looks"); no zod, so the browser takes it at run time |
| `shared/idea-status.ts` | Pure, so the browser imports it too: an idea's states (`IDEA_STATUS`), `isPending()` and `transition()`, which refuses a move that is not one |
| `src/store.ts` | JSON-file storage under `STUDIO_DATA`, typed per collection; `store-lock.ts` keeps it to one server |
| `src/clock.ts` | `monoNow()` for durations and `serverNow()` (the wall clock at boot, then monotonic) for Live: the host's wall clock can step back |
| `src/static.ts` | The built app from `dist/` (@fastify/static: the precompressed copies, ETags, cache headers with `assets/` kept a year, the CSPs, the shell for SPA routes); the library and rig loaders |
| `vite.config.js`, `tools/vite-sandbox.ts`, `tools/vite-compress.ts`, `tools/dev.ts` | The build (`public/` → `dist/`); the sandbox page, its scripts inlined; the `.br` and `.gz` copies of its text; `npm run dev` |
| `src/frames.ts` | Pure: strict FSEQ parsing and frame analysis (brightness, flicker) |
| `src/bake.ts`, `render-box.ts`, `box-output.ts`, `core-script.ts` | The one-at-a-time bake queue and frame files; the render box under bubblewrap; what a box hands back, read as data; the core from its source for the boxes |
| `src/frames-wire.ts`, `frames-cache.ts`, `frames-http.ts`, `fseq-codec.ts` | Baked frames on the wire: the stream encoder; the chunks and downloads kept by hash under a disk cap, made one job at a time by the encoder thread; their routes; FSEQ zstd/zlib blocks |
| `src/frames-worker.ts` | The encoder thread, at nice 10 |
| `src/live/` | The live stage (`SPEC-live.md`): `state.ts` (pure: show time, pushes as lanes, loops), `hub.ts` (the sockets, presence, limits, `live.json`), `routes.ts` (the socket and its settings) |
| `src/api-reports.ts`, `src/reports/` | F8 bug reports (SPEC "Bug reports"): their routes; `store.ts` (a folder per report, pruned by count, bytes and days), `build.ts` (the checkout's commit) |
| `src/access.ts` | Who may use the paid models, and how much (SPEC-access "Access"): invite codes kept hashed, each account's ideas counted against the limits, the daily ceiling |
| `src/generate/` | Idea → look: the queue (a lane per transport), the model registry (`models.ts`), adapters (`adapters.ts` maps each transport to its module, which exports its adapter and `probe()`: `sketch`, `claude`, `codex` with `proc.ts` for its one CLI call, `fleet`; a new transport is a row in `TRANSPORT_CAPS`, one there and its module), the prompt (`prompt.ts`, its text in `guide.ts`), the library as vocabulary (`catalog.ts`, the answer's schema `composition.ts`, its expansion into a look `expand.ts`; cleaning: `shared/schemas/generated.ts`) |
| `render-box/render.ts`, `renderer.ts` | Bakes a look to `.fseq` inside bubblewrap; the frame loop it shares with `fleet-box/check.ts` |
| `fleet-box/` | Checker and brief for a boxed Fleet worker |
| `public/index.html`, `css/` | The app shell and its styles: `base.css` (tokens, layout and components) on every page; `pages`, `studio`, `viewer`, `timeline`, `compose`, `live`, `jukebox` (the engine's controls and queue, on `/pi/` and `/live`), `reports` (with the bug report form) imported by their views' modules, so Vite loads them with them |
| `public/sandbox.html`, `js/sandbox-relay.ts`, `js/sandbox-worker.ts` | The sandboxed pattern runner (SPEC "Sandbox protocol"): the page Vite inlines them into; the relay and watchdog; the Worker |
| `public/js/pattern-core.ts`, `core/` | Pure: stdlib (with palettes), picks (colour picks, pal() and swatch() per module), clocks (clock(): a speed param's integrated distance), compile, scene (the rig, its groups and tags), timeline, render (module chains, in stages round spatial modules), warps (the one rule: a warp bends what is above it, up to a stage end), output (compositing, DMX channels), light (the one place colour values become light: the settings, the output transform, each byte's light), spatial (the neighbour graph and the native blur), links (the neighbour map: which LEDs touch, and wireDistance and rowOrder along it), globals (with automation and param bindings), flash (the flash check, for bakes and the preview alike); re-exported with their types (`Scene`, `PreparedLayer`, `Pixel`, …); runs in the sandbox, the boxes and tests |
| `public/js/fseq.ts` | Pure: FSEQ v2 writer |
| `public/js/scrub.ts` | Pure: what a bug report and the server's log tail may carry (secrets, addresses, URL queries out; sizes cut) |
| `public/js/frames-stream.ts` | Streamed playback of baked frames, and their pure decoder |
| `public/js/runtime.ts` | App side of the sandbox: iframe, adaptive frame rate, watchdog; the protocol's messages as types |
| `public/js/flash-guard.ts` | Pure: the preview's flash guard, the bake check's rule (`core/flash.ts`) on the frames shown |
| `public/js/viewer.ts`, `viewer-input.ts`, `viewer-gl.ts` | The 3D view (SPEC "The 3D view"): the orbit camera; its pointer and keys; the Points drawing |
| `public/js/playa/` | The Playa view, loaded on first use: `geometry.ts` builds it from the rig's render hints, `renderer.ts` draws (light texture, spill, bloom, tone map, tiers), `glsl.ts` |
| `public/js/main.tsx`, `api.ts` | The entry (renders the shell); the fetch wrapper, typed by `shared/schemas/`. A 401 from it (not `/me`, `/login`, `/signup`) calls `onSignedOut` (session.ts sends the person to sign in) and the call never settles, so views never handle a 401 themselves |
| `public/js/ui/` | The UI, Preact components in TSX with signals for state. `app.tsx`: the shell, routing (history API, views loaded on first use) and the header, `session.ts` what views share with it (the user, navigation, the guard on unsaved edits); `auth`, `pages` (ideas, my looks, the gallery), `admin` (the Admin page's tabs, over `models`, `access`, `light` and `reports`); `kit.tsx` toasts, dialogs, fields and helpers, `rose.tsx` the rose. The Studio: `studio.tsx` loads it, `studio-store.ts` holds its state (the look, replaced on each edit; the selection; layout) and saves, `studio-layout.tsx` lays out the panes; `preview.ts` drives the imperative 3D view and sandbox (one clock, the flash guard, baked playback) and `preview-view.tsx` wraps them; `layers`, `chain`, `params` (+ `bindings.ts`), `picks` (colour picks, + `pick-model.ts`), `editor`, `shelf` (auditions), `look-globals`, `bake`, `export`; the timeline is `timeline.tsx` (+ `-state`, `-tools`, `-input`, `-auto`, `-model`); `history/` History (`steps.ts` the session's steps and undo, in the main bundle; `button.tsx` in the bar, `history.tsx` the drawer loaded on first use, `steps-list.tsx` and `versions.tsx` its tabs); `layer-status.ts` is what the sandbox says; `model.ts` the rig, library, the Studio's `Layer` (a chain) and its helpers; `live/` the live stage (`live.tsx` /live, `jukebox.tsx` its jukebox on the Pi, on `pi/page`'s parts, `control.tsx` and `fader.tsx` /live/control, `socket.ts` its socket and clock, `stage.ts` the view and sandbox on that clock, `lanes.ts` the state's browser twin); `bug-report.tsx` F8 and its form (+ `report-studio.ts`, the Studio's part and its replay), `reports.tsx` the admins' Reports page |
| `public/patterns/` | The built-in library (`index.json` with each entry's `kind` and `category`, + one file each): sources, warps and filters, also the AI's examples; presets, recipes of them, in the index alone |
| `tools/` | `build_rig.py` (+ `pixel_rows.py`: the LEDs and their channels; `cog_rig.py`: City of Gods; `rig_render.py`: what Mirage draws), `check_channels.py` (the rigs against lighting's xLights and Falcon), `data/` (Studio's own show data: CONTRIBUTING "Show data"), `build_palettes.py` (data), `sacn-play.ts`, `budgets.ts` (the checks oxlint lacks, with line budgets in `budgets.json`; oxlint's rules are `.oxlintrc.jsonc` at the root), `backup.ts`, `seed-dev.ts` (a dev studio's data from the public one's), `frames-bench.ts` (brotli quality against encode time, and each look's render time), `bake-bench.ts` (a bake's time in the real render box under a profile's limits: `npm run bake-bench`), `reports.ts` (F8 bug reports on this machine: `list`, `get <id>`) |
| `README.md`, `DESIGN.md`, `docs/` | What it is; what was built and why (`docs/screenshots/`); `docs/HOSTING.md`, hosting at home |
| `test/` | Vitest suites (`vitest.config.js`; `skip-reporter.js` lists skips and why); `fixtures/` (`build.js`: a fresh build of the app for the tests that serve it); `e2e/`: the Playwright Test browser checks (`smoke`, `perf`, `e2e`) |
| `dist/` | What `npm run build` makes; not committed |

Browser code imports only from `public/` and packages. Server code imports only `pattern-core.ts`, `fseq.ts`,
`scrub.ts` and JSON from `public/`. Both take `shared/`: the server at run time, the browser as types only (`import
type`), so zod never ships to the browser. Four pure files are the exceptions, the browser's at run time too:
`idea-status.ts` (an idea's states), `policy.ts` (who may do what, which the server asks too), `standard-modules.ts`
(the library's own titles), and `plays.ts`, since what plays must be one list that the server's versions and bakes and
the Studio's save, sandbox and export all read, and a copy in `public/` would drift. They import nothing but the
core's constants (no zod, no schema); `shared/schemas/look.ts` re-exports `plays.ts` for the server. `shared/`
otherwise imports only zod, itself and the core's constants and data. oxlint checks all of this, by import path.

## The rules, and why

| Rule | Why |
|---|---|
| Source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 | Small modules have one job, review well, and fit an agent's context. Patterns are AI examples, so they stay short. Over a limit, split by responsibility; never raise it. |
| Text files ≤ 64 KB (generated rigs ≤ 1 MB), lines ≤ 120 | Diffs stay readable, and nothing large gets committed by accident. |
| Final newline, no trailing spaces, tabs, CRLF or BOM; valid JSON; syntax | Clean diffs, and no surprises on another machine. |
| `eval`, `Function`, `node:vm` only in the compiler (`core/compile.ts`), the render box and `tools/` | Code generation is how untrusted code gets in, so it lives only behind the sandbox. |
| `child_process` only in `src/render-box.ts`, `src/generate/fleet.ts`, `src/generate/proc.ts` and `tools/` | Processes are started only to box untrusted work, or for a generator's one CLI call (an argument list, never a shell). |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `dangerouslySetInnerHTML` in `public/js` | Titles and ideas are user data. Nodes built from JSX (text set as text) cannot inject markup. |
| No remote scripts, styles or imports in `public/` | It works offline on the playa, and the CSP allows only our origin. Packages are bundled by the build. |
| No `console` but `warn` and `error` in `src/` or `public/js/` | Server output goes through the logger (its one silenced line); the browser console stays quiet. |
| No `debugger`, no `.only` in tests | Leftovers that stall the app or skip the rest of the suite. |
| No secret-looking strings | Keys live in the environment, never in git. |
| No `Math.random` in `pattern-core.ts`, the render box or the library | A bake must be reproducible: same look, same bytes. Use `rand`, `hash`, `noise`, `seed`. |
| Built-ins as `node:x`; the boundaries above | Server code never reaches the browser. A broken import path fails `tsc` (in `.ts`), the build or the tests. |
| oxlint's `correctness` and `suspicious` rules | Likely bugs. The few that are only noise here are off in `.oxlintrc.jsonc`, each with its reason. |
| Each area's lines of code within `tools/budgets.json` | Code shrinks by default; it grows only by a decision: raise that area's budget with a new `reason` beside it, in the same change. |

`// oxlint-disable-next-line <rule> -- <reason>` alone on the line above (or `oxlint-disable-line` at the end of
the line) silences that rule for that one line. It names its rules and the reason is mandatory: `tools/budgets.ts`
rejects a silence without them, and any file- or block-wide `oxlint-disable`; oxlint reports one that silences
nothing. `max-lines` and the budgets' checks cannot be silenced. Who may use `eval`, `node:vm` and `child_process` is
a reviewed allowlist: the per-file overrides in `.oxlintrc.jsonc`.

## The library

A module is one idea; two ideas are two modules, and what they make together is a preset (SPEC "Library"). So a
library module follows these rules (SPEC "Palettes", "Directions", "Integrated clocks", "Modules"):

- **One `colours` pick**, `{ value: 'all', type: 'color', label: 'Colours' }`, read by position (`swatch('colours', i)`
  for bands and seeded things, `pal('colours', t)` for a gradient or a tail, the last colour for a head,
  `P.colours` for one colour at a time). Code never names a role; people choose the colours.
- **An orientation is a param**: `direction` from `DIRECTIONS`, read with `toward(p, P.direction)`, its default
  what the module always did; `angle` for a free angle off it. A centre is a place: the `anchor` warp.
- **Motion from `clock('speed')`**, never `t × P.speed`, so a modulated speed never jumps. No hard-wired `G.energy`
  or other macro: a person binds a param to one.
- **Draw on transparent**: alpha is coverage, `null` is nothing, no painted background. `colour-wash` is the bed.
- **Say it plainly.** A summary, a header comment and a label say what it draws and how it moves, in one short
  sentence where they can, in the UI's words (Colours, Direction, Speed): "Bands of colour move in Direction.", not
  "a tide of light". No imagery, no selling.

## What to test

Test where a regression is plausible and costly: determinism (played equals sought), the clock under modulation,
what a look stores and how it migrates (schemas, conversions frozen byte for byte), geometry that is easy to get
wrong, presets and their insertion, security. One representative case per behaviour, not a matrix. Do not test what
restates the implementation: defaults, labels, every param of every module. A test that cannot fail is cost, not
cover.

## Security invariants

- **Pattern code is untrusted.** In the browser it runs in `<iframe sandbox="allow-scripts">`
  at an opaque origin, under `default-src 'none'` (no network, cookies or storage), inside a
  Worker, so a hang cannot freeze the tab; a watchdog replaces a hung worker or iframe. The app
  page and the server's own process never run it.
- **The render box** runs `render-box/render.ts` under bubblewrap: `--unshare-all` (no
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

- As built, gzipped: the app's scripts, styles and sandbox page (`dist/assets/`) ≤ 256 KB; the login page (the
  shell, its entry and what that imports, the sign-in view) ≤ 40 KB. `test/build.test.js` measures both on a fresh
  build. Views and their styles load on first use. Raised from 165 KB for pictures: a picture param kind,
  checked in the engine with errors an agent repairs from, and edited in Studio (+2 KB); then for the ideas API
  (+0.5 KB) and the venue's props round the rig in the 3D view, a chunk loaded on first use (+1.6 KB); and
  for rose regions, the stdlib's region() and regions(), which mask and stained glass share (+282 B);
  and for the ideas lever: Quick, Explore or Deep on the idea form with each level's time and line, kept per
  browser, and an idea's level and what it took (+0.7 KB). Raised to 200 KB by the owner's call (2026-10-20):
  headroom for features; views still split into chunks loaded on first use where that comes naturally. Raised to
  220 KB by the owner's call (2026-10-20), for the frame buffer and more headroom. Raised to 240 KB by the owner's
  call (2026-10-20): the previews' light and the Admin page took it to 221 KB; headroom again.
  Raised to 256 KB by the owner's call (2026-10-20): the tutorial, a chunk loaded on first use (+8 KB), took it
  to 244 KB.
- On the wire (`test/transfer.test.js`, the real server, the build and a model of a browser's cache): a cold
  Studio load (shell, modules, styles, sandbox, `rig.json`, API) ≤ 230 KB with br (270 KB gzip; raised from 220 and
  260 for the History drawer, with headroom, by the owner's standing call on size);
  a reload, even a day later, sends only the shell and its API calls, each a 304 (assets have
  content-hashed names, kept a year); lists carry no code, and idea polls back off.
- The Folly's 4,870 LEDs at 40 fps: the render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), skips layers outside their clips before any pixel work, and sleeps when idle.
- The sandbox answers every frame within 1.5 s or reports the layer as hung. Bakes run one at a
  time, under CPU, memory and wall-clock limits, at nice 10, never at the same time as a frame encode.
- `npm run lint` takes well under a second; keep it that way.

## Branches

- `dev` is where work lands: every pull request goes to it, after `npm run check`.
- `prod` is what the public server runs (`STUDIO_REF=origin/prod`, docs/HOSTING.md "Updating") and what the Pi's
  Studio Live pulls (pi/INSTALL.md). It moves only from `dev`, when the owner says so; then `npm run host` deploys it.

## Commits and pull requests

- One concern per commit, with `npm run check` green.
- Subject line: `Folly Studio: <what changed>`. The body says why, not how it got there.
- Interface changes update `SPEC.md` in the same commit. UI changes get a browser smoke test (`npm run smoke`,
  extended when the flow changes) and a screenshot in the PR (the smoke check saves one per step).
- Never commit `data/`, `.fseq` renders, keys or a hand-edited Folly `rig.json`.
- There is no hosted CI: `npm run check` (and `npm run smoke` for UI changes) on your machine is the gate, and the
  fleet runs the full suite again after each merge.
- Commit `package-lock.json` with any change to `package.json`; never commit `dist/` or `node_modules/`.
