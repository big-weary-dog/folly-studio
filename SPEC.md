# Folly Studio — build contract

The shared contract for everyone building Folly Studio. Code may refine details, but the
**interfaces** below are what the pieces rely on; change them here first. Where each piece lives: CONTRIBUTING
"Layout".

This file is the entry point; the area files in `spec/`, listed below, are equally part of the contract.

Folly Studio is a web app where people log in, compose a show from the pattern library, see it on a browser model
of the installation (the Gothic Folly; any other described by a rig file), edit it, and export it toward the real
installation.

## Ground rules

- **Dependencies when they make life easier**, pinned exactly in `package.json` with `package-lock.json` committed
  (CONTRIBUTING "Dependencies" says why each is there). They are installed at setup (the browser's bundled at build
  time), never fetched at run time and never from a CDN, so the app, the sandbox and the boxes work offline on the
  playa. ES modules everywhere (`"type": "module"`), TypeScript or JavaScript: Node ≥ 22.18 runs the server's, the
  boxes' and the tests' as written (types stripped, no build); Vite builds the browser's into `dist/`.
- **Every LED comes from the rig file `STUDIO_RIG` picks** (SPEC "Rig"; the Folly's `public/data/rig-folly.json` by
  default), built from the lighting repo's pixel maps, never by hand. Nothing else names the installation.
- **Only library patterns run.** They run inside the sandbox page (spec/library "Sandbox protocol") or the render box
  (its own process: spec/frames "Where bakes run"), never in the app page or the server's own Node process (except
  in tests, on our own library patterns). What a box returns is data.
- Patterns see **x = depth** (front → back), **y = height**, **z = left → right** facing the front; the rig's
  `axes` map its own coordinates onto these (the Folly's are the repo's: front/playa −12 m → back +14 m, 0 →
  18.5 m, −9 → +8 m).
- Frame rate, universes, channels per universe and colour order are the rig's `output`. The Folly: 40 fps,
  universes 1–80 of 510 channels (xLights networks), so a full frame is **40,800 channels**, RGB.

## The area files

`spec/<area> "<section>"` means that section of `spec/<area>.md`; `SPEC "<section>"` means the section of that name
in whichever area file holds it.

- [spec/rig.md](spec/rig.md): **Rig** (the rig file, addressing, axes, fixtures and groups), **The 3D view**, **Light
  and output**.
- [spec/library.md](spec/library.md): **Pattern code**, **The pixel `p`**, **Stdlib**, **Directions**, **Modules** (a
  layer is a chain), **Composites**, **Attached modules**, **Library**, **Pictures**, **Spatial modules**, **The
  neighbour map**, **History**, **Globals**, **Param bindings**, **Integrated clocks**, **Palettes**, **Sandbox
  protocol** (runtime.ts ⇄ sandbox.html, `core/pattern-core.ts`'s exports).
- [spec/looks.md](spec/looks.md): **Looks** (what gets saved), **Library only** (the one-time step on a data folder),
  **Timeline**, **Look files**, **Versions and History**.
- [spec/http.md](spec/http.md): **Static files**, **Updates**, **HTTP API** (every route), **Accounts and access**
  (accounts, guests, visitors, roles, moderation, Admin, People, Privacy, Stats, No AI).
- [spec/frames.md](spec/frames.md): **Baked frames** (the render box, checks, storage, wire, playback, downloads),
  **Where bakes run** (verification, the bake setting, library only), **Gallery previews**.
- [spec/studio.md](spec/studio.md): The Studio's editor (**Groups**, **Timeline**, **Composition**, **New look**,
  **Simple**, **Phones**, **Colours**), **Tutorial**, **Bug reports**.
