# Folly Studio — the tutorial (part of the contract)

Short paths through the Studio's real controls, one step at a time, in an overlay loaded on first use
(`public/js/ui/tour/`). It opens by itself once per account (`user.tour` unset, SPEC-access "Accounts"; a copy in
localStorage shows it at once) and once per browser, on a screen wider than the phone layout; elsewhere it neither
opens nor is offered.
Its welcome says Studio is in development and how to report a problem. The paths are chapters of one story: each
builds the same look, Rose and arches (the rose window blooming ring by ring, comets on the arches, a starfield under
them), and opens `/studio?tour=<path>`, a practice look of where the last chapter left it
(`public/data/tutorial/<path>.json`: `{ title, layers: [preset layer & { tag?, clips? }], palette?, macros?,
automation?, bpm?, view? }`, `tag` (one or several) playing a layer on the rig's groups with that tag, `view` the rig
view the preview opens on) as an unsaved copy, so nothing a person owns changes until they save.
A path that starts on another page names its practice look (`look`), where its Studio steps go.
A step waits on the Studio's state through a read-only view (`ui/tour-view.ts`) and finds its control by
`data-tour="<name>"`; the tour writes nothing but the user's `tour`, and moves between pages only as the app's own
links do: over unsaved edits the app asks first, and keeping them leaves Tutorials open.
Replay: the user menu's Tutorials.

## Paths

In order:

- `first-look`, Getting around: turning the model, a view, zoom, Fit, pause
  and play, the way to Ideas.
- `idea`, From an idea: describing a look on Ideas, then Turn it into a look, which while that step is open opens the
  practice look `idea` in place of asking a model (`tourIdea` in `ui/tour-view.ts`: nothing is sent, and it works on
  a locked account); its layers. On the Pi, which has no Ideas (SPEC-offline), the path starts on its
  look and leaves out the steps on Ideas or going there.
- `modules`, Modules and colour: a source's number, a choice, a colour param by palette role, the Look tab, the
  palette.
- `layers`, Layers and chains: solo, a filter, its choice, a module off and on, a warp and its value, soften, Plays on
  (groups by rig tag), a preset, a module inside it, level, blend, order, mute.
- `time`, Time: BPM, the beat clock, + Clip.
- `moves`, Values that move (advanced): ∿ and an LFO, its rate and range, a square and a saw wave on other kinds of
  value, a macro, two values tied to it, the fader moved, automation.
- `keep`, Keep it, show it: an edit, undo, save, Live.

Each step names one change from where its control starts (never already met when it opens) and says in a sentence
why it helps the look. Its control is scrolled into view in whatever panel scrolls and ringed, the ring following it
as the page scrolls. The page around dims; the preview never does, and the step's card sits off it (and off the ring)
where any place beside the ring or in a corner of the window allows. A step is done when the Studio shows what it
asked for (judged from the Studio as it is set up, never while it loads), and moves on by itself unless it waits
for Next or was met already as it opened; Next stays
locked until then, while Skip step and Show me are always there. `test/tour-sync.test.ts` holds each step's
controls, library names, params, pages and practice looks to the app; `test/e2e/tour.spec.js` plays every path.
