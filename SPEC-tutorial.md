# Folly Studio — the tutorial (part of the contract)

Short paths through the Studio's real controls, one step at a time, in an overlay loaded on first use
(`public/js/ui/tour/`). It opens by itself once per account (`user.tour` unset, SPEC-access "Accounts"; a copy in
localStorage shows it at once) and once per browser, on a screen wider than the phone layout; elsewhere it neither
opens nor is offered.
Its welcome says Studio is in development and how to report a problem. First look starts in a blank Studio; the
other paths open `/studio?tour=<path>`, a practice look built from library presets
(`public/data/tutorial/<path>.json`: `{ title, presets: [name], bpm? }`) as an unsaved copy, so nothing a person
owns changes until they save. A step waits on the Studio's state through a read-only view (`ui/tour-view.ts`) and
finds its control by `data-tour="<name>"`; the tour writes nothing but the user's `tour`, and moves between pages
only as the app's own links do: over unsaved edits the app asks first, and keeping them leaves Tutorials open.
Replay: the user menu's Tutorials.

## Paths

- `first-look`, First look: still being built (report a problem), the Studio, a preset, a view, a module, a value,
  mute.
- `layers`, Layers and chains: a layer, Plays on (groups by rig tag), blend, level, order, + Module, on/off, soften.
- `move`, Movement and time: play and pause, a module, ∿, BPM, the beat clock, + Clip, automation.
- `colour`, Colour: a module, its colours, the Look tab, the palette.
- `keep`, Keep it, show it: an edit, undo, save, Live, describing an idea (with the invite box when locked).

A step is done when the Studio shows what it asked for, and moves on by itself unless it waits for Next; Next stays
locked until then, while Skip step and Show me are always there. `test/tour-sync.test.ts` holds each step's
controls, library names, params, pages and practice looks to the app; `test/e2e/tour.spec.js` plays every path.
