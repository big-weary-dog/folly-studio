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
npm run build-data           # rebuild public/data/cathedral.json from ../pixel-map/
```

Useful settings: `STUDIO_GENERATOR` (`sketch` default, `claude` with `ANTHROPIC_API_KEY`,
`fleet`), `STUDIO_CURATORS` (usernames), `STUDIO_SECURE_COOKIES=1` behind HTTPS,
`STUDIO_TRUST_PROXY=1` behind a reverse proxy.

The render-box tests need bubblewrap (`apt install bubblewrap`) and unprivileged user
namespaces. Without them they skip and print why. The data tests need `python3`. Run
`npm run build-data` after any change to `../pixel-map/` or `td/python/make_pixel_csv.py`;
`test/data.test.js` fails while `cathedral.json` is stale. Never edit it by hand.

## Layout

| Path | Responsibility |
|---|---|
| `server.js` | Entry point: configuration from the environment, start, graceful stop |
| `src/api.js` | HTTP routes (SPEC "HTTP API"), mutation checks, JSON in and out |
| `src/auth.js` | Accounts, password hashing, cookie sessions, login rate limits |
| `src/store.js` | JSON-file storage under `STUDIO_DATA` |
| `src/static.js` | Static files, compression, CSPs; inlines the core into `sandbox.html` |
| `src/frames.js` | Pure: strict FSEQ parsing and frame analysis (brightness, flicker) |
| `src/bake.js` | The render box runner and the one-at-a-time bake queue |
| `src/generate/` | Idea → look: the queue, adapters (`sketch`, `claude`, `fleet`), prompt, validation |
| `render-box/render.mjs` | Bakes a look to `.fseq` inside bubblewrap |
| `fleet-box/` | Checker and brief for a boxed Fleet worker |
| `public/index.html`, `app.css` | The app shell and its styles (`timeline.css`: the Studio's timeline, loaded with it) |
| `public/sandbox.html` | The sandboxed pattern runner (SPEC "Sandbox protocol") |
| `public/js/pattern-core.js` | Pure: stdlib, compile, scene, render, channels; runs in the sandbox, the box and tests |
| `public/js/fseq.js` | Pure: FSEQ v2 writer |
| `public/js/runtime.js` | App side of the sandbox: iframe, frame pump, watchdog |
| `public/js/viewer.js` | WebGL2 LED renderer and orbit camera |
| `public/js/main.js`, `api.js` | Bootstrap, routing, the fetch wrapper |
| `public/js/ui/` | Views and panels, one concern per module; `dom.js` holds the DOM helpers |
| `public/patterns/` | The built-in library (`index.json` + one file each), also the AI's examples |
| `tools/` | `build_cathedral.py` (data) and `lint.mjs` (+ `lint/`) |
| `test/` | `node:test` suites; `fixtures/` |

Browser code imports only from `public/`. Server code imports only `pattern-core.js`, `fseq.js`
and JSON from `public/`. The lint checks both.

## The rules, and why

| Rule | Why |
|---|---|
| Source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 | Small modules have one job, review well, and fit an agent's context. Patterns are AI examples, so they stay short. Over a limit, split by responsibility; never raise it. |
| Text files ≤ 64 KB (generated `cathedral.json` ≤ 1 MB), lines ≤ 120 | Diffs stay readable, and nothing large gets committed by accident. |
| Final newline, no trailing spaces, tabs, CRLF or BOM; valid JSON; syntax | Clean diffs, and no surprises on another machine. |
| `eval`, `Function`, `node:vm` only in the compiler and render box | Code generation is how untrusted code gets in, so it lives only behind the sandbox. |
| `child_process` only in `src/bake.js`, `src/generate/fleet.js` | Processes are started only to box untrusted work. |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` in `public/js` | Titles and ideas are user data. Building nodes and setting `textContent` cannot inject markup. |
| No remote scripts, styles or imports in `public/` | It works offline on the playa, and the CSP allows only our origin. |
| No `console.log` in `src/` or `public/js/` | Server output goes through the logger; the browser console stays quiet. |
| No `debugger`, no `.only` in tests | Leftovers that stall the app or skip the rest of the suite. |
| No secret-looking strings | Keys live in the environment, never in git. |
| No `Math.random` in `pattern-core.js`, the render box or the library | A bake must be reproducible: same look, same bytes. Use `rand`, `hash`, `noise`, `seed`. |
| Imports resolve; built-ins as `node:x`; no packages; the boundaries above | Broken paths fail at lint time, and server code never reaches the browser. |

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

- Gzipped `public/js/**/*.js` + `public/*.css` ≤ 70 KB; the login page (`index.html`, what it
  loads eagerly and the sign-in view) ≤ 30 KB. The lint prints both. Views load on first use.
- 4,870 LEDs at 40 fps: the render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), skips layers outside their clips before any pixel work, and sleeps when idle.
- The sandbox answers every frame within 1.5 s or reports the layer as hung. Bakes run one at a
  time, under CPU, memory and wall-clock limits.
- `npm run lint` takes well under a second; keep it that way.

## Commits and pull requests

- One concern per commit, with `npm run check` green. Stage only `studio/` (and its workflow).
- Subject line: `Folly Studio: <what changed>`. The body says why, not how it got there.
- Interface changes update `SPEC.md` in the same commit. UI changes get a browser smoke test and
  a screenshot in the PR.
- Never commit `data/`, `.fseq` renders, keys or a hand-edited `cathedral.json`.
- CI (`.github/workflows/studio.yml`) runs `npm run check` on every push and PR that touches
  `studio/`, `pixel-map/` or the pixel CSV pipeline, and flags skipped tests.
