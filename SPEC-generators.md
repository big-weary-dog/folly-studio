# Folly Studio — build contract: generators, models and access

Part of `SPEC.md`'s contract (split from it for size): how an idea becomes a look, which models people may pick,
and who may use the paid ones, how much.

## Generators (idea → look)

`src/generate/index.ts` runs a small in-process queue. An adapter is
`async generate({ text, user, library, rig, groups, prompt?, signal? }) → { title, summary, duration?, globals?,
automation?, layers }` (`groups`: the rig's; `prompt()`: the system prompt and output schema, built once per library
and rig; `signal`: aborted when the server stops). Each idea names a model of the registry (below); its job runs in
that model's transport lane, each lane with its own concurrency, and `STUDIO_GENERATOR_FALLBACK` (a model or
transport, usually `sketch`) takes over when it fails. An idea that names no model (from before the registry) goes
to `STUDIO_GENERATOR`'s transport. Generators find places by the rig's
tags (falling back to group ids and names), describe the installation from the rig (`about`, its fixtures and
groups), and give layers the tags they meant beside the ids. The result is cleaned by `validateLook`
(`shared/schemas/generated.ts`, zod: ≤ 4 layers,
known group ids (none known: the root) and tags, code ≤ 20 kB containing `function pixel`, or modules whose code defines their kind's
function; clips and duration normalised, bad or overlapping clips dropped; `globals` and `automation`
cleaned, a palette name filled in; picks cleaned of unknown tokens; a layer's `palette` dropped; a layer without a
usable `soften` gets `DEFAULT_SOFTEN`) before a look is saved, with `chain: 2` (generators write the one rule: a warp after
what it bends), and the idea set `ready`. Old single-code layers
stay valid. Generators may add
clips and a duration for ideas that describe a progression; most looks have neither.

- `sketch`: offline, keyword → the preset or source a theme names (`sketch-words.json`) + params, place words →
  tags. Colour words choose the palette nearest them in hue and become the nearest swatch's slot (`accent2`; none
  close: the colour itself): the pick of a source's (a preset's top source's) `colours`. Always available.
- `claude`: one Messages API call with the pattern guide + library examples as the system prompt (cached: the same
  bytes on every call), and structured output whose JSON Schema is the generated look's own (`wireSchema(groups)`:
  group ids and tags as enums).
- `codex`: one `codex exec` call (the Codex CLI, signed in with `codex login`): `--ephemeral --skip-git-repo-check
  --ignore-user-config --ignore-rules -s read-only -C <an empty folder> -m <model> -o <answer file> --output-schema
  <the look's schema, strict> -c model_reasoning_effort="<effort>" -c web_search="disabled" -c features.<tool>=false
  … -`, the prompt on stdin (the guide first, the idea last). Started from an argument list, never a shell (on Windows
  an npm `codex.cmd` shim is read for the script it runs); its environment is only what the CLI needs; its whole
  process tree is killed on a wall clock (`timeoutSeconds`, else `STUDIO_CODEX_TIMEOUT_MS`, 300 s), past 4 MB of
  output, or when the server stops. The answer, at most 512 KB, is read as untrusted data like `claude`'s.
- `fleet`: hands the idea to a boxed Fleet worker as an untrusted brief (experimental), in a workspace holding
  copies of the modules `check.ts` imports (the core's, `fseq.ts`, `frames.ts`), as they are. The worker
  also bakes (`node check.ts --bake`); the adapter returns `bake` + `frames` (see below), and
  the queue stores them with the look. This foundry is opt-in: it runs only with `STUDIO_FOUNDRY=on`,
  one job at a time in a slot of its own. While it is off or busy, its ideas go to the one-shot
  generator (`STUDIO_GENERATOR_FALLBACK`, else `sketch`), or wait for it with `STUDIO_FOUNDRY_WAIT=1`.
  Without a systemd user bus (`systemd-run --user --scope` fails, as on WSL) Fleet's boxes have no
  memory cap, and the server warns at start.

## Models (`<STUDIO_DATA>/models.json`, or `STUDIO_MODELS`)

The registry (`shared/schemas/models.ts`), written with the defaults on first run and read again whenever it
changes (a file that does not parse is reported, and the last good one kept):

```
{ "about"?: text, "default": id, "concurrency"?: { "claude"?: n, "codex"?: n, "sketch"?: n },
  "models": [{ "id", "label", "via": "claude" | "codex" | "sketch" | "fleet", "model"?, "effort"?, "maxTokens"?,
               "timeoutSeconds"?, "enabled": true, "roles"?: ["member" | "curator" | "admin", …], "limits"? }],
  "limits"? }                                                       // limits: "Access" below
```

`id` is 1–32 of `[a-z0-9-]`; `model` the provider's name (required for `codex`; `claude` defaults to
`claude-opus-5-5`); `effort` one of the transport's (`claude`: low–max; `codex`: minimal–xhigh); `roles` who may
pick it (none: everyone); `concurrency` the jobs at once per transport (defaults claude 4, codex 2, sketch 4; the
foundry always 1). The defaults: Opus (`claude-opus-5-5`, medium, the default), Sol (`gpt-6.1-sol`, low) and Luna
(`gpt-6-luna`, low) through `codex`, and Sketch. A model can run when its transport can: `claude` with
`ANTHROPIC_API_KEY`, `codex` with the CLI on PATH (`STUDIO_CODEX_BIN`; `warn` when no login is seen), `fleet` with
`STUDIO_FOUNDRY=on`, `sketch` always. The idea form offers the models that are on, offered to the user's role and
able to run, the default first when it is one of them; when the file is first written, `STUDIO_GENERATOR` (`claude`,
`sketch`, `fleet`) names its default.

## Access (invite codes and limits)

Anyone may sign up, browse, edit, preview and use Sketch. A **paid** model (any `via` but `sketch`: it spends money
or the owner's capacity) needs an **unlocked** account, and every account's ideas are **limited**. Admins are exempt
from both. The registry's `limits` (defaults below) and each model's own `limits` set them:

```
"limits"?: { "inviteOnly": true, "perHour": 6, "perDay": 20, "concurrent": 2, "dailyCeiling": 200 }
models[i].limits?: { "perHour"?, "perDay"?, "concurrent"? }
```

- An account's paid ideas share one allowance: `perHour` and `perDay` count its paid ideas created in the last 60
  minutes and 24 hours (rolling), `concurrent` those queued or generating. A model's `limits` add a cap counted on
  that model's ideas alone; a free model is limited only by its own (the default Sketch entry: 30 an hour, 100 a
  day). `dailyCeiling` counts everyone's paid ideas in 24 hours, a spend backstop. `inviteOnly: false` unlocks
  everyone (a private server). A cap of 0 allows none: its 429 has no `Retry-After` and no `nextAt`.
- **One idea is one use**, counted when POST /api/ideas accepts it, whatever comes of it: retries, the fallback and
  any repair inside its job add nothing; "Try again" sends a new idea. The check and the create are one synchronous
  step, so two requests cannot both take the last use.
- A stored user may hold `access = { unlockedAt?, invite?, by?, limits?, resetAt? }`: `invite` the code's id that
  unlocked it, `by` the admin who did; `limits` an admin's override of the global three for this person; ideas
  created before `resetAt` no longer count.
- **Invite codes** (`invites.json`): `{ id, hash, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  updatedAt }`; `hash` is sha256 of the code normalised (upper case, no spaces or dashes); the code itself, 12
  characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` shown as `XXXX-XXXX-XXXX`, is answered once and never stored.
  `uses` 1–1000 (default 1), `days` 1–365 until it expires (none: never). Redeeming takes a use from a code that is
  not revoked, expired or used up and unlocks the account; an unlocked account redeeming changes nothing. Attempts
  are limited per account (5 failures in 15 minutes) and per address (20 in 15 minutes): 429 with `Retry-After`.
- `access = { unlocked, exempt, inviteOnly, limits: { perHour, perDay, concurrent }, left: { hour, day, running },
  nextAt?, full?, models?: { [id]: { hour?, day? } } }` in /api/me and with a 403 or 429: `left` the paid uses this
  account has; `nextAt` when the next frees (when one is 0); `full` the ceiling is reached; `models` what is left on
  each model with its own limits. `invite = { id, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  state: 'active' | 'used' | 'expired' | 'revoked' }`. `person = { id, username, role, access: { unlockedAt?, invite?,
  by?, limits?, resetAt? }, used: { hour, day, running } }`.
