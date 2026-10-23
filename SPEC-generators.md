# Folly Studio — build contract: generators and models

Part of `SPEC.md`'s contract: how an idea becomes a look, and which models people may pick (who may use the paid
ones, and how much: SPEC-access).

## Generators (idea → look)

`src/generate/index.ts` runs a small in-process queue. An adapter is
`async generate({ text, user, library, rig, groups, prompt?, repair?, signal? }) → { title, summary, duration?,
globals?, automation?, bpm?, layers, extensions? }` (`groups`: the rig's; `prompt()`: the system prompt, the output schema
and the library's catalog, built once per library and rig; `repair`: the last answer and its errors, below;
`signal`: aborted when the server stops). `claude` and `codex` return a composition (below); the others a look. Each idea names a model of the registry (below); its job runs in
that model's transport lane, each lane with its own concurrency. When it fails, the idea is `failed` with a user-safe
error (the Studio offers "Try again"): no other generator stands in. A call cut by a stop signal the server did not
send (a service stop reaching the whole group) runs once more after a 2 s grace, or, when the server is stopping
after all, is left `generating` for the next start to queue again; cut twice, it fails. A stored idea that names no model goes
to `STUDIO_GENERATOR`'s transport. Generators find places by the rig's
tags (falling back to group ids and names), describe the installation from the rig (`about`, its fixtures and
groups), and give layers the tags they meant beside the ids. The result is cleaned by `validateLook`
(`shared/schemas/generated.ts`, zod: ≤ 4 layers,
known group ids (none known: the root) and tags, code ≤ 20 kB containing `function pixel`, or modules whose code defines their kind's
function; clips and duration normalised, bad or overlapping clips dropped; `globals` and `automation`
cleaned (a macro's `mod` kept when it is an LFO, `beats` or a global binding that follows faders only, else
dropped with a note),
`bpm` held to 40–240, a palette name filled in; picks cleaned of unknown tokens; a layer's `palette` dropped; a layer without a
usable `soften` gets `DEFAULT_SOFTEN`) before a look is saved, with `chain: 2` (generators write the one rule: a warp after
what it bends), and the idea set `ready`. Generators may add
clips and a duration for ideas that describe a progression; most looks have neither.

**Composition** (`claude`, `codex`). The model names the library and the server writes the code. A layer is
`{ title, groups, tags, blend, level, clips?, preset, overrides: [{ module, name, value }] }` (a preset by name;
an override's `module` is a ref in its recipe, `ref#2` for the second) or `{ …, modules: [{ use, id?, params: [{ name,
value }], blend?, input?, as? }] }` (a chain under the one rule; `use` is a library module's name or `ext:<name>`).
`extensions: [{ name, kind, summary, why, code }]` is the last resort: code the model writes when nothing in the
library draws the idea, `why` naming what it tried. The answer opens with `critique` (what the frames it was shown
show) and `plan`, and a layer may give its `why`: optional, a sentence each, for "How it was made" (the idea log),
never read for the look. A value is a number, on/off, a word (a choice, a pick) or a
binding (`{ mod: lfo | global | beats, … }`, on number params only; `beats` keeps a speed in time). `src/generate/expand.ts` turns it into a look:
each `use` becomes the module's code with its params, held to the declarations read statically from its `const
params` (`catalog.ts`; never evaluated): a number out of range is clamped, an unknown or ill-typed param dropped,
a direction word a module's `upgrade` maps (`round`, bars' `orbit`) made the word it maps to, each with a note in `dropped`. More than 8 such notes get a round of their own (the notes, and the ask to fit
each param to the library); its answer is kept only when it expands with no errors and fewer notes. A preset becomes its layers as the Studio adds one (its params, blends and inputs,
the overrides on top, its palette and macros where the look has none). An unknown module, preset, extension or
input, and an empty layer, are errors with a path (`layers[1].modules[0].use: barz is not a library module (did you
mean bars?)`); they get one repair round inside the idea (the same model, its answer and the errors; it is not
another use), after which what expanded is kept and the rest noted. `validateLook` then cleans the result as
any look; a layer given as code passes through to it. The prompt shows the library as a summary
sorted by name (a module on one line: what it looks like and its params in brackets, each as `name lo–hi (default)`,
`name a|b (default)`, `name on/off (default)` or `name colour (default)`; a preset as its recipe),
the palettes, the groups, show taste, and worked compositions (each only where the library and the rig's tags have
what it names). The pattern API is not in it: an extension reads `library/extensions.md` (with no docs, the page is
in the prompt). The system prompt and the docs a turn gets unasked stay under 34,000 characters together,
and with the draft turn under 34,500 (`test/generate.test.js`). The queue logs one line per idea or refinement: its route, timings, repair rounds, the check and
critique, how many library modules, extensions and code it used, the docs it read, and the first notes.

**The idea log** (`src/generate/idea-log.ts`). Each idea and refinement (under its own id) also leaves a record on
disk, in `<STUDIO_DATA>/ideas-log/<id>/`, written as it runs: `idea.json` (the request, the level that ran (`quick` when its model
does not explore; none for a refinement), model, its name and effort; each round's kind (`compose`, `draft`, `take`, `repair`, `notes`, `runtime`, `critique`), start and end,
calls, tokens, docs read, outcome, the reason a repair ran, expand's notes and a critique's group warnings, the
thinking summary its calls gave (claude's thinking blocks, codex's reasoning items; at most 6,000 characters), the
answer's `critique` and `plan`, `changes` (`[{ text, why? }]`: what changed from the look before, `diffCompositions`
of the expanded looks, each with the why its layer or edit gave) and `checks` (`{ ms, errors, meanBrightness?,
darkFraction?, flashHz?, flashOk? }`: the render check after it; `src/generate/explain.ts`); then the
outcome, `ready` with the look, `failed` with the error and its detail, or `interrupted`), rewritten as each round
ends; `calls.jsonl`, a line per model call (the user turn, images by size, the reply, codex's items with when each
started and completed (`from`, `at`: ms into the call), usage, docs read; the system prompt by hash, kept once as
`system-<hash>.txt`); and `stills/<round>-<kind>-<n>.png`, the images the model was shown. A run cut short and queued again adds to its log (rounds from 101, the first record kept as
`earlier`). The newest `STUDIO_IDEA_LOGS` (300; 0: none) within `STUDIO_IDEA_LOGS_MAX_BYTES` (500 MB) are kept, the
oldest removed when a log opens. Tokens are `{ input, cached, output }` (claude: cache reads and writes count as
input; codex: from its `--json` events), and they and a line per round are saved on the idea (`timing.tokens`,
`rounds`), a failed round's outcome (and the critique `verdict`) as just `failed`: its error can carry a provider's or
a CLI's text, so it stays in the log. The idea also keeps `how`, its rounds in about 5 KB (each round's head,
tokens, critique, plan, up to 12 changes, checks, how many stills, and 600 characters of thinking, the oldest
rounds' thinking dropped first to fit), so how it was made outlasts the log. The
owner's API (`GET /api/ideas`, `/api/ideas/:id`) leaves `how` out, and strips any failed round's error stored on the
idea's rounds and verdict too. Admins read a log at `GET /api/admin/ideas/:id/log` and its stills by name; the Studio links it
("Log") on an idea's row for them.

**How it was made** (`src/api-idea-how.ts`, the page `/ideas/:id/how`, linked from each idea's row). For
the idea's owner and admins; anyone else, curators too, gets 404. `GET /api/ideas/:id/how` answers `{ idea, from,
run: { via?, effort?, level?, name? }, prompt?, rounds, usd? }`: from the idea's log while it is kept (`from: 'log'`),
else from the `how` the idea keeps (`'idea'`: no prompt, stills only counted), else `'none'` (as for
one its model made in one step). `prompt` is the first call's parts, each `{ name, bytes, tokens (bytes / 4, an
estimate), text? }`: the guide and the library catalog (the system prompt, shared by every idea: text for admins
only), each doc given and the idea itself. A round is as logged, with its stills `{ file, view, at }`, served at
`/api/ideas/:id/how/stills/:name`; an owner gets its outcome plain and no notes. Admins also get the expand notes,
why a repair ran, the provider's model name and dollars (`src/generate/prices.ts`: list prices, cache reads at their
own, writes as input; none for codex, on a subscription). The page shows the prompt folded and the rounds, the
latest open, each said once: the run's model, effort, time and tokens in its head, each round's time in its own; the last still the model was shown beside them on a wide screen. While the idea runs, `GET
/api/ideas/:id/how/live` answers `{ status, rounds, round?: { n, kind, ms, thinking? } }` from memory: how many
rounds have ended and the one running, with its thinking summary so far (claude's `thinking_delta`s, codex's
`reasoning` items as each completes; the latest 6,000 characters). The page polls it every 2 s while the tab shows,
the running round folded, and fetches `/how` again when `rounds` or `status` moves.

**Library docs** (`src/generate/library-docs.ts`). Beside the prompt, once per library, the server builds a tree of
markdown: `library/README.md` (how layers, sources, warps, filters and presets combine; blends; inputs; groups and
tags; globals and bindings), `library/<kind>s/README.md` (the kind, and its modules by category, names only) and
`library/<kind>s/<name>.md` (every param with its type, range, default, unit and effect; directions; pairings;
pitfalls), and `library/extensions.md` (from `guide.ts`: how an extension is declared and written, the pixel, the
stdlib and the rules for code, with how often `pixel()` runs on the rig). The prose is hand-written in `library-docs/<name>.md` (front matter `looks:`, the line the summary
shows; a paragraph; `## Params` with a line per param, `## Overrides` for a preset; `## Pairings`; `## Pitfalls`);
types, ranges, defaults, options, units (the code's `label`) and each param's `help` come from the catalogue, and recipes from the index,
so the tree follows the library. `tools/build-docs.ts` writes it to a folder. A test fails when the prose names a
param the code lacks or a module the library has not, a module has no prose, or a param no `help`. The prose is kept short: a page says only what the code's help does not.

The docs reach the model in its turn (`src/generate/docs-turn.ts`), never the cached system prompt: the pages an idea
needs, each whole in a `<doc path="…">`, before the turn's text: for Explore and Deep the pages the draft turn named
(`docs`, read leniently as `read_doc` reads paths, found in the tree, once each), for a refinement the pages of the
modules its look uses; at most 18 in all; a Quick idea none. The READMEs are not given unasked: the system prompt says
what they do. Every later call of the idea (repair, notes, runtime,
critique) carries the same pages again; the idea's log notes them (`docsGiven`). The `read_doc({ path })` tool stays
for a page not given: a path in the tree (`library/sources/bars.md`), at most 8 reads an answer, each read noted in
the idea's log line; a page the turn carries is declined unread, and anything else is refused.

**The render check** (`claude`, `codex`; `src/generate/check.ts`). Where the render box can run (`probe()` is ok),
the expanded look is rendered for 2 s in the box, in the bakes' lane, before it is saved. A look the box cannot load,
and a layer that throws or gives NaN (the box's `errorFrames`, `firstError`, by layer), get one repair round as
expansion errors do (the error with the layer's path, `layers[1]: runtime: …`); after it, what renders is kept, and a
layer that still throws is noted. No box (plain Windows): no check. The box's words are untrusted data, bounded
before they reach a prompt.

**Critique** (opt-in per model: `critique: "images" | "text"`, default off). With the box, the look is rendered for its
whole length (its `duration`, else 30 s) instead of 2 s, and the model is shown what it made, once: 4 front-view
stills (`frames-view.ts`: the LEDs seen from the front, at 5, 35, 65 and 95 % of it, each named with its time, off
whole seconds so a once-a-second beat shows two frames), PNG, 360 px wide;
`images` only), with each rose up close at the same times when the look plays on one (`frames-closeup.ts`: a group
tagged `rose` holding at least half of a layer's LEDs, or any group tagged `rose` when a module param names `rose`;
each LED drawn as its fixture's `render.cells` pane, 240 px), a timeline of 30 lines across the look (each at least
0.5 s apart) with each top-level group's mean colour and brightness (in the LEDs' light), a warning for each top-level group
dark (under 3 % of full light on average, about 20 % of a colour's value) or harsh (over 60 %, about 80 %) beside what the idea says of it, the params expand changed (so the frames show
those values, not the model's), the frames' analysis (brightness, dark share, flashing), and the idea again. It answers the whole
composition again, revised or not; that answer is expanded and checked (2 s), and kept only if it expands and renders
without errors. It is part of the idea (no use), skipped when the idea has already taken 90 s
(`STUDIO_CRITIQUE_BUDGET_MS`), and logged with its time. Claude gets the stills and close-ups as image blocks, codex
as `-i` attachments.

**Explore** (`claude`, `codex`; `src/generate/explore.ts`). A new idea (not a refinement) asks for one of three
levels, `explore: 'quick' | 'explore' | 'deep'` (default `explore`, as is an idea that names none):
- **Quick**: the rounds above, at the model's own effort.
- **Explore**: effort raised to at least `high`. First a draft turn in its own small schema (no look, no docs; it
  names the doc pages composing it needs, `docs`, which every later turn carries):
  three takes that differ in which part of the installation leads (each other part answering in its own voice, never
  one wash), motion, scale, colour and tempo, each named with what one would see; then a synthesis, `took` (one line:
  what it takes from each take, by name) and `brief`. The synthesis is composed as the look (the drafts in the turn
  as the model's own notes, never instructions), checked, and critiqued once on its stills (`images` unless the model
  says `text`) held to the idea and the brief, a critique that must change the part furthest short of them. The
  idea's `took` is saved for the Studio to show.
- **Deep**: effort at least `xhigh`. The same draft turn, then the three takes composed alone and rendered (8 s) at
  once, then one look composed from their compositions, timelines and stills (two each, at 30 and 70 % of it), then two
  such critiques, a revision kept rendered again for the next. It counts as `DEEP.uses` (2) of the allowance
  (`shared/schemas/api.ts`; `DEEP.adminOnly` keeps it to admins). It is off (`DEEP.enabled` false): the API
  refuses it (400) and `GET /api/models` names no `deep`, so the Studio does not offer it.

A draft turn that fails or answers no three takes leaves the idea to the Quick rounds, logged. The first critique always
runs; Deep starts its second only within 720 s. The draft turn's time (Deep: with its three takes built and rendered)
is the idea's `timing.draft`.

**Refine** (SPEC "HTTP API": `POST /api/looks/:id/refine`). A follow-up on a saved look of one's own (`slower,
more red, only the spires`) is an idea with `refine` and `lookId` set; it counts as one use like any idea. Its job
reads the look as it is stored then and turns it back into a composition (`refine.ts`: a module whose code is still
its library ref's becomes `{ use: ref, params }`, from the catalogue's declarations; other code becomes an
extension), which goes to the model with the request (fenced as untrusted, in the user turn; the system prompt is
the same cached one). The model answers with edits to that composition (`edits.ts`, its own schema: `{ edits }` or
`{ rewrite: <the whole composition> }`, after the same `critique` and `plan`), each with an optional `why`, by path (`layers/Rose/modules/bars/params/speed`, a list's item by its
title, id, name or use, else index): `set`, `remove`, `insert`, `add_layer`, `remove_layer`, `move_layer`,
`replace_layer`; a value is typed as the composition types a param's (never JSON in a string) and `insert` takes a
`module`; an `insert` into a list the look lacks (`globals/macros`, `automation`) makes it, when its key is a field
of a look. The server applies them in order to a copy; an edit that does not apply (a path that leads nowhere, a
key the composition has no field for, an unknown op) is skipped and named with why, and one `edits` repair round sends
the list back (its answer kept when fewer fail). A layer the edits left as it was is saved as it was stored, byte for
byte. The result is expanded, repaired, checked and (when the model has it) critiqued as an idea is,
and saved onto the look as an edit through the API's rules (a version of what was there, the bake and review
cleared). `idea.changes` lists what changed, at most 24 lines, from comparing the two compositions (`Fire: speed 0.4 →
0.2`, `+ layer Sparkle (sparkle)`, `− layer Bed`, `speed: default → 0.8`). `refine.critique` asks for a critique
round on the look as it is (any model with the box; the request may be empty); `refine.fix = { layer, error }` sends a runtime error the
Studio or a bake saw, for a fix. A refinement has no fallback: when its model fails, the
look stays as it was, as it does when the look was edited while it ran (any save that made a version: its
`version.n` moved on). The Studio likewise keeps edits made while it ran over the revision, which is then the newest
saved version. A layer keeps its switches (`enabled`,
`solo`) and its switched-off modules, which the model is not shown. One refinement per look at a time (409). Only
the prompted models refine (the foundry: 400).

**Refine history.** A refinement's turn also carries the look's history, so a follow-up (`more`, `undo the red`)
reads against what came before: the idea that made the look, then each earlier ready refinement of it, oldest
first, as its request (or "a critique", "a fix of layer X") with its `changes` on one line and its critique
`verdict`. An undone refinement (`POST /api/ideas/:id/undo`, which the Studio calls at the save after its step is undone, SPEC-history) is left out. The last 8
entries that fit in 1,500 characters, the idea kept first; fenced as untrusted (`<history>`) and marked a record,
not instructions. The prompted models read it. Only requests and change lines, never answers or
transcripts.

- `claude`: one Messages API call (adaptive thinking, its summary returned: `display: "summarized"`) with the prompt
  as the system prompt (cached: the same bytes on every call; with
  docs given, the first user turn, the same on every round of an idea, is a second cache point), and
  structured output whose JSON Schema is the composition's (`compositionSchema(groups, catalog)`: the place fields
  `wireSchema(groups)` gives, group ids, tags and preset names as enums), and `read_doc` as a tool: a tool call is
  answered from the tree and the call made again (its thinking and tool turns kept), at most 12 calls; the docs given
  open the first user turn. A repair is the same call with the
  answer as an assistant turn and the errors in a user turn; a critique likewise, its stills as image blocks; a
  refinement's user turn is the look's composition and the request.
- `codex`: one `codex exec` call (the Codex CLI, signed in with `codex login`): `[-i <still> …] --json --ephemeral --skip-git-repo-check
  --ignore-user-config --ignore-rules -s read-only -C <an empty folder> -m <model> -o <answer file> --output-schema
  <the composition's schema, strict> -c model_reasoning_effort="<effort>" -c model_reasoning_summary="auto" -c web_search="disabled" -c features.<tool>=false
  … -c mcp_servers.docs.command=<node> -c mcp_servers.docs.args=[docs-mcp.ts, <tree>, <reads file>, 8, <given paths, comma-separated>] -c
  mcp_servers.docs.default_tools_approval_mode="approve" -`, the prompt on stdin; its `--json` events on stdout give
  the idea log its items and usage; its reasoning summary comes as `reasoning` items (per the Codex docs and the
  CLI's config keys; unconfirmed in a run here). The shell stays
  off, so the model reads nothing but the docs: `docs-mcp.ts` is a stdlib-only MCP server on stdio with the one tool
  `read_doc`, serving the tree as written under the work folder (`docs-<hash>/`), a path's real path (symlinks
  followed) inside it; each read is appended to the job's reads file (the guide first, the idea last; a repair, refinement or critique
  adds its turn after the idea, as a fresh run, a critique's stills as `-i` attachments). Started from an argument list, never a shell (on Windows
  an npm `codex.cmd` shim is read for the script it runs); its environment is only what the CLI needs; its whole
  process tree is killed on a wall clock (`timeoutSeconds`, else `STUDIO_CODEX_TIMEOUT_MS`, 300 s; a composition,
  not a repair, critique or draft turn, gets 1.5 times it at `high` effort and twice it at `xhigh`), past 4 MB of
  output, or when the server stops. A call that writes no event for `STUDIO_CODEX_IDLE_MS` (180 s, twice it at
  `xhigh`; a healthy call's longest quiet stretch measured 143 s) has stalled: its tree is killed, the stall
  logged as a call of the idea, and the call tried once more; a second stall fails as too long. The answer, at most 512 KB, is read as untrusted data like `claude`'s.
- `fleet`: hands the idea to a boxed Fleet worker as an untrusted brief (experimental), in a workspace holding
  copies of the modules `check.ts` imports (the core's, `fseq.ts`, `frames.ts`), as they are. The worker
  also bakes (`node check.ts --bake`); the adapter reads its `look.json` (title, summary, duration, layers, globals,
  automation, bpm) and returns it with `bake` + `frames` (see below), and
  the queue stores them with the look. This foundry is opt-in: it runs only with `STUDIO_FOUNDRY=on`,
  one job at a time in a slot of its own. While it is busy its ideas wait; while it is off they fail ("Fleet is off
  right now; try another model."). `STUDIO_GENERATOR_FALLBACK` opts into a one-shot generator instead (while busy,
  unless `STUDIO_FOUNDRY_WAIT=1`). No idea falls back to another model unasked: an idea whose model is gone fails too.
  Without a systemd user bus (`systemd-run --user --scope` fails, as on WSL) Fleet's boxes have no
  memory cap, and the server warns at start.

## Models (`<STUDIO_DATA>/models.json`, or `STUDIO_MODELS`)

The registry (`shared/schemas/models.ts`), written with the defaults on first run and read again whenever it
changes (a file that does not parse is reported, and the last good one kept; a model or concurrency lane whose
transport is gone is left out, the model logged and the default moving to the first left, while a save naming one is
refused):

```
{ "about"?: text, "default": id, "concurrency"?: { "claude"?: n, "codex"?: n, "fleet"?: n },
  "models": [{ "id", "label", "via": "claude" | "codex" | "fleet", "model"?, "effort"?, "maxTokens"?,
               "timeoutSeconds"?, "critique"?: "images" | "text", "enabled": true,
               "roles"?: ["member" | "curator" | "admin", …], "limits"? }],
  "limits"? }                                                       // limits: SPEC-access "Access"
```

`id` is 1–32 of `[a-z0-9-]`; `model` the provider's name (required for `codex`; `claude` defaults to
`claude-opus-5-5`); `effort` one of the transport's (`claude`: low–max; `codex`: minimal–xhigh); `critique` turns on
the critique round (Generators; `claude` and `codex` only); `roles` who may
pick it (none: everyone); `concurrency` the jobs at once per transport (defaults claude 4, codex 2; the
foundry always 1). What each transport may do (explore, refine, critique, whether it is paid, its default effort
and lane) is one table, `TRANSPORT_CAPS` in `shared/schemas/models.ts`, which the API and the queue both read.
The defaults: Opus (`claude-opus-5-5`, medium, the default; no critique), Sol (`gpt-6.1-sol`, low,
critique `images`) and Luna (`gpt-6-luna`, low, critique `text`) through `codex`. A model can run when its transport can: `claude` with
`ANTHROPIC_API_KEY`, `codex` with the CLI on PATH (`STUDIO_CODEX_BIN`; `warn` when no login is seen), `fleet` with
`STUDIO_FOUNDRY=on`. The idea form offers the models that are on, offered to
the user's role and able to run, starting on the default when it is one of them (else the first); an account that
may not use the paid models (SPEC-access "Access") starts on the first free one, if any (every transport is
paid, so none), and an idea sent without a model gets
that same default. When the file is first written, `STUDIO_GENERATOR` (`claude`, `fleet`) names its
default.
