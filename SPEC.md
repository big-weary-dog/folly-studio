# Folly Studio — build contract

The shared contract for everyone building Folly Studio. Code may refine details, but the
**interfaces** below are what the pieces rely on; change them here first. Where each piece lives: CONTRIBUTING
"Layout".

This file is the entry point; the linked `SPEC-*.md` files are equally part of the contract.
`SPEC "<section>"` means the section in the area file linked below.

Folly Studio is a web app where people log in, describe a show idea, get it turned into
pattern code, see it on a browser model of the installation (the Gothic Folly; any other described by a rig
file), edit it, and export it toward the real installation.

## Ground rules

- **Dependencies when they make life easier**, pinned exactly in `package.json` with `package-lock.json` committed
  (CONTRIBUTING "Dependencies" says why each is there). They are installed at setup (the browser's bundled at build
  time), never fetched at run time and never from a CDN, so the app, the sandbox and the boxes work offline on the
  playa. ES modules everywhere (`"type": "module"`), TypeScript or JavaScript: Node ≥ 22.18 runs the server's, the
  boxes' and the tests' as written (types stripped, no build); Vite builds the browser's into `dist/`.
- **Every LED comes from `public/data/rig.json`** (SPEC "Rig"), built from the lighting repo's pixel maps, never
  by hand. Nothing else names the installation.
- **Pattern code is untrusted.** It only ever runs inside the sandbox page (below) or a box
  (bubblewrap: the render box, a Fleet worker's; else library only: SPEC-baking), never in the app page or the
  server's own Node process (except in tests, on our own library patterns). What a box returns is data.
- Patterns see **x = depth** (front → back), **y = height**, **z = left → right** facing the front; the rig's
  `axes` map its own coordinates onto these (the Folly's are the repo's: front/playa −12 m → back +14 m, 0 →
  18.5 m, −9 → +8 m).
- Frame rate, universes, channels per universe and colour order are the rig's `output`. The Folly: 40 fps,
  universes 1–80 of 510 channels (xLights networks), so a full frame is **40,800 channels**, RGB.

## Rig (`public/data/rig.json`)

[The rig file, addressing, axes, fixtures and groups](SPEC-rig.md#rig-publicdatarigjson), part of this contract.

## The 3D view

[The viewer, rendering modes, quality and venue](SPEC-rig.md#the-3d-view), part of this contract.

## Light and output

[The output transform and shared light settings](SPEC-rig.md#light-and-output), part of this contract.

## Pattern code and the library

In `SPEC-library.md`, part of this contract: **Pattern code** (what people and the AI write), **The pixel `p`**,
**Stdlib**, **Directions**, **Modules** (a layer is a chain; the warp contract), **Composites**, **Attached
modules**, **Library**, **Spatial modules**, **History**, **Globals**, **Param bindings**, **Integrated clocks** and
**Palettes**. `SPEC "<one of those>"` means that file.

## Looks (what gets saved)

[The saved look schema, layers, modules, globals and automation](SPEC-looks.md#looks-what-gets-saved), part of this contract.

### Timeline

[Duration, tempo, clips, fades and transitions](SPEC-looks.md#timeline), part of this contract.

## Sandbox protocol (runtime.ts ⇄ sandbox.html)

[The isolated runner, messages, core exports and FSEQ helpers](SPEC-sandbox.md#sandbox-protocol-runtimets--sandboxhtml),
part of this contract.

## Static files

[The build, static serving, caching and compression](SPEC-http.md#static-files), part of this contract.

### Updates

[How an open page picks up a new build](SPEC-http.md#updates), part of this contract.

## HTTP API (JSON; cookie session)

[Routes, request bodies, responses and session rules](SPEC-http.md#http-api-json-cookie-session), part of this contract.

## Bug reports

In `SPEC-reports.md`, part of this contract: F8 reports, what they hold, and where the server keeps them.

## Generators and models

In `SPEC-generators.md`, part of this contract: **Generators** (idea → look) and **Models** (the registry).

## Accounts and access

In `SPEC-access.md`, part of this contract: **Accounts** (roles, sign-in), **Admin** (its pages), **Access** (invite
codes and limits on the paid models) and their routes.

## The live stage

In `SPEC-live.md`, part of this contract: the shared `/live` stage, its socket (`/api/live/socket`), its state and
the `/live/control` page.

## Offline on the Pi, and the Pi preview

In `SPEC-offline.md`, part of this contract: the Pi profile (`STUDIO_PROFILE`, `profile`), `/pi` (a Studio Live
engine behind Studio) and look files; in `SPEC-liveplay.md`, the live play controller.

## Gallery previews

Each shared look's looping preview for its card: `SPEC-previews.md`, part of this contract.
The gallery's **Approved** toggle beside search shows only looks marked reviewed by a curator. It starts off;
search and Approved apply together, and approving a card updates the filter immediately.

## Baked frames

[The render box, checks, storage, wire format, playback and downloads](SPEC-frames.md#baked-frames), part of this contract.
