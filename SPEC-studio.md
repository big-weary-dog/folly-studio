# Folly Studio — the Studio's editor

Part of the contract (SPEC.md): how the Studio edits a look. The look's own rules are SPEC "Looks" and "Timeline";
every edit here keeps them, so what the Studio saves the API accepts.

- **Groups.** A layer's groups are picked in its Groups drawer (`ui/groups-drawer.tsx`, opened from "Plays on" in its
  settings; a drawer as Modulate's): a tree that ticks a group with every group under it and stores the outermost
  ticked ones; a parent with some of its subgroups ticked shows partly ticked, and one with all of them ticked is
  ticked itself. While it is open the 3D view shows where the layer plays (and the group pointed at) as it is, and
  every other LED at a fixed 2 %, the unlit rig still faint. Add a layer picks the new layer's groups the same way, in
  the same tree beside its list (on a phone, behind its "Plays on" button): it starts on the rig's root, the audition
  plays on the groups ticked, the view focuses them, and the layer (each of a preset's layers) is added on them;
  closing the picker forgets them.
- **Timeline** (`ui/timeline*.tsx`): docked under the 3D view beside Code on a wide screen (drag, trim, fade, zoom,
  snap to ¼ s or beats), a Time tab on a phone (the selected clip's numbers). Its edits (`ui/timeline-model.ts`,
  pure) keep SPEC "Timeline". Under the layers, a lane per modulator (`ui/timeline-mods.tsx`): its
  value over the show (0..1 of its range, as it plays: pace, swing and lanes in), its name and what it drives in the
  lane's head, which opens it on the Look panel; the group folds to its head (kept per browser). Under those, a lane per
  automated macro: choose a macro in the Automate picker to create its lane. New automation… makes a new macro
  named `automation` (then `automation2`, …), range 0..1, initially 0.5, and its lane. A setting's ∿ drawer also
  offers Automate: one edit creates a macro named from its layer and setting, with the setting's range and value,
  binds the setting to it, creates its lane, and opens the timeline. A colour setting automates its rotate, 0..1.
  An already automated setting or macro opens its existing lane; each lane starts flat at 0 and the look's end.
  Click to add a point, drag to move it, double-click to remove it. Points are hollow amber at 0%, half-filled
  violet between the endpoints and filled mint at 100%. Segments blend between amber, violet and mint over the range.
  The bottom
  dock (Code, Timeline, Look) is one height on every tab: a share of the Studio's height (36%, at least 220 px, the
  3D view keeping at least 200 px), dragged by the splitter above it and kept per browser.
- **Title and description** edit in place: the title in the Studio bar with the description (the look's `summary`,
  what its gallery card shows) on a line under it; on a phone, the description is a box in the Look tab.
- **Reorder.** a layer row moves by its ↑ ↓ buttons, a module row (into and out of composites too) by Alt+↑/↓ on its
  controls, either by dragging its grip (`ui/drag-order.ts`, a module's `ui/tree-drag.ts`; any pointer), which marks
  where it lands, the drop one edit; Escape cancels. Composites in the panel (each source a sub-layer of its own, in
  its row): SPEC-library "Composites".
- **Composition** (`ui/chain.tsx`, `ui/params.tsx`, `ui/shelf.tsx`, `ui/look-globals.tsx`): the selected layer's
  module chain (a line a module: kind badge, Custom on a module not standard, name, a source's blend or a filter's
  input, enable, delete; only a custom module's name is editable; wide, the selected one's settings open under it,
  a click on it closing or opening them, ▾ ▸), its Soften row (radius and mode; new layers
  start at `DEFAULT_SOFTEN`), the pickers (Add a module: tabs Sources, Warps, Filters; Add a layer: Blank, a blank
  layer or one source, and Presets, beside the groups the new layer plays on; one-line rows by category with a filter,
  the tab remembered for the session, each row auditioned in the 3D view), the code editor and
  params on the selected module (each number param can be modulated), and a Look panel of globals, the palette
  (its theme line under the menu; each swatch titled by its slot, `body2 · #fd7f40`), its modulators and its faders
  (macros without a mod; `ui/look-mods.tsx`). A modulator is a card: its name to rename, how it moves, its value now,
  ∿ to edit it, × to delete it, and a chip for each param it drives (layer › param), which selects that layer and
  module and opens the param's ∿; a fader's row lists what it drives, paces or swings the same way. Modulating is in
  place (`ui/modulate.tsx`, `ui/mod-live.tsx`): ∿ opens a drawer (`ui/drawer.tsx`), a panel the Studio's full
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
  colour's rotate and the modulators that follow it; deleting it
  drops them. On a phone: globals and palette in the Look tab;
  the chain read-only but for enable and params.
- **Phones** (≤ 899 px wide; `ui/phone/`, `css/phone.css`): the 3D view over one panel, switched by the tabs Layers,
  Time, Look and More. Layers lists one row a layer (name, mute, status); tapping one opens its settings in
  the same panel (‹ Layers back, its name, mute and solo, plays on, the chain, the params). The light view hides
  blend, level, solo and moving up or down on the rows, the layer and module names and Soften in the settings, the
  automation lanes and the 3D view's style buttons; More holds the code editor, the 3D view's Show unlit, LEDs
  and quality, and Full detail, which shows them all again (kept per browser). On a phone the preview starts without
  Show unlit, the Playa view drops the scaffold lines, and Points draws at a pixel ratio of 1.
- **Colours** (`ui/picks.tsx`, `ui/pick-model.ts`; SPEC-library "Palettes"): a colour param is one row like a number's: its pick in
  a field the size of a number's (`kit.tsx` Scrub), its text over the colours it plays (the field opens the pick
  tile), ∿ to move its rotate (the same popover), ↺. The tile is TD's pick: a row per role (a box for the whole
  role, a cell per slot), a custom row (its colours, each a cell whose × removes it; below 4, a swatch that opens
  the browser's chooser and + to add the colour it shows, in place of the whole palette or rainbow as a slot is),
  the whole palette, rainbow, then whether roles alternate (`/`), blend, and range and rotate as number fields. On a
  phone the tile is a sheet with the palette's roles and the custom row; the whole palette, rainbow,
  blend, range and rotate show when set.
