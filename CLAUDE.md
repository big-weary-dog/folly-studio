# studio/: working here

Folly Studio, the web app that turns show ideas into pattern code and previews them on a model
of the Gothic Folly. `SPEC.md` is the contract; `CONTRIBUTING.md` has the layout and the reasons
behind these rules.

- **Nothing is done until `npm run check` passes.** After `npm ci`, it runs `tsc` (`npm run typecheck`), the lint
  (`npm run lint`: oxlint with `.oxlintrc.jsonc` for syntax, safety and import boundaries, then `tools/budgets.ts`
  for sizes, hygiene and the line ratchet), then every test (`vitest run`), including a fresh Vite build of the app.
  A render-box test that skips says why (`ctx.skip(condition, reason)`; the run ends listing them). A skip is not a
  pass. UI changes also get `npm run smoke` (Playwright Test; `perf` and `e2e` beside it in `test/e2e/`).
- **SPEC.md is the contract: change it first.** The sandbox protocol, the HTTP API, the look and
  `rig.json` shapes, and `pattern-core.ts`'s exports are what the other pieces rely on.
  Code follows the spec, in the same change.
- **Split, never bump.** Source stays ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 (they
  are the AI's examples), lines ≤ 120, text files ≤ 64 KB, and the gzipped app ≤ 220 KB with the
  login page ≤ 40 KB, as built (`test/build.test.js`). Over a limit, split the module by responsibility, one
  concern per file named for it. Raising a limit is not a fix. Each area's total lines are ratcheted in
  `tools/budgets.json`: lower it when you cut; raise it only with a new `reason`.
  `// oxlint-disable-next-line <rule> -- <reason>` silences one line, and only with a reason a reviewer would accept.
- **Pattern code never runs on the server outside the render box.** It runs in the sandbox
  iframe's Worker or in the render box (bubblewrap, then a stdlib-only `node:vm` realm), never
  in the app page or the server's own process. Tests may run our own library patterns. What a
  box returns is data: parse and bound it, and keep anything it says about itself untrusted.
  `eval`, `Function`, `node:vm` and `child_process` stay where `.oxlintrc.jsonc`'s allowlist puts them.
- **Use a dependency whenever it makes life easier.** Pin it exactly (`npm install --save-exact`), commit
  `package-lock.json`, and give it a one-line reason in CONTRIBUTING "Dependencies". Dependencies are installed
  at setup (and the browser's bundled at build time), never fetched at run time and never from a CDN: the app,
  the sandbox and the boxes work offline on the playa, and what ships to the browser stays within its budgets.
- **TypeScript runs as written.** Vite builds the browser's code (`npm run build` → `dist/`); Node runs the
  server's, the boxes' and the tests' `.ts` by stripping the types, with no build. So only erasable syntax (no
  `enum`, `namespace` or parameter properties), `import type` (or an inline `type`) for types, imports naming the real file
  (`./stdlib.ts`); no class `declare` fields (Playwright Test's Babel cannot strip them; `tools/budgets.ts` says so).
  Types come from the zod schemas (`z.infer`) and inference; annotate module boundaries. `tsconfig.json` enforces
  this; `tsc` only checks.
- **The browser builds nodes, never HTML strings.** Components render with Preact; never `innerHTML` or
  `dangerouslySetInnerHTML`. Everything loads from our own origin under the CSP in `src/static.ts`, with no inline
  script.
- **Bakes are deterministic.** No `Math.random` in `pattern-core.ts`, the render box or the
  library: use `rand`, `hash`, `noise` and `seed`.
- **Frames are hot.** The render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), layers outside their clips are skipped before any pixel work, and the loop sleeps when
  nothing plays or changes. 4,870 LEDs at 40 fps leave no room for garbage.
- **Every LED comes from `public/data/rig.json`**, and nothing else names the installation: code finds places
  by the rig's group tags, never by the Folly's ids. It is City of Gods, from `../city-of-gods/pixel-map/`; the
  Folly's playa build is `rig-folly.json`, from `../pixel-map/`. Both come from `npm run build-data`; never edit
  them by hand.
- **Comments and docs are brief and current.** Say what is and why, never how it got here.
- **Commits are green**, and stage only `studio/`.
