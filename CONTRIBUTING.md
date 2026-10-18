# Contributing to Folly Studio

Folly Studio has no dependencies: you need Node ≥ 22 and Python 3, and `npm install` does
nothing. `SPEC.md` is the contract between the pieces; change it first, in the same change.

## Run, check, regenerate

```sh
npm start                    # http://127.0.0.1:8780/ (PORT, HOST; data in STUDIO_DATA, default ./data/)
npm run check                # lint, then every test: run it before you call anything done
npm run lint                 # node tools/lint.mjs: `path:line rule message`, exit 1 on errors
node tools/lint.mjs --rules  # the rules, one line each
npm test                     # node --test "test/**/*.test.js"
node --test test/core.test.js
npm run build-data           # rebuild public/data/rig.json from ../pixel-map/, palettes.json from ../td/palettes/
npm run perf                 # the preview on an emulated phone (Playwright from `npm root -g`): ≥ 20 fps at 4× CPU
```

Useful settings: `STUDIO_GENERATOR` (`sketch` default, `claude` with `ANTHROPIC_API_KEY`,
`fleet` with `STUDIO_FOUNDRY=on`), `STUDIO_CURATORS` (usernames), `STUDIO_SECURE_COOKIES=1` behind HTTPS,
`STUDIO_TRUST_PROXY=1` behind a reverse proxy, `STUDIO_FRAMES_BROTLI_QUALITY` (9),
`STUDIO_FRAMES_MAX_BYTES` (2GB). `docs/HOSTING.md` covers running it at home behind a tunnel, and
`npm run backup` makes a dated `.tar.gz` of the data.

The render-box tests need bubblewrap (`apt install bubblewrap`) and unprivileged user
namespaces. Without them they skip and print why. The data tests need `python3`. Run
`npm run build-data` after any change to `../pixel-map/`, `td/python/make_pixel_csv.py`, `td/config/` or Mirage's
`src/config.js`; `test/data.test.js` fails while `rig.json` is stale. Never edit the Folly's by hand.

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
| `src/app.js` | `createServer()`: the store, auth, queues, frames cache, API and static files in one server |
| `src/api.js`, `api-looks.js`, `look-rules.js` | HTTP routes (SPEC "HTTP API") and their plumbing (JSON bodies, CSRF checks, the logger): accounts, ideas and the library; looks; what a look may hold (layers and module chains, globals, palettes and automation) |
| `src/auth.js` | Accounts, password hashing, cookie sessions, login rate limits |
| `src/store.js` | JSON-file storage under `STUDIO_DATA` |
| `src/static.js`, `assets.js` | Static files, compression, ETags, CSPs; content-hashed URLs, the import map, `sandbox.html` with its worker and the core bundled in |
| `src/frames.js` | Pure: strict FSEQ parsing and frame analysis (brightness, flicker) |
| `src/bake.js`, `render-box.js`, `box-output.js` | The one-at-a-time bake queue and frame files; the render box under bubblewrap; what a box hands back, read as data |
| `src/frames-wire.js`, `frames-cache.js`, `frames-http.js`, `fseq-codec.js` | Baked frames on the wire: the stream encoder; the chunks and downloads kept by hash under a disk cap, made one job at a time by the encoder thread; their routes; FSEQ zstd/zlib blocks |
| `src/frames-worker.js` | The encoder thread, at nice 10 |
| `src/generate/` | Idea → look: the queue, adapters (`sketch`, `claude`, `fleet`), prompt, validation |
| `render-box/render.mjs`, `renderer.mjs` | Bakes a look to `.fseq` inside bubblewrap; the frame loop it shares with `fleet-box/check.mjs` |
| `fleet-box/` | Checker and brief for a boxed Fleet worker |
| `public/index.html`, `css/` | The app shell and its styles: `base.css` (tokens, layout and components) on every page; `pages`, `studio`, `viewer`, `timeline`, `compose` load with their views (`stylesheet()` in `ui/dom.js`) |
| `public/sandbox.html`, `js/sandbox-worker.js` | The sandboxed pattern runner (SPEC "Sandbox protocol"): the relay and watchdog; the Worker |
| `public/js/pattern-core.js`, `core/` | Pure: stdlib (with palettes), compile, scene (the rig, its groups and tags), timeline, render (module chains, DMX channels), globals (with automation and param bindings); re-exported; runs in the sandbox, the boxes and tests |
| `public/js/fseq.js` | Pure: FSEQ v2 writer |
| `public/js/frames-stream.js` | Streamed playback of baked frames, and their pure decoder |
| `public/js/runtime.js` | App side of the sandbox: iframe, adaptive frame rate, watchdog |
| `public/js/flash-guard.js` | Pure: the preview's flash guard, the bake check's rule on the frames shown |
| `public/js/viewer.js`, `viewer-gl.js` | The 3D view (SPEC "The 3D view"): the orbit camera, pointer and keys; the Points drawing |
| `public/js/playa/` | The Playa view, loaded on first use: `geometry.js` builds it from the rig's render hints, `renderer.js` draws (light texture, spill, bloom, tone map, tiers), `glsl.js` |
| `public/js/main.js`, `api.js` | Bootstrap, routing, the fetch wrapper |
| `public/js/ui/` | Views and panels, one concern per module (`studio.js` wires the `studio-*.js` panes, `view-mode.js` the Playa | Points toggle; `layers.js`, `chain*.js`, `params.js`, `look-globals.js`, `timeline-auto.js` compose; `pages.js` is ideas and looks); `dom.js` holds the DOM helpers and shared form pieces |
| `public/patterns/` | The built-in library (`index.json` with each entry's `kind` and `category`, + one file each): sources, warps and filters, also the AI's examples |
| `tools/` | `build_rig.py` (+ `rig_render.py`: what Mirage draws), `build_palettes.py` (data), `sacn-play.mjs`, `lint.mjs` (+ `lint/`: lexing, line budgets in `budget.json`), `backup.mjs`, `frames-bench.mjs` (brotli quality against encode time) |
| `docs/HOSTING.md` | Hosting at home: what runs where, tunnels, settings, backups |
| `test/` | `node:test` suites; `fixtures/` |

Browser code imports only from `public/`. Server code imports only `pattern-core.js`, `fseq.js`
and JSON from `public/`. The lint checks both.

## The rules, and why

| Rule | Why |
|---|---|
| Source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 | Small modules have one job, review well, and fit an agent's context. Patterns are AI examples, so they stay short. Over a limit, split by responsibility; never raise it. |
| Text files ≤ 64 KB (generated `rig.json` ≤ 1 MB), lines ≤ 120 | Diffs stay readable, and nothing large gets committed by accident. |
| Final newline, no trailing spaces, tabs, CRLF or BOM; valid JSON; syntax | Clean diffs, and no surprises on another machine. |
| `eval`, `Function`, `node:vm` only in the compiler (`core/compile.js`) and render box | Code generation is how untrusted code gets in, so it lives only behind the sandbox. |
| `child_process` only in `src/render-box.js`, `src/generate/fleet.js` | Processes are started only to box untrusted work. |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` in `public/js` | Titles and ideas are user data. Building nodes and setting `textContent` cannot inject markup. |
| No remote scripts, styles or imports in `public/` | It works offline on the playa, and the CSP allows only our origin. |
| No `console.log` in `src/` or `public/js/` | Server output goes through the logger; the browser console stays quiet. |
| No `debugger`, no `.only` in tests | Leftovers that stall the app or skip the rest of the suite. |
| No secret-looking strings | Keys live in the environment, never in git. |
| No `Math.random` in `pattern-core.js`, the render box or the library | A bake must be reproducible: same look, same bytes. Use `rand`, `hash`, `noise`, `seed`. |
| Imports resolve; built-ins as `node:x`; no packages; the boundaries above | Broken paths fail at lint time, and server code never reaches the browser. |
| Each area's lines of code within `tools/lint/budget.json` | Code shrinks by default; it grows only by a decision: raise that area's budget with a new `reason` beside it, in the same change. |

`// lint-allow <rule>: <reason>` on a line (or alone on the line above) silences that rule for
that one line. The reason is mandatory, an unused silence is an error, and the run prints how
many there are. File-level rules (sizes, syntax, JSON, dependencies) cannot be silenced. A small
reviewed allowlist at the top of `tools/lint.mjs` names who may use `eval` and `child_process`.

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
  is present it must match the host. Cookies are `SameSite=Lax`.
- **Sessions.** 32 random bytes in an `HttpOnly` cookie (`Secure` with
  `STUDIO_SECURE_COOKIES`); the store keeps only the token's SHA-256. 30-day expiry, at most 20
  per user. Passwords are hashed with scrypt and per-user salts; logins are rate-limited.
- **The app page** loads only from our origin (`src/static.js` CSP) and builds DOM nodes, never
  HTML strings.

## Performance budgets

- Gzipped `public/js/**/*.js` + `public/css/*.css` ≤ 165 KB; the login page (`index.html`, what it
  loads eagerly and the sign-in view) ≤ 40 KB. The lint prints both. Views load on first use.
- On the wire (`test/transfer.test.js`, the real server and a model of a browser's cache): a cold
  Studio load (shell, modules, theme, sandbox, `rig.json`, API) ≤ 205 KB with br (240 KB gzip);
  a reload, even a day later, sends only the shell and its API calls, each a 304 (assets have
  content-hashed URLs, kept a year); lists carry no code, and idea polls back off.
- The Folly's 4,870 LEDs at 40 fps: the render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), skips layers outside their clips before any pixel work, and sleeps when idle.
- The sandbox answers every frame within 1.5 s or reports the layer as hung. Bakes run one at a
  time, under CPU, memory and wall-clock limits, at nice 10, never at the same time as a frame encode.
- `npm run lint` takes well under a second; keep it that way.

## Commits and pull requests

- One concern per commit, with `npm run check` green. Stage only `studio/` (and its workflow).
- Subject line: `Folly Studio: <what changed>`. The body says why, not how it got there.
- Interface changes update `SPEC.md` in the same commit. UI changes get a browser smoke test and
  a screenshot in the PR.
- Never commit `data/`, `.fseq` renders, keys or a hand-edited Folly `rig.json`.
- CI (`.github/workflows/studio.yml`) runs `npm run check` on every push and PR that touches
  `studio/`, `pixel-map/` or the pixel CSV pipeline, and flags skipped tests. A separate job runs
  `npm run perf` and only reports.
