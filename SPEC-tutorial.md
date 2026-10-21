# Folly Studio — the tutorial (part of the contract)

Short paths through the Studio's real controls, one step at a time, in an overlay loaded on first use
(`public/js/ui/tour/`). It opens by itself once per account (`user.tour` unset, SPEC-access "Accounts"; a copy in
localStorage shows it at once) and once per browser, on a screen wider than the phone layout; elsewhere it neither
opens nor is offered.
Its welcome says Studio is in development and how to report a problem. The paths are chapters of one story: each
builds the same look, Spire rise (a deep Colour wash bed, Bars climbing the spires, Sparkle on top), and opens
`/studio?tour=<path>`, a practice look of where the last chapter left it (`public/data/tutorial/<path>.json`:
`{ title, layers: [preset layer & { tag?, clips? }], palette?, macros?, automation?, bpm? }`, `tag` playing a layer on
the rig's groups with that tag) as an unsaved copy, so nothing a person owns changes until they save.
A step waits on the Studio's state through a read-only view (`ui/tour-view.ts`) and finds its control by
`data-tour="<name>"`; the tour writes nothing but the user's `tour`, and moves between pages only as the app's own
links do: over unsaved edits the app asks first, and keeping them leaves Tutorials open.
Replay: the user menu's Tutorials.

## Paths

In order:

- `first-look`, First look: still being built (report a problem), a source's number, turning the model.
- `colour`, Colour: a colour param by palette role, the Look tab, the palette.
- `layers`, Layers and chains: a layer from a source, its colours, Plays on (groups by rig tag), a view, zoom, solo,
  a choice, a warp and its value, a filter, a module off and on, soften, level, blend, a third layer, order.
- `move`, Movement and time: solo, a view, pause and play, BPM, the beat clock, an LFO, a macro and a value tied to
  it, automation, + Clip.
- `keep`, Keep it, show it: an edit, undo, save, Live, describing an idea (with the invite box when locked).

Each step names one change from where its control starts (never already met when it opens) and says in a sentence
why it helps the look. Its control is scrolled into view in whatever panel scrolls and ringed, the ring following it
as the page scrolls. The page around dims; the preview never does, and the step's card sits off it (and off the ring)
where any place beside the ring or in a corner of the window allows. A step is done when the Studio shows what it
asked for, and moves on by itself unless it waits for Next; Next stays
locked until then, while Skip step and Show me are always there. `test/tour-sync.test.ts` holds each step's
controls, library names, params, pages and practice looks to the app; `test/e2e/tour.spec.js` plays every path.
