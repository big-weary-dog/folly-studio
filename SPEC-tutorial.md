# Folly Studio — the tutorial (part of the contract)

Short paths through the Studio's real controls, one step at a time, in an overlay loaded on first use
(`public/js/ui/tour/`). It opens by itself once per account (`user.tour` unset, SPEC-access "Accounts"; a copy in
localStorage shows it at once), on a screen wider than the phone layout; elsewhere it neither opens nor is offered.
Its welcome says Studio is in development and how to report a problem. First look starts in a blank Studio; the
other paths open `/studio?tour=<path>`, a practice look built from library presets (`public/data/tutorial/<path>.json`:
`{ title, presets: [name] }`) as an unsaved copy, so nothing a person owns changes until they save. A step waits on the
Studio's state through a read-only view (`ui/tour-view.ts`) and finds its control by `data-tour="<name>"`; the tour
writes nothing but the user's `tour`, and moves between pages only as the app's own links do. Replay: the user
menu's Tutorials.
