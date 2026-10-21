# Folly Studio — versions and History (part of the contract)

A look's saved versions (`src/look-versions.ts`, served by `src/api-looks.ts`) and the Studio's History drawer
(`public/js/ui/history/`). The routes are in SPEC "HTTP API".

## What plays

`PLAYS = layers, duration, globals, automation, bpm` (`shared/plays.ts`, re-exported by `look.ts`), with
`playsOf(look)` (layers and duration always, the others when set) and `playsChanged(a, b)`. A version, the bake's
render fields, the stage's copy, the sandbox's extras, the JSON export and the Studio's save and steps all take their
fields from it: a field added to `PLAYS` reaches them all (`test/plays.test.ts`). `title` and `summary` are the
look's words, not what plays.

## Versions

A save that changes what plays keeps what was there as a version (`src/look-versions.ts`): `{ n, how, name?, from?,
ideaId?, ask?, title, summary, layers, duration, bpm, globals?, automation?, savedAt, reviewed? }`. `n` counts up
and is never reused; `how` is `auto` (a save), `ai` (a refinement: its `ideaId` and what it `ask`ed) or `restore`
(of version `from`); `reviewed = { by, flashOverride? }` when a curator had reviewed it. The look holds its own
number and making as `look.version` (`GET` answers its owner with the number alone). The last 20 unnamed versions
are kept, and every named one (at most 50). A version kept before `n` was numbered by its place; one kept before
`bpm` was lacks it and reads as the look's tempo. Versions are their owner's alone: others, curators too, never
see them.

A change to the frames also drops the bake and its frames and clears `reviewed`: anything but `bpm` on a look that
does not move to the beat, where the tempo is only a grid (a bake's render fields hold it on a look that does: a
tempo nobody flash-checked), unless it plays as a reviewed version (a restore). A version's `bpm` is null when the
look had none.

A restore is an edit plus a save (`PUT /api/looks/:id` with `restoredFrom: n`; 400 when the look has no version
`n`). Content that plays exactly as a version a curator reviewed
(`playsOf`, compared canonically) keeps that review, and its frames are baked again (often a stored bake); anything
else is reviewed afresh.

`GET /api/looks/:id/versions` → `{ versions: [versionListed] }` lists them newest first, the look as saved on top,
and `GET /api/looks/:id/versions/:n` → `{ version }` has one with its content (404 when none); both answer 403 to
anyone but the owner:
`versionListed = { n, how, name?, from?, ideaId?, ask?, savedAt, title, layerCount, duration, bpm, tempoGuessed?,
reviewed, current?, shared?, palette }`: `current` the look as saved (its `shared` too), `palette` up to 8 of its
colours (the house palette when it has none), `tempoGuessed` when its `bpm` is the look's; `version` adds `summary`,
`layers`, `globals` and `automation`.

## Named versions

A name (1–80 characters) keeps a version past the 20: at most 50 of a look's versions are named (409 for one more).
`PUT /api/looks/:id { …, versionName }` is "Save a named version…": the save, then the version the look is now
(new or not) takes the name. `PUT /api/looks/:id/versions/:n { name }` → `{ version: versionListed }` names version
`n`, the look as saved or a kept one (404 when none), or `{ name: null }` unnames it, and the next save prunes it
with the rest; both are the owner's alone (403). A version keeps its name when it is kept and when it is restored
from (the restore is a version of its own, unnamed).

## The History drawer

In the Studio, History (`ui/history/`) is a drawer beside the view, opened from the bar, with two tabs and Undo and
Redo. Only the steps model and the keys are in the main bundle; the drawer loads when first opened.

**Steps** (`history/steps.ts`, held by the store as `st.history`): this session's edits of the look, oldest first,
from "Opened the look" (or "New look"). Each edit through `st.edit(fn, { step?, kind?, merge?, ai? })` that changes
the look's content (title, summary, what plays) is a step, named for what it changed ("Level 70%", "Edited the code
of “Glow”", "Added a layer") unless `step` names it; edits that share a `merge` key are one step (a preset's layers
and globals). Quick edits to one thing (a drag, typing) fold into one step until 1.5 s pass, a pointer up or a focus
change seals it. The list is linear, like Photoshop's: clicking a step (or Undo, Ctrl/⌘+Z; Redo, Ctrl/⌘+Shift+Z or
Ctrl+Y) plays the look as it was then and greys the later steps; a new edit drops them. A jump puts back content,
never the look's id, owner or sharing. A save marks its step (it stays across undo); a look away from its saved step
is unsaved. The keys are ignored while typing in a field, the code editor or a dialog. At most 200 steps are kept.

A toast's Undo (a deleted layer, module or clip) and the Refine box's Undo are ordinary undo: they undo their own
step while it is the step now, and say so otherwise. An AI refinement is one step with what was asked, by whom, what
it changed and a link to the idea's log; a refinement undone or dropped is told to the server
(`POST /api/ideas/:id/undo`) at the next save.

**Versions** lists the look's versions newest first (its own saved looks only), each with a strip of its palette's
colours and tags (Saved, In gallery, Reviewed). Preview plays one in the view in place of the work (`st.previewing`
holds the work, which still decides `dirty` and what saves), the view says "Previewing version n", and editing and
saving wait; "Back to my work" puts the work back, "Restore this version" makes it the work, as a step, and saves.
"Save a named version…" asks a name and saves; ✎ on a version names it, renames it, or (left empty) unnames it.
Named ones are tagged Named.
