# studio/: working here

Folly Studio, the web app that turns show ideas into pattern code and previews them on a model
of the Gothic Folly. `SPEC.md` is the contract; `CONTRIBUTING.md` has the layout and the reasons
behind these rules.

- **Nothing is done until `npm run check` passes.** It runs `tools/lint.mjs` (sizes, hygiene,
  syntax, safety, import boundaries; `node tools/lint.mjs --rules` lists them), then every test.
  A render-box test that skips says why. A skip is not a pass.
- **SPEC.md is the contract: change it first.** The sandbox protocol, the HTTP API, the look and
  `cathedral.json` shapes, and `pattern-core.js`'s exports are what the other pieces rely on.
  Code follows the spec, in the same change.
- **Split, never bump.** Source stays ≤ 400 lines, tests ≤ 600, library patterns ≤ 150 (they
  are the AI's examples), lines ≤ 120, text files ≤ 64 KB, and the gzipped app ≤ 70 KB with the
  login page ≤ 30 KB. Over a limit, split the module by responsibility, one concern per file
  named for it. Raising a limit is not a fix. `lint-allow <rule>: <reason>` silences one line,
  and only with a reason a reviewer would accept.
- **Pattern code never runs on the server outside the render box.** It runs in the sandbox
  iframe's Worker or in the render box (bubblewrap, then a stdlib-only `node:vm` realm), never
  in the app page or the server's own process. Tests may run our own library patterns. What a
  box returns is data: parse and bound it, and keep anything it says about itself untrusted.
  `eval`, `Function`, `node:vm` and `child_process` stay where the lint allowlist puts them.
- **Zero dependencies.** Node ≥ 22 built-ins, vanilla JS and WebGL2, nothing from a CDN: it
  works offline on the playa. No packages, no build step, not even devDependencies.
- **The browser builds nodes, never HTML strings.** Use `h()` from `ui/dom.js` and
  `textContent`. Everything loads from our own origin under the CSP in `src/static.js`.
- **Bakes are deterministic.** No `Math.random` in `pattern-core.js`, the render box or the
  library: use `rand`, `hash`, `noise` and `seed`.
- **Frames are hot.** The render loop allocates nothing per frame (reuse typed arrays, pass
  `out`), layers outside their clips are skipped before any pixel work, and the loop sleeps when
  nothing plays or changes. 4,870 LEDs at 40 fps leave no room for garbage.
- **Every LED comes from `../pixel-map/`**, through `npm run build-data`. Never edit
  `public/data/cathedral.json` by hand.
- **Comments and docs are brief and current.** Say what is and why, never how it got here.
- **Commits are green**, and stage only `studio/` (plus `.github/workflows/studio.yml`).
