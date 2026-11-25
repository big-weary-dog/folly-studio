# Archived: the Pi and the live stage

Folly Studio no longer carries these; the tag `archive/pi-2026-11` (dev at 4e59beba) holds them whole:

- **The Pi**: Studio Live, the engine that played looks on the lights over DDP (`pi/`: its page, looks, installer and
  tests), the Pi profile (`STUDIO_PROFILE=pi`), the Pi bundle and its admin tab, the `/pi` preview and its feed, and
  Play on the lights (`/api/lights`, `lights.json`). Its contract was `SPEC-offline.md` and `SPEC-liveplay.md`.
- **The live stage**: `/live` and `/live/control`, their socket and state (`SPEC-live.md`), and relay to the lights
  (the editor's To the lights).

FSEQ export, the render box and bakes, `rig-folly.json`, `tools/check_channels.py`, light settings and look files
stay. The rose's expansion that the channel check reads moved from `pi/data/power.json` (and its builder from
`pi/tools/build_power.py`) to `tools/`.

## Restoring

The files that went, back from the tag:

```
git checkout archive/pi-2026-11 -- pi/ deploy/pi-bundle.sh SPEC-offline.md SPEC-liveplay.md SPEC-live.md \
  src/live/ src/lights.ts src/pi-bundle.ts src/pi-preview.ts src/profile.ts src/socket-origin.ts \
  shared/schemas/live.ts public/js/live-set.ts public/js/relay-ahead.ts public/js/ui/live/ \
  public/js/ui/pi-bundle.tsx public/js/ui/play-lights.tsx public/js/ui/to-lights.tsx public/js/ui/relay-link.ts \
  public/js/ui/relay-panel.tsx public/js/ui/relay-studio.ts public/css/live.css public/css/liveplay.css \
  public/css/relay.css tools/live-bench.ts tools/pi-bundle-check.ts
```

with their tests (`test/live*`, `test/pi-*`, `test/lights.test.js`, `test/profile.test.js`,
`test/engine-output.test.js`, `test/fixtures/engine-output.js`, `test/fixtures/baked-memory.mjs` with
`test/bake-stream.test.js`'s memory-bound tests, and in `test/e2e/` the live, relay, Pi, lights,
jukebox and offline specs and `dry-engine.js`). The code that wired them in (the server's `app.ts`, `api.ts` and
`config.ts`, the sandbox's `runtime.ts` and worker, the app shell, `deploy/host.sh`, the configs and `package.json`'s
`ws` and `@fastify/websocket`) changed in place: put it back by hand from `git diff HEAD archive/pi-2026-11 -- <file>`.

The archive may be deleted later; then the tag is the only copy.
