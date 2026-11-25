# Contributing to Folly Studio

You need Node ≥ 22.18 (it runs TypeScript by stripping the types) and Python 3; `npm ci` installs the
dependencies from `package-lock.json`. `SPEC.md` indexes the area-specific `SPEC-*.md` contracts between the pieces;
change the relevant file first, in the same change.

## Run, check, regenerate

```sh
npm ci                       # the dependencies, exactly as locked (after a pull that changes the lockfile, too)
npm start                    # builds the app (vite build → dist/), then http://127.0.0.1:8780/ (PORT, HOST;
                             #   data in STUDIO_DATA, default ./data/); `node server.ts` serves the last build
npm run dev                  # Vite's dev server with HMR (Preact's: components keep their state) on
                             #   http://127.0.0.1:5173/ (DEV_PORT), /api sent to the Node server on PORT
                             #   (tools/dev.ts)
npm run build                # public/ → dist/: content-hashed files, the manifest, the sandbox's worker
npm run check                # typecheck, lint, then every test: run it before you call anything done
npm run check:fast           # a pre-check while iterating, not the gate: typecheck, lint, the tests that import
                             #   what changed since origin/dev (and the library's when patterns or rigs did)
npm run typecheck            # tsc -p . (checks only, incremental: nothing is emitted)
npm run lint                 # oxlint (.oxlintrc.jsonc), then node tools/budgets.ts; exit 1 on errors
npx oxlint src/app.ts        # oxlint alone, on a file or a folder
npm test                     # vitest run: test/ *.test.{js,ts} (vitest.config.js; a fresh build of
                             #   the app included), then every skipped test and why
npx vitest run test/core.test.js     # one file (`-t <name>` for one test); `npm run test:watch` reruns on save
npm run build-data           # rebuild public/data/rig-folly.json (the Folly), rig.json (City of Gods), palettes.json
node tools/pattern-history.ts # refresh historical library hashes after committing library pattern changes
npm run smoke                # the app in Chromium at 1366 × 768 and 390 × 844: sign up, the Studio, a code
                             #   error, the timeline, a bake (test/e2e/smoke.spec.js), and each flow's own spec
                             #   (the `smoke` project in playwright.config.js)
npm run perf                 # the preview on an emulated phone: the look's cost against a reference workload, the
                             #   phone computing it above the 20 fps floor (where the runner keeps up), Playa's Auto
                             #   stepping down on slow frames; software-GL fps only reported (test/e2e/perf.spec.js);
                             #   a frame of each library source, three long chains and the whole library stacked,
                             #   against the same reference (library-perf.spec.js; no unit test asserts a time in ms)
npm run e2e                  # our .fseq through sACN and the relay into Mirage, every LED compared byte for byte
                             #   (test/e2e/mirage.spec.js; E2E_DEPS, relay/node_modules: see "Browser checks")
```

Useful settings: `STUDIO_ADMINS` and `STUDIO_CURATORS` (usernames), `STUDIO_SECURE_COOKIES=1`
behind HTTPS, `STUDIO_TRUST_PROXY=1` behind a tunnel on this machine, `STUDIO_FRAMES_BROTLI_QUALITY` (9),
`STUDIO_FRAMES_MAX_BYTES` (2GB). Every setting is in `src/config.ts` and docs/HOSTING.md "Every setting";
`npm run config:check -- <file>` says whether a settings file would start the server. `docs/HOSTING.md` covers
running it at home behind a tunnel, and `npm run backup` makes a dated `.tar.gz` of the data.

The render-box tests need prlimit (util-linux). Without it they skip (`ctx.skip(condition, reason)`) and the run ends listing each
skipped test and why (`test/skip-reporter.js`). The rigs come from a lighting checkout (below, "Show data");
`npm run e2e` alone needs a show-builder checkout (big-weary-dog/show-builder), for its `relay/` and `mirage/`:
`SHOW_BUILDER_DIR`, by default `../show-builder` beside this repo.

## Show data

The lighting repo (The-Gothic-Folly/lighting, John Keefe's) is the lighting system's single source of truth: the
pixel maps, the xLights shows, the Falcon's string config and the power model. Studio reads a checkout of it, never
writes one: `LIGHTING_DIR`, by default `../lighting` beside this repo (`tools/sources.py`,
`test/fixtures/sources.js`; set it in a worktree). `npm run build-data` builds `rig-folly.json`, the Folly's playa
build and the rig the Studio shows by default, from its `show-builder/pixel-map/`, and `rig.json`, City of Gods, from
its `city-of-gods/pixel-map/out/`, universes from each one's `xlights_networks.xml`; `STUDIO_RIG` (`folly`
or `cog`, SPEC "Rig") picks the one the server and the browser use. `tools/build_power.py` builds
`tools/data/power.json` (the rose's expansion) from its `pixel-map/` Python.

Lighting fits the wiring in the Falcon (virtual strings, Direction, a short strip's offset), so the channels its
xLights models and sequences use stay put, and that channel space is what Studio sends. So `tools/check_channels.py`
holds the rigs to lighting as it is: every LED on its xLights model's channels with the model's nodes running the way
our LEDs do, every Falcon string of the newest `falcon-backups/*-cog-CERTIFIED.json` on whole LEDs of ours, each rose
petal's string where its expansion (`tools/data/power.json`) puts it, and no LED dark in the Falcon but inside a strip
it trims. `test/data.test.js` runs it and `build_rig.py --check` (skipping, saying so, without a checkout), so
`npm run check` fails when lighting has moved: run `npm run build-data`, and where the channels themselves moved, see
what lighting changed before following it.

What lighting does not keep, and is only Studio's, is kept here in `tools/data/`: `output.json` (sACN, 40 fps, 510
channels a universe, as TouchDesigner sends), `views.json` (the Folly's cameras), `mirage.json` (the sizes Mirage draws
fixtures and scaffold with), and `palettes/` (the looks' palettes and their themes): Studio's choices, not the
lighting system's. `tools/pixel_rows.py` is make_pixel_csv's arithmetic (show-builder's
`td/python/make_pixel_csv.py`), the rows TouchDesigner, Mirage and the relay read. Run `npm run build-data` after
any change to them; `test/data.test.js` fails while a rig or `palettes.json` is stale. Never edit one by hand.

To add a palette, add `tools/data/palettes/<name>.csv` with `slot,colour` rows (`low1`, `body1`, `accent1`,
`high1`, numbered within each role) and sRGB `#rrggbb` swatches, then add its mood to `themes.txt`.
Run `python3 tools/build_palettes.py` to regenerate the catalogue. Mixed-family palettes can put both families
in `body`, as patina, meadow, orchid, solstice, guava and voltage do; roles need not each be a single hue.

## Dependencies

Use a dependency whenever it makes life easier. Pin the exact version (`npm install --save-exact`), commit
`package-lock.json` (checks install with `npm ci`), and add a line here saying why. They are installed at setup (and
the browser's bundled at build time), never fetched at run time and never from a CDN: the app, the sandbox and the
boxes work offline on the playa. What ships to the browser is measured against its budgets (below), and the
sandbox and the boxes take only our own code and the stdlib.

| Package | Why |
|---|---|
| `typescript` 7.0.2 | `tsc` checks types (`npm run typecheck`, no emit); 7 is the native compiler, with the same CLI |
| `vite` 8.3.4 | Builds `public/` into `dist/` (hashed names, a manifest, split views and styles, the sandbox's worker); the dev server |
| `@types/node` 22.20.5 | The types of Node 22's built-ins, for `tsc` |
| `oxlint` 1.88.0 | The lint (`.oxlintrc.jsonc`): reads `.js` and `.ts` alike, in well under a second; `tools/budgets.ts` does the rest |
| `vitest` 5.0.5 | Runs the tests through the app's Vite config: `.ts` and Vite's imports as the build sees them, a process per file, a watch mode |
| `@playwright/test` 1.56.1 | The browser checks (`smoke`, `perf`, `e2e`); pinned to the Chromium it drives (build 1194, as in `/opt/pw-browsers`) |
| `preact` 11.0.1 | The UI's components in TSX (5 KB gzipped): JSX builds the nodes, keyed lists and re-renders replace hand-kept DOM |
| `@preact/signals` 2.11.3 | The UI's state (the look, the selection, playback, layout): what is derived is computed, and a signal bound to text updates it without a render |
| `@preact/preset-vite` 2.10.6 | JSX for Preact in the build (Oxc) and Preact's HMR in `npm run dev` (Prefresh, dev only) |
| `@babel/core` 7.29.7 | The preset's peer: Prefresh's transform on the dev server only; nothing of it ships |
| `zod` 4.6.7 | The shapes both sides share (`shared/schemas/`): looks and the API's bodies; types by `z.infer` |
| `fastify` 5.12.7 | The HTTP server: routing, JSON bodies and their size limit, hooks (CSRF, caching), `trustProxy`, `inject` |
| `@fastify/cookie` 11.1.3 | Reads and sets the session cookie |
| `@fastify/rate-limit` 11.2.1 | The login limits: attempts per IP, failed ones per IP and username |
| `@fastify/static` 10.1.6 | Serves `dist/`: the build's precompressed copies, ETags and Last-Modified, ranges, no dotfiles |
| `@fastify/accept-negotiator` 2.1.1 | br or gzip from Accept-Encoding (q values, `*`) for API JSON and frame chunks, as @fastify/static picks |
| `playwright-core` 1.56.1 | Runs the headless Chromium that draws the gallery previews in the Playa view (`deploy/host.sh` installs its headless shell); the same version `@playwright/test` uses |
| `sharp` 0.35.5 | Writes the gallery previews' animated WebP from raw frames (prebuilt libvips; no ffmpeg on the host) |

### Browser checks

`npm run smoke`, `perf` and `e2e` are Playwright Test specs in `test/e2e/` (`playwright.config.js`, one test at a
time, WebGL on SwiftShader; `smoke` and `e2e` unset `DISPLAY` and `WAYLAND_DISPLAY`, since headless Chromium can hang on
a desktop display's, as under WSLg). Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` is found
without it) or from `npx playwright install chromium`; it is never fetched while a check runs, and
`@playwright/test` moves only together with the browsers. `smoke` and `perf` start the real server on a temporary
data folder and a fresh build, made once per run (`test/e2e/setup.mjs`, `studio.js`); `smoke` bakes, so it needs the render box. `e2e` needs
show-builder's `relay/node_modules` (`npm install` in its `relay/`), and three.js 0.160.0, which Mirage loads from a
CDN: the spec serves it from a local copy (`page.route`) in `E2E_DEPS`, a folder where `npm install three@0.160.0`
was run. three is not a devDependency on purpose: it would add 31 MB to every `npm ci` for a check that also needs
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
  Style imports and `new Worker(new URL(…, import.meta.url))` are Vite's.

oxlint parses and lints `.js`, `.mjs`, `.ts` and `.tsx` alike; `tools/budgets.ts` checks every text file's size and
hygiene, and the line limits of the CSS, HTML and Python oxlint does not read.

The boxes take the core from its source too: `src/core-script.ts` joins its modules into one script for the render
box's realm (stripping their types with `node:module`); the box's own script (`render.ts`) imports what sits beside
it, typed by `import type` from the repo. The server, the boxes, the tools and the core are TypeScript;
the tests stay JavaScript where they do not need types (`checkJs` is off), and library patterns are always plain
JavaScript.

## Adding a new installation

Everything installation-specific is one file, the rig `STUDIO_RIG` picks (SPEC "Rig"); nothing else names the Folly.

1. Write a generator for it, as `tools/build_rig.py` is for the Folly (with `--check`), from the installation's
   own canonical LED list, so addresses are never typed twice. A tiny rig can be hand-written:
   `test/fixtures/rigs/mini.json` is a working example.
2. Give `axes` (its up, front and right), `output` (universes, channels per universe, colour order, fps),
   and one fixture per wire, panel, set of cells or flood, in pixel order, with `render` hints for the 3D view.
3. Group it xLights-style under one root, and tag the groups with the conventional tags (`all`, `arch`, `tower`,
   `rose`, `canopy`, `wash`, `front`, …): the library and portable looks find places by tag.
   Per-pixel numbers the patterns need (rings, sectors, rows) go in `pixels.attrs`.
4. Add its file and name to `src/rig-choice.ts` and `RigName`, point `npm run build-data` at the new generator, and
   run `npm run check`:
   `test/rig.test.js` holds it to the core's rules. Tests that pin the Folly (`data.test.js`, `rig-folly.test.js`,
   the counts in `core.test.js`) read `rig-folly.json`; City of Gods is pinned by `rig-cog.test.js`.
5. Saved looks keep working where their layers carry `tags`; ones that name only the old rig's group ids need
   their groups picked again.

## Layout

| Path | Responsibility |
|---|---|
| `server.ts` | Entry point: the settings read (`readConfig()`), a bad one refused by name, start, graceful stop |
| `src/config.ts`, `tools/config-check.ts` | Every setting the server reads, parsed with zod once at start (`readConfig()`) and passed down as `Config`; a module given none parses its environment (`configOf()`); `npm run config:check` |
| `src/app.ts` | `createServer()`: the store, auth, the bake queue, frames cache, the API and the built app on one Fastify server |
| `src/api.ts`, `api-looks.ts` (+ `look-versions.ts`, its versions; `look-cap.ts`, what an account's looks hold), `account-limit.ts`, `api-account.ts` (+ `account-removal.ts`, an account deleted), `api-people.ts`, `http.ts` | The HTTP API (SPEC "HTTP API"): accounts, the library and login limits; looks; an account's own password and deletion; admins' People (roles, disabling, deleting); per-account limits (look writes, reports); its plumbing (the CSRF hook, JSON revalidated and compressed, errors as `{ error }`, the `routes()` table with each route's `public` or `role` (`forAdmins`; an `/admin` route without a role stops the server at start), 405s, the logger) |
| `src/auth.ts` | Accounts, roles (member, curator, admin), scrypt hashes that carry their cost (re-hashed at login when older), sessions; `sessionHook`, which holds each route to its config: a session unless `public` (401), and its `role` (403) |
| `shared/policy.ts` | `can(user, action, look)`: who may do what, the one answer the server and the browser both ask (the browser runs it, so it imports no zod). A look someone may not see is 404 to them |
| `shared/schemas/` | zod schemas the server runs and the browser takes as types: `look.ts` (what a look may hold, the 400s naming the first problem), `api.ts` (request bodies, users; its account limits from `public/data/account.json`, which the sign-up form shows too), `rig.ts` (the rig, the library index) |
| `shared/chain-order.ts` | Pure: looks from before the one rule converted so they render as they did (SPEC "Looks" > chain) |
| `shared/plays.ts` | What plays (`PLAYS`, `playsOf`, `playsChanged`): the one list versions, bakes, the stage, the sandbox, export and the Studio's save and undo read (SPEC "Looks"); no zod, so the browser takes it at run time |
| `src/store.ts`, `store-lock.ts`, `atomic-file.ts`, `settings-file.ts` | JSON-file storage under `STUDIO_DATA`, typed per collection; the lock keeping it to one server; every data file written whole (a unique temporary, synced, renamed; one write at a time per file); the admin's settings files (`light.json`, `baking.json`) read when they change |
| `src/clock.ts` | `monoNow()` for durations and `stamp()` for stored times: the host's wall clock can step back |
| `src/static.ts` | The built app from `dist/` (@fastify/static: the precompressed copies, ETags, cache headers with `assets/` kept a year, the CSPs, the shell for SPA routes); the library and rig loaders |
| `vite.config.js`, `tools/vite-compress.ts`, `tools/dev.ts` | The build (`public/` → `dist/`); the `.br` and `.gz` copies of its text; `npm run dev` |
| `src/frames.ts` | Pure: strict FSEQ parsing and frame analysis (brightness, flicker) |
| `src/bake.ts`, `render-box.ts`, `box-output.ts`, `core-script.ts` | The one-at-a-time bake queue and frame files; the render box, its own process under limits; what a box hands back, read as data; the core from its source for the boxes |
| `src/baking.ts`, `library-gate.ts` | `SPEC-baking.md`: the admin's bake setting (on, throttled, off) in front of the box, and its routes; the gate on saving (library modules only: by ref, or by exact file) |
| `src/frames-wire.ts`, `frames-cache.ts`, `frames-http.ts`, `fseq-codec.ts` | Baked frames on the wire: the stream encoder; the chunks and downloads kept by hash under a disk cap, made one job at a time by the encoder thread; their routes; FSEQ zstd/zlib blocks |
| `src/frames-worker.ts` | The encoder thread, at nice 10 |
| `src/stats.ts` | The request log and Admin → Stats (SPEC-access "Stats"): a journal line per request worth reading, and the day's counts kept in memory, bounded |
| `src/api-reports.ts`, `src/reports/` | F8 bug reports (SPEC "Bug reports"): their routes; `store.ts` (a folder per report, pruned by count, bytes and days), `build.ts` (the checkout's commit) |
| `render-box/render.ts`, `renderer.ts` | Bakes a look to `.fseq` in the render box; its frame loop |
| `public/index.html`, `css/` | The app shell and its styles: `base.css` (tokens, layout and components) on every page; the rest, one per view or panel, imported by their views' modules, so Vite loads them with them |
| `public/js/sandbox-relay.ts`, `js/sandbox-probe.ts`, `js/sandbox-worker.ts`, `js/worker-lockdown.ts` | The sandboxed pattern runner (SPEC "Sandbox protocol"): the relay and watchdog, on the app page; the hung-layer probes; the Worker; its first module, deleting what reaches the origin |
| `public/js/pattern-core.ts`, `core/` | Pure: stdlib (with palettes), picks (colour picks, pal() and swatch() per module), clocks (clock(): a speed param's integrated distance), compile, scene (the rig, its groups and tags), timeline, render (layers, in stages round spatial modules), chain (a chain made runnable, a composite's sub-layers as chains of their own), pass (the per-pixel pass through a chain, composites included), tree (a chain's modules as a tree: flat, mapped), warps (the one rule: a warp bends what is above it, up to a stage end), output (compositing, DMX channels), light (the one place colour values become light: the settings, the output transform, each byte's light), spatial (the neighbour graph and the native blur), links (the neighbour map: which LEDs touch, and wireDistance and rowOrder along it), globals (with automation and param bindings), flash (the flash check, for bakes and the preview alike); re-exported with their types (`Scene`, `PreparedLayer`, `Pixel`, …); runs in the sandbox, the boxes and tests |
| `public/js/fseq.ts` | Pure: FSEQ v2 writer |
| `public/js/scrub.ts` | Pure: what a bug report and the server's log tail may carry (secrets, addresses, URL queries out; sizes cut) |
| `public/js/frames-stream.ts` | Streamed playback of baked frames, and their pure decoder |
| `public/js/runtime.ts` | App side of the sandbox: the relay, adaptive frame rate, watchdog; the protocol's messages as types |
| `public/js/flash-guard.ts` | Pure: the preview's flash guard, the bake check's rule (`core/flash.ts`) on the frames shown |
| `public/js/viewer.ts`, `viewer-input.ts`, `viewer-gl.ts` | The 3D view (SPEC "The 3D view"): the orbit camera; its pointer and keys; the Points drawing |
| `public/js/playa/` | The Playa view, loaded on first use: `geometry.ts` builds it from the rig's render hints, `renderer.ts` draws (light texture, spill, bloom, tone map, tiers), `glsl.ts` |
| `public/js/main.tsx`, `api.ts` | The entry (renders the shell); the fetch wrapper, typed by `shared/schemas/`. A 401 from it (not `/me`, `/login`, `/signup`) calls `onSignedOut` (session.ts sends the person to sign in) and the call never settles, so views never handle a 401 themselves |
| `public/js/ui/` | The UI, Preact components in TSX with signals for state. `app.tsx`: the shell, routing (history API, views loaded on first use) and the header, `session.ts` what views share with it (the user, navigation, the guard on unsaved edits); `auth`, `account` (a new password, deleting the account), `pages` (my looks, the gallery), `admin` (the Admin page's tabs, over `light`, `baking`, `people`, `reports` and `stats`); `kit.tsx` toasts, dialogs, fields and helpers, `rose.tsx` the rose. The Studio: `studio.tsx` loads it, `studio-store.ts` holds its state (the look, replaced on each edit; the selection; layout) and saves, `studio-layout.tsx` lays out the panes; `preview.ts` drives the imperative 3D view and sandbox (one clock, the flash guard, baked playback) and `preview-view.tsx` wraps them; `layers`, `chain` (+ `chain-row`, `chain-tree` a composite's sub-layers nested, `composite-model.ts` its edits, `tree-drag.ts` drags in and out), `params` (+ `bindings.ts`), `picks` (colour picks, + `pick-model.ts`), `shelf` (auditions), `look-globals`, `bake`, `export`; the timeline is `timeline.tsx` (+ `-state`, `-tools`, `-input`, `-auto`, `-model`); `history/` History (`steps.ts` the session's steps and undo, in the main bundle; `button.tsx` in the bar, `history.tsx` the drawer loaded on first use, `steps-list.tsx` and `versions.tsx` its tabs); `layer-status.ts` is what the sandbox says; `model.ts` the rig, library, the Studio's `Layer` (a chain) and its helpers; `bug-report.tsx` F8 and its form (+ `report-studio.ts`, the Studio's part and its replay), `reports.tsx` the admins' Reports page |
| `public/patterns/` | The built-in library (`index.json` with each entry's `kind` and `category`, + one file each): sources, warps and filters; presets, recipes of them, in the index alone |
| `tools/` | `build_rig.py` (+ `pixel_rows.py`: the LEDs and their channels; `cog_rig.py`: City of Gods; `rig_render.py`: what Mirage draws), `check_channels.py` (the rigs against lighting's xLights and Falcon), `build_power.py` (the rose's expansion), `data/` (Studio's own show data: CONTRIBUTING "Show data"), `build_palettes.py` (data), `sacn-play.ts`, `budgets.ts` (the checks oxlint lacks, with line budgets in `budgets.json`; oxlint's rules are `.oxlintrc.jsonc` at the root), `backup.ts`, `seed-dev.ts` (a dev studio's data from the public one's), `frames-bench.ts` (brotli quality against encode time, and each look's render time), `output-bytes.ts` (each look of `bench-looks.ts`, its LED bytes hashed into `test/fixtures/output-bytes.json`, which `test/output-bytes-<rig>.test.ts` hold the engine to: re-record only for intentional pattern, rig or output-default changes), `composite-bench.ts` (a chain's cost per frame flat, as composites and with attached modules, both rigs), `bake-bench.ts` (a bake's time in the real render box: `npm run bake-bench`), `reports.ts` (F8 bug reports on this machine: `list`, `get <id>`) |
| `README.md`, `DESIGN.md`, `docs/` | What it is; what is built and why (its screenshots in `docs/screenshots/`); `docs/HOSTING.md`, hosting at home |
| `test/` | Vitest suites (`vitest.config.js`; `skip-reporter.js` lists skips and why); `fixtures/` (`build.js`: a fresh build of the app for the tests that serve it); `e2e/`: the Playwright Test browser checks (`smoke`, `perf`, `e2e`) |
| `dist/` | What `npm run build` makes; not committed |

Browser code imports only from `public/` and packages. Server code imports only `pattern-core.ts`,
`fseq.ts`, `scrub.ts` and JSON from `public/`. Both take `shared/`: the server at run time, the browser as types
only (`import type`), so zod never ships to the browser. Three pure files are the exceptions, the browser's at run
time too: `policy.ts` (who may do what, which the server asks too), `standard-modules.ts`
(the library's own titles), and `plays.ts`, since what plays must be one list that the server's versions and bakes and
the Studio's save, sandbox and export all read, and a copy in `public/` would drift. They import nothing but the
core's constants (no zod, no schema); `shared/schemas/look.ts` re-exports `plays.ts` for the server. `shared/`
otherwise imports only zod, itself and the core's constants and data. oxlint checks all of this, by import path.

## The rules, and why

| Rule | Why |
|---|---|
| Source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 | Small modules have one job, review well, and fit an agent's context. A pattern is read whole, so it stays short. Over a limit, split by responsibility; never raise it. |
| Text files ≤ 64 KB (generated rigs ≤ 1 MB), lines ≤ 120 | Diffs stay readable, and nothing large gets committed by accident. |
| Final newline, no trailing spaces, tabs, CRLF or BOM; valid JSON; syntax | Clean diffs, and no surprises on another machine. |
| `eval`, `Function`, `node:vm` only in the compiler (`core/compile.ts`), the render box and `tools/` | Code generation is how untrusted code gets in, so it lives only behind the sandbox. |
| `child_process` only in `src/render-box.ts`, `src/box-limits.ts` and `tools/` | Processes are started only to box untrusted work (an argument list, never a shell). |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `dangerouslySetInnerHTML` in `public/js` | Titles and summaries are user data. Nodes built from JSX (text set as text) cannot inject markup. |
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
  `P.colours` for one colour at a time). A module may declare a separate pick for a distinct part: Fire's `tips`
  colours its tips and embers. Code never names a role; people choose the colours.
- **Offer distinct orientations**: `direction` lists only the choices the module draws distinctly, in `DIRECTIONS`
  order (SPEC-library "Directions"); `angle` gives a free tilt where useful. Fire rises and Lightning strikes down:
  use Rotate for other orientations. A centre is a place: the `anchor` warp.
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

- **Pattern code is untrusted.** In the browser it runs in a Worker under its own CSP, `default-src 'none'` (no
  network or script loads; a worker has no cookies or DOM, and its first module deletes storage and the rest before
  any pattern code runs), so a hang cannot freeze the tab; a watchdog replaces a hung worker. The app page and the server's own process never run it.
- **The render box** runs `render-box/render.ts` as its own process under `env -i`, a systemd scope, prlimits and a
  wall clock. Inside, patterns get a `node:vm` realm holding only the stdlib. It bakes stored looks, whose modules are
  library refs, and a save takes only library modules (SPEC-baking "Library only"). A box's output is bytes the
  server parses strictly and measures.
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

- As built, gzipped: the app's scripts, styles and sandbox worker (`dist/assets/`) ≤ 350 KB; the login page (the
  shell, its entry and what that imports, the sign-in view) ≤ 40 KB. `test/build.test.js` measures both on a fresh
  build. Views and their styles load on first use, split into chunks where that comes naturally. The limits move
  only by the owner's call: Studio is a desktop-first pattern builder, so the app and a cold load are sized for a
  laptop, not a phone on the playa.
- On the wire (`test/transfer.test.js`, the real server, the build and a model of a browser's cache): a cold
  Studio load (shell, modules, styles, sandbox, the rig `/api/me` names, API) ≤ 360 KB with br (400 KB gzip);
  a reload, even a day later, sends only the shell and its API calls, each a 304 (assets have
  content-hashed names, kept a year); and lists carry no code.
- The Folly's 4,870 LEDs at 40 fps: the render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), skips layers outside their clips before any pixel work, and sleeps when idle.
- The sandbox answers every frame within 1.5 s or reports the layer as hung. Bakes run one at a
  time, under CPU, memory and wall-clock limits, at nice 10, never at the same time as a frame encode.
- `npm run lint` takes well under a second; keep it that way.

## Branches

- `dev` is where work lands: every pull request goes to it, after `npm run check`.
- `prod` is what the public server runs (`STUDIO_REF=origin/prod`, docs/HOSTING.md "Updating"). It moves only from
  `dev`, when the owner says so; then `npm run host` deploys it.

## Commits and pull requests

- One concern per commit, with `npm run check` green.
- Subject line: `Folly Studio: <what changed>`. The body says why, not how it got there.
- Interface changes update the relevant `SPEC-*.md` contract in the same commit. UI changes get a browser smoke test
  (`npm run smoke`, extended when the flow changes) and screenshots for the owner's approval. Keep screenshots outside the repo
  and the PR because the repo is public; never commit them (the smoke check saves one per step).
- Never commit `data/`, `.fseq` renders, keys or a hand-edited Folly `rig.json`.
- There is no hosted CI: `npm run check` (and `npm run smoke` for UI changes) on your machine is the gate, and the
  fleet runs the full suite again after each merge.
- Commit `package-lock.json` with any change to `package.json`; never commit `dist/` or `node_modules/`.
