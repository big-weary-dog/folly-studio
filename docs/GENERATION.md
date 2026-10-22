# Generating looks by composition

A design note for whoever builds it, written for an iterating Fleet worker (compose, render, look at the frames,
refine). Items 1–5 and 8 of §7 are built for claude and codex (`catalog.ts`, `composition.ts`, `expand.ts`, `prompt.ts`,
`guide.ts` in `src/generate/`); the rest is still to do. Where it differs from the plan below, §7 says how.

## 1. The problem

The prompted generators (`src/generate/claude.ts`, `codex.ts`) are one shot: the model writes pattern code into each
layer, `validateLook` (`shared/schemas/generated.ts`) checks it as text only (its size, `function pixel(`), and the
queue (`src/generate/index.ts`, `runJob`) saves it. Nothing runs it before a person opens the look. Luna's "Falling
leaves" source returned `[NaN, NaN, NaN]` from `pixel()`: it passed every check and drew nothing. Library modules are
tested, flash-checked and costed (`test/library*.test.js`, `npm run perf`); hand-written code gets none of that, and
costs output tokens and time. So a look should be composed from the library as data, with code only as a last resort.

## 2. The composition format

The model returns names and values, never library code. Roughly (zod, in `shared/schemas/generated.ts`; the same
schema, made strict, is Claude's structured output and `codex exec --output-schema`):

```ts
const Value = z.union([z.number(), z.boolean(), z.string() /* a choice or a pick */, Pick, Binding]);
const Use = z.object({ use: z.string() /* a library module, or 'ext:<name>' */, id: z.string().optional(),
  params: z.record(z.string(), Value).optional(), blend: z.enum(SOURCE_BLENDS).optional(),
  as: z.literal('input').optional(), input: z.string().optional(), enabled: z.boolean().optional() });
const Place = { title, groups, tags, blend, level, soften: Soften.optional(), clips: Clips.optional() };
const Layer = z.union([z.object({ ...Place, modules: z.array(Use).min(1).max(8) }),
  z.object({ ...Place, preset: z.string(), overrides: z.record(z.string(), z.record(z.string(), Value)).optional() })]);
const Extension = z.object({ name, kind: z.enum(MODULE_KINDS), summary, why, params: ParamDecls, code });
const Composition = z.object({ title, summary, palette: z.enum(PALETTE_NAMES).optional(), globals, macros, bpm,
  duration, automation, layers: z.array(Layer).min(1).max(4), extensions: z.array(Extension).max(2).optional() });
```

- `Pick` and `Binding` are today's (`shared/schemas/look.ts`). Picks are slots, roles or literals (`'body2
  accent1'`, `'body/accent'`, `{ pick, blend, rotate }`). Bindings are `{ mod: 'lfo' | 'global' | 'envelope', … }`.
  A direction is a choice value (`"direction": "down"`). A preset's `overrides` are keyed by module ref (`<ref>#2`
  for a second one) and merged onto its params.
- **Expansion** (a new `src/generate/expand.ts`) turns each `use` into `{ id, kind, title, ref, code, params, … }`,
  taking the current code from `loadLibrary()` (`src/static.ts`). It turns each preset into its layers, as the
  Studio's `presetLayers` and `withPresetGlobals` do (`public/js/ui/model.ts`); move those two into `shared/` so
  both sides use one copy. The look is then stored as today, with code inline and `chain: 2`, after `validateLook`.
  Expansion only reads `index.json` and the pattern files; it never runs them.
- **Errors** are data with a path, for the model to read: `{ path: 'layers[1].modules[2].params.speed', code:
  'out_of_range', message: 'speed is -2..2; got 5' }`. Codes: `unknown_module`, `unknown_preset`, `unknown_param`,
  `bad_type`, `out_of_range`, `bad_choice`, `bad_pick`, `bad_binding`, `bad_input`, `bad_picture`, `bends_nothing`, `too_many`.

## 3. The catalog

One text block, built from data where the queue's `prepare()` builds the prompt (again only when `loadVersion()`
changes), sorted by name so its bytes stay the same between calls and the prompt cache holds. It contains:

- **Modules**: name, kind, category, the index summary, and each param as `speed: number -2..2 = 0.4`,
  `profile: step|smooth|pulse|comet = step`, `colours: pick = all`, `direction: up|down|… = up`. They come from each
  file's `const params = {…}`, read statically by a strict reader of the literal (numbers, strings, booleans,
  arrays, `DIRECTIONS`) that refuses anything else. Every params block in the library today is a plain literal.
- **Presets**: name, summary and recipe (`colour-wash(colours=body) → edge-fade(position=lfo 0.17 Hz) → …`).
- **Palettes** from `public/data/palettes.json` (40 today): name, theme, and low/body/accent/high columns of
  comma-separated sRGB hexes without `#`; each role's slot order is preserved (`body2` is body's second hex).
- **The rig**: groups with their tags and LED counts. Use `formatGroups` (`prompt.ts`) for the tree and the core's
  `prepareScene` and `pixelsForGroups` for the counts; neither runs pattern code.
- **Rules**: the one rule, the pick and binding grammars, the colour rule, and the limits (4 layers, 8 modules,
  16 macros, 600 s, large-area flashing at most 3 Hz).

Rough sizes, at 3.6 characters a token (measure with the API's token count): today's system prompt
(`buildSystemPrompt`) is about 26 KB, roughly 7 k tokens, mostly the pattern guide and four example sources. The
module lines come to about 8 KB (2.3 k tokens); with the presets, palettes and groups, about 5–6 k. The pattern
guide leaves the prompt except for extensions (§6). The same catalog goes into `BRIEF.md`. A coverage test checks
that every index entry appears in it.

## 4. Validation without running code, and repair

Expansion checks, statically: names; param types, ranges and choices (directions included); picks (the core's
`readPick`, and slots the palette has); bindings (the `Binding` schema, and that a global or macro exists); that a
filter's `input` names an earlier source; that each warp has something above it in its stage (`isStageEnd`, as
`fleet-box/check.ts` does); the limits.

**Repair**: on errors, the previous answer and the error list go back to the model as the next user turn. For
claude, that is a second message in the same conversation, so the cached system prompt is reused. For codex, it is
a second `codex exec`, with the guide, the idea, the previous answer and the errors on stdin. Allow one repair
round (built with no setting for more), then the idea fails with "Try again" (no other generator stands in).
Log each round, and add `rounds` and `repair` (ms) to `idea.timing`. Some faults need a render to
show up: NaN, a dark look, flashing, a slow frame. Those are §5.

## 5. The loop in a Fleet worker, with what exists today

What exists:
- `src/generate/fleet.ts`, `createFleetAdapter().generate(ctx)`, only with `STUDIO_FOUNDRY=on`, one job at a time.
  It builds a workspace under `STUDIO_FLEET_WORK` (default `~/.folly-studio/fleet/idea-<id>`): `BRIEF.md` from
  `fleet-box/BRIEF.template.md` (`renderBrief`), `rig.json`, `palettes.json`, `patterns/`, `check.ts`, `renderer.ts`,
  and the core's modules with `fseq.ts` and `frames.ts` (`copyModule`). It runs `fleet up --no-coordinator` and
  `fleet spawn idea-<id> --here --box --model gpt-… --brief …`, waits for `fleet raise report`, reads `look.json`
  (`readLook`) and checks `frames.fseq` (`checkFrames`, `src/box-output.ts`). Fleet refuses boxed Claude: Codex.
- In the box, `node check.ts [look.json]` compiles each layer with the real core and renders 6 spot frames plus 2 s
  at the rig's fps: `✗` for compile errors, throws, NaN and non-finite channels; `!` for a slow frame (over 80 % of
  the frame time), over 60 % dark, or whole-rig flicker. `node check.ts --bake [--seconds S]` writes `frames.fseq`
  and `stats.json` (ms per frame, each layer's error frames, and `selfCheck`: `analyzeFrames` from `src/frames.ts`
  with the flash check of `core/flash.ts`: brightness, dark share, `flicker.maxHz`, `ok`), as the server checks.
- On the server, the render box: `createRenderBox().render({ layers, seconds, globals, automation, bpm })`
  (`src/render-box.ts`, bubblewrap around `render-box/render.ts --out DIR [--seconds S] < look.json`). The bake
  queue is `src/bake.ts` `createBakeQueue`, behind `POST /api/looks/:id/bake`.
- Perf: `npm run perf -- -g library` (`test/e2e/library-perf.spec.js`) holds a source or chain to 8 reference
  workloads (about 25 ms a frame). The preview marks a layer heavy over 8 ms.

What the loop lacks:
- **Compose in the box**: `node check.ts --compose composition.json` would expand with the server's own
  `expand.ts` and catalog (copied in with `copyModule`, as the core is), write `look.json`, and print §2's errors.
- **Something to look at**: `node still.ts look.json --at 0,5,10` would render with the same `renderer.ts` and
  project the LEDs on the rig's front (z, y) and side (x, y) as PNGs (`node:zlib` is enough), plus a text line a
  second with each top-level group's mean colour and brightness, for when the boxed Codex cannot view images.
- `readLook` (`fleet.ts`) keeps only title, summary, duration and layers. It must also keep globals, automation and
  bpm, because a composed look relies on its palette and macros.
- One source of limits: `check.ts` allows 8 modules and `generated.ts` keeps 6.

Each iteration, as `BRIEF.md` would tell the worker:
1. Write `composition.json` from the catalog; run `node check.ts --compose composition.json` until no `✗` is left.
2. Run `node still.ts look.json`; read the stills and the per-group lines against the idea.
3. Run `node check.ts --bake --seconds 20`; fix any flashing, NaN or slow frames.
4. Refine params, picks, bindings and layers; repeat for about 5 rounds or until the wall clock, then the full bake
   and `fleet raise report`. The server checks the frames again; where it has a render box, its bake stays the
   authoritative one.

## 6. Extensions, a last resort

An extension, `{ name, kind, summary, why, params, code }`, is used as `{ use: 'ext:<name>' }`; `why` names the
modules that did not fit. The prompt allows one only when no module or preset fits; it is stored inline like any
module, with no `ref`, marked `generated`. Its code never runs on the server outside the render box:

- **Linux or WSL with bubblewrap** (`createRenderBox().probe()` is ok): render the extension's layer for 2 s in the
  render box (`render({ layers: [layer], seconds: 2 })`). A failed load, a throw or NaN (each layer's `errorFrames`
  and `firstError`) and a slow frame (`msPerFrame`), read from the box's untrusted `boxStats`, go back into the
  repair loop as errors on `extensions[i]`. In Fleet, `check.ts` does the same inside the box.
- **Plain Windows** (no render box): the extension is saved as `unchecked`. The Studio's sandbox still reports its
  runtime errors (`ui/layer-status.ts`, from the worker's `errors: [{ id, module, error }]`). For a generated module
  in error, a one-line "Ask <model> to fix" row would post the module, its error and the idea to a repair endpoint,
  which runs one repair round and saves a new version of the look.

## 7. TODO, in order

1. Done: `readParams` (`catalog.ts`), with a test over every library file.
2. Done, but `expand.ts` has its own preset expansion (as the Studio's `presetLayers`), since `shared/` was claimed;
   moving both into `shared/` is still to do. A param out of range, of the wrong type or unknown is mended or
   dropped with a note, not refused; unknown names, presets and inputs are errors for the repair round.
3. Done: `buildCatalog`, built with the prompt once per `loadVersion()`; about 11,000 characters.
4. Done; the composition's schema is plain JSON Schema in `composition.ts` (from `wireSchema`'s place fields), not
   zod in `shared/`. Code-only looks still load.
5. Done as one fixed round inside the idea (it counts as one use), with no setting; a second miss keeps what
   expanded and notes the rest, and a look with no layers left falls back.
6. Fleet: `check.ts --compose`, `still.ts`, the workspace copies, `readLook` keeping globals, a new `BRIEF.md`
   around the loop in §5, and one shared `LIMITS`.
7. Done for claude and codex: the render check in the box (`check.ts`), a runtime repair round, an opt-in critique
   on stills across the whole look and per-group lines (`rounds.ts`, `frames-view.ts`), and refining a saved look
   (`refine.ts`, the Studio's "Ask the AI to fix it" and Refine box); each idea's rounds on disk (`idea-log.ts`),
   with what each thought, planned and changed (`explain.ts`).
   Still to do: `unchecked` on Windows.
8. SPEC ("Generators", "Looks"), README pointers.
