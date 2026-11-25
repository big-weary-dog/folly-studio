# Folly Studio — the Studio, the tutorial and bug reports

Part of the [build contract](../SPEC.md).

How the Studio edits a look. The look's own rules are SPEC "Looks" and "Timeline"; every edit here keeps them, so
what the Studio saves the API accepts.

- **Groups.** A layer's groups are picked in its Groups drawer (`ui/shelf/groups-drawer.tsx`, opened from "Plays on" in its
  settings; a drawer as Modulate's): a tree that ticks a group with every group under it and stores the outermost
  ticked ones; a parent with some of its subgroups ticked shows partly ticked, and one with all of them ticked is
  ticked itself. While it is open the 3D view shows where the layer plays (and the group pointed at) as it is, and
  every other LED at a fixed 2 %, the unlit rig still faint. Add a layer picks the new layer's groups the same way, in
  the same tree beside its list (on a phone, behind its "Plays on" button): it starts on the rig's root, the audition
  plays on the groups ticked, the view focuses them, and the layer (each of a preset's layers) is added on them;
  closing the picker forgets them.
- **Timeline** (`ui/timeline/`): docked under the 3D view beside Look on a wide screen (drag, trim, fade, zoom,
  snap to ¼ s or beats), unavailable on phone. Its edits (`ui/timeline/model.ts`,
  pure) keep SPEC "Timeline". Under the layers, a lane per modulator (`ui/timeline/mods.tsx`): its
  value over the show (0..1 of its range, as it plays: pace, swing and lanes in), its name and what it drives in the
  lane's head, which opens it on the Look panel; the group folds to its head (kept per browser). Under those, a lane per
  automated macro: choose a macro in the Automate picker to create its lane. New automation… makes a new macro
  named `automation` (then `automation2`, …), range 0..1, initially 0.5, and its lane. A setting's ∿ drawer also
  offers Automate: one edit creates a macro named from its layer and setting, with the setting's range and value,
  binds the setting to it, creates its lane, and opens the timeline. A colour setting automates its rotate, 0..1.
  Settings inside Composites automate the same way. An already automated setting or macro opens its existing
  lane; each lane starts flat at 0 and the look's end. A missing setting or macro reports that it was not found;
  the capacity warning is only for the macro or lane limit.
  Click to add a point, drag to move it, double-click to remove it. Points are hollow amber at 0%, half-filled
  violet between the endpoints and filled mint at 100%. Segments blend between amber, violet and mint over the range.
  The bottom
  dock (Timeline, Look) is one height on both tabs: a share of the Studio's height (36%, at least 220 px, the
  3D view keeping at least 200 px), dragged by the splitter above it and kept per browser.
- **Title and description** edit in place: the title in the Studio bar (behind Look details on phone), with
  the description (the look's `summary`,
  what its gallery card shows) on a line under it; on a phone, the description is under Look → Share details.
- **Reorder.** a layer row moves by its ↑ ↓ buttons, a module row (into and out of composites too) by Alt+↑/↓ on its
  controls, either by dragging its grip (`ui/layers/drag-order.ts`, a module's `ui/chain/tree-drag.ts`; any pointer), which marks
  where it lands, the drop one edit; Escape cancels. Composites in the panel (each source a sub-layer of its own, in
  its row): spec/library "Composites".
- **Composition** (`ui/chain/chain.tsx`, `ui/params/params.tsx`, `ui/shelf/shelf.tsx`, `ui/globals/look-globals.tsx`): the selected layer's
  module chain (a line a module: kind badge, the library's name, a source's blend or a filter's
  input, enable, delete; wide, the selected one's settings open under it,
  a click on it closing or opening them, ▾ ▸), its Soften row (radius and mode; new layers
  start at `DEFAULT_SOFTEN`), the pickers (Add a module: tabs Sources, Warps, Filters; Add a layer: Sources,
  one source, and Presets; only the library's modules, never a blank one, beside the groups the new layer plays on;
  one-line rows by category with a filter, the tab remembered for the session, each row auditioned in the 3D view;
  module auditions use the same chain insertion as Add), the
  params on the selected module (each number param can be modulated), and a Look panel of globals, the palette
  (its theme line under the menu; each swatch titled by its slot, `body2 · #fd7f40`), its modulators and its faders
  (macros without a mod; `ui/globals/look-mods.tsx`), with + Macro on laptop. A modulator is a card:
  its name to rename, how it moves, its value now, ∿ to edit it, × to delete it, and a chip for each param it drives
  (layer › param), which selects that layer and
  module and opens the param's ∿; a fader's row lists what it drives, paces or swings the same way. Modulating is in
  place (`ui/params/modulate.tsx`, `ui/params/mod-live.tsx`): ∿ opens a drawer (`ui/studio/drawer.tsx`), a panel the Studio's full
  height between the 3D view and the side, which shrinks the view beside it and fits a 1366×768 screen unscrolled
  (a sheet on a phone); one drawer shows at a time, one opened from inside another stacks over it, Escape or ×
  closes it. Kinds LFO (its wave over two cycles in the param's range with the playhead, shape, rate in beats a
  cycle with pills from ¼ beat to 4 bars or, its beat clock off, in Hz, Rate × and Swing × a fader, From/To; a new
  one swings a quarter of the range round the field's value), Macro (the look's modulators with their value now, its
  faders, its globals; at its lowest and at its highest), Off. A binding to the clip envelope, or a modulator's
  tempo pulse shows as old with Off; neither is offered. A speed (a param named for one or for a spin, or a
  rate a minute) has a beat clock beside its number: on, it reads per beat and stores `{ mod: 'beats', per }`
  (keeping its value at the look's bpm); off, a plain number a second. Each change applies as it is made; Revert
  puts back what was there when it opened.
  "Share this LFO as a modulator…" makes the LFO a new modulator, named from where the layer plays and the param
  (`roseSpeed`), and binds the param to it. With a modulator picked, the drawer renames it and its own ∿ (LFO,
  Macro: following a fader, Off) sets how it moves, for every param that follows it. A bound row shows a live
  chip: what moves it, its range, its value now and a bar. Renaming a macro carries its lane, its bindings, a
  colour's rotate and the modulators that follow it, throughout Composite sub-layers too; deleting it
  drops them. Its explicit live-control entry is renamed or removed in the same undoable edit.
  Duplicating a layer gives every nested module a fresh id and carries filter inputs and attachments to the copies.
  On a phone: globals and palette in the Look tab;
  the chain allows enable, params and + Source in a composite. + Source offers sources alone on every screen.
  Module deletion names all attached or contained modules it removes; Undo restores the whole edit.
- **New look** (My looks' New look, `/studio?new`) opens the picker as "Start a look": Presets first, then Sources,
  with no groups to pick. Each row auditions in place of the look; the one picked becomes the look, its layers on the
  whole rig, its title and the globals it needs, one step that Undo takes back. Closing it keeps the blank look
  (one source layer). A guest's work kept in the browser is not opened under it.
  Mute and Solo audition the look without changing saved content. FSEQ exports the current preview and asks
  before excluding muted or unsoloed layers; its form explains that JSON, Save and Check & bake use the full look.
- <a id="simple"></a>**Simple.** On a laptop the Studio is Simple until the user menu's **Advanced editing** is
  switched on: the 3D view, its camera, the layers (name, mute, solo, order), the selected module's settings, the
  dock's Look tab (the palette, and the look's faders if it has any), Share, Export (Check & bake, the look's JSON)
  and Save. Advanced adds the Timeline tab, History, ∿ on every setting, modulators and + Macro, Plays on, Soften,
  a layer's blend and level, Composite and + Module, Export .fseq and the 3D view's style buttons. The choice is
  kept per browser; unset, an account starts Advanced and a guest or visitor Simple (a visitor has no menu, so
  stays Simple). A phone has its own light view (below) and no Advanced editing. Clips, automation, modulation and
  the groups a layer plays on keep playing in Simple, unseen.
- <a id="phones"></a>**Phones** (≤ 899 px wide; `ui/phone/`, `css/phone.css`): the 3D view over one panel,
  switched by Layers,
  Look and More. The preview and transport occupy 240 px while using these panels; venue scenery stays.
  Time, Full detail and automation/modulation authoring are unavailable; the Timeline does not
  mount on phone. Existing clips, automation and bindings keep playing. Look keeps palette and existing performance
  faders, Share, and description under Share details.
  It omits macro/modulator authoring, bake/export and recent-look navigation.
  The separate brand header is omitted in Studio: Menu, the look title and Save share a row, with rename and
  History behind Look details. The module chain opens behind a module selector. Every module keeps its first
  visible control row in front; the remaining rows open under More settings. A paired petals/cells row stays together.
  Palette access stays in Look. Solo and Reset all sit in the layer menu.
  My looks and Gallery omit file import/export, layer counts, dates and introductions; Delete, Approve, Hide and Report
  open from each card's Actions. Admin uses a page selector: emergency baking and
  compact health/queue status stay available. Light calibration/files, report investigation,
  stats history/request investigation stay on laptop; baking details open on demand.
  Login keeps mode choice, fields, rules, feedback and actions, with a compact brand and no pitch or rose artwork.
  Layers lists one row a layer (name, mute, status); tapping one opens its settings in
  the same panel (‹ Layers back, its name, mute, the layer menu, plays on, module selector and params).
  The light view hides
  blend, level, solo and moving up or down on the rows, the layer and module names and Soften in the settings, the
  3D view's style buttons. More holds the 3D view's Show unlit, LEDs
  and quality. On a phone the preview starts without
  Show unlit, the Playa view drops the scaffold lines, and Points draws at a pixel ratio of 1.
- **Colours** (`ui/params/picks.tsx`, `ui/params/pick-model.ts`; spec/library "Palettes"): a colour param is one row like a number's: its pick in
  a field the size of a number's (`kit.tsx` Scrub), its text over the colours it plays (the field opens the pick
  tile), ∿ to move its rotate (the same popover), ↺. The tile is TD's pick: a row per role (a box for the whole
  role, a cell per slot), a custom row (its colours, each a cell whose × removes it; below 4, a swatch that opens
  the browser's chooser and + to add the colour it shows, in place of the whole palette or rainbow as a slot is),
  the whole palette, rainbow, then whether roles alternate (`/`), blend, and range and rotate as number fields. On a
  phone the tile is a sheet with the palette's roles and the custom row; the whole palette, rainbow,
  blend, range and rotate show when set.

## Tutorial

A short path through the Studio's real controls, one step at a time, in an overlay loaded on first use
(`public/js/ui/tour/`). It opens by itself once per account (`user.tour` unset, spec/http "Accounts"; a copy in
localStorage shows it at once) and once per browser, on a screen wider than the phone layout; elsewhere it neither
opens nor is offered.
Its welcome says Studio is in development and how to report a problem. There is one path, on a practice look, Rose
and arches (the rose window blooming ring by ring, comets on the arches, a starfield under them): it opens
`/studio?tour=<path>`, the look (`public/data/tutorial/<path>.json`: `{ title, layers: [preset layer & { tag?,
clips? }], palette?, macros?, automation?, bpm?, view? }`, `tag` (one or several) playing a layer on the rig's groups
with that tag, `view` the rig view the preview opens on) as an unsaved copy, so nothing a person owns changes until
they save. Every step's control shows in Simple as well as Advanced (spec/studio "Simple").
A step waits on the Studio's state through a read-only view (`ui/tour/view.ts`) and finds its control by
`data-tour="<name>"`; the tour writes nothing but the user's `tour`, and moves between pages only as the app's own
links do: over unsaved edits the app asks first, and keeping them leaves Tutorials open.
Replay: the user menu's Tutorials.

### The path

`first-look`, Getting around: pause and play, a layer (click Arches), a colour (its comets' colours by palette role),
mute (the Starfield, off and on again), save. Guests instead learn that work stays in this browser and an account is
needed to save, with Next available.

Each step names one change from where its control starts (never already met when it opens) and says in a sentence
why it helps the look. Its control is scrolled into view in whatever panel scrolls and ringed, the ring following it
as the page scrolls. When the control sits in a larger part being worked on (`data-tour-area`: a module's row and its
settings, a drawer such as ∿'s, an automation lane, or a step's `area`: the list a drag runs along), that part is a
second, quieter box, left as clear as the ring. Between controls, within a step or to the next one, the ring stays
half a second on the one just used. The page around dims; the preview never does, and the step's card sits off it
(and off the ring and its box)
where any place beside the ring or in a corner of the window allows. A step is done when the Studio shows what it
asked for (judged from the Studio as it is set up, never while it loads), and moves on by itself unless it waits
for Next or was met already as it opened; Next stays
locked until then, while Skip step is always there. `test/tour-sync.test.ts` holds each step's
controls, library names, params, pages and practice looks to the app; `test/e2e/tour.spec.js` plays the path.

## Bug reports

F8 on any page (or "Report a problem" in the user menu, for phones) files a report for signed-in accounts.
Guests and signed-out visitors see an explanation that reporting needs an account before the form opens.
That explanation closes when an account signs in.
The press freezes the moment:
the page's state is read first, the 3D view's next frame is kept as a JPEG (≤ 960 px wide, quality 0.8), then
everything pauses (the preview's loop and the 3D view) until the form
closes, when it all resumes as it was. The form asks "What went wrong?" (Enter sends, Shift+Enter is a new line,
Esc cancels) with "Include screenshot" on.

`report = { format: 1, at, note, build, page: { path, title, viewport: [w, h, dpr], userAgent, gl }, toasts,
errors, dialogs, sources: { studio?, live?, look? }, screenshot? }`: `toasts` the last 50, `errors` the page's last 100
(window errors, unhandled rejections, console.error); `sources.studio` the look (id, title, `draft`: the unsaved
look as save() sends it, `dirty`), the selection, picked modules, mute and solo, the layout, the timeline's
selection and zoom, the clock (`t`, playing, speed, baked), the preview (view, mode, tier, quality, venue, dimmed,
flashing, stats), the heavy layers, the problem shown and each layer's status, and the library and rig by name and
size; `sources.live` the stage's rev, driver, look and blackout.
**Report this look** (spec/http "Moderation") sends the same report without a screenshot or freeze, its note from
a form asking "What is wrong with this look?", and `sources.look = { id, title, owner, ownerName }`; the Reports
tab names the look and opens it. A reader that throws gives `{ unreadable }`; each
piece is cut at 64,000 characters. Everything is scrubbed (`core/scrub.ts`): keys naming secrets blanked, IPs
masked, URLs without query or fragment; the path has no query or hash; no cookies.

The server stores `<STUDIO_DATA>/reports/<stamp>-<id>/report.json` (adding `server: { user: { id, username },
build, logs }`, its last warn and error lines) and `shot.jpg`, keeping the newest 500 within 500 MB and none older
than `STUDIO_REPORTS_DAYS` (default 90 days): a save, the server's start and an hourly sweep remove the rest, oldest
first. Deleting an account leaves its reports to age out like the rest. The privacy page (spec/http "Privacy")
reads the days from `GET /api/privacy`. Admins read them on Admin's Reports tab; "Open as captured" opens `/studio?report=<id>`: the captured
draft in an unsaved editor, at the captured time, view, quality, selection and layout, paused, so a browser run
reproduces it. `node tools/reports.ts list | get <id>` reads them from `STUDIO_DATA` directly.
