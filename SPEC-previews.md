# Folly Studio — gallery previews (part of the contract)

The looping previews on shared looks' gallery cards. The routes are in SPEC "HTTP API".

## Gallery previews

Each shared look gets a looping preview for its card (`src/previews/`): the Playa view from the Studio's default
camera ('fit'), with the venue, at full quality, 260 × 228 px (drawn at 2× and scaled down), sampled at ~13 fps, over the 5 s that move the most (mean change from one
sample to the next, plus a tenth of the mean brightness so a dark stretch loses), its last 0.5 s crossfaded into its
first so it loops; an animated WebP (sharp; quality 50, else 40 or 30 to stay within 300 KB), and a WebP still (the
window's brightest sample) for reduced motion. They are made off the request path, one look at a time, when a look
is shared or a shared look changes (and for every shared look at start, the gallery's top first): from the look's
bake when that is current (a look being baked waits for it), else from the render box (at most 60 s, in the bake
lane). Kept in `<STUDIO_DATA>/previews/<lookId>-<key>.webp` and `-<key>-still.webp`, `key` naming what it renders;
a look keeps its old preview until the new one is written, and previews of looks no longer shared go at the next
start. A look without one shows its card's glass.
Shutdown stops queuing previews and waits for startup backfill and any active preview writes before closing storage.

The camera is the app's own Viewer (`public/js/preview-camera.ts`) in a headless Chromium (playwright-core's
headless shell, `src/previews/playa.ts`), started on first use and closed after a minute idle: no window, its own
profile, no port; it serves itself the viewer's source with the types stripped, so it needs no build. It asks for
the GPU (ANGLE on EGL, with no display; under WSL, Mesa's d3d12 driver when `/dev/dxg` is there) and logs the renderer it got,
as a warning when that is a software one. `STUDIO_PREVIEWS=front` draws them flat instead (the LEDs from the front:
z across, y up), without a browser; the tests and browser checks do.
