# Folly Studio — offline on the Pi, and look files (part of the contract)

The same Studio, run on the FPP Pi with no internet (the Pi profile), and the files that carry looks between two
Studios. `src/profile.ts` holds the profile; `public/js/ui/look-file.ts` the files. Installing it on the Pi:
`pi/STUDIO.md`.

## The Pi profile

`STUDIO_PROFILE` is `hosted` (unset: the public site, as the rest of the contract describes) or `pi`. Under `pi`:

- **No generators.** No model registry is read and no generator runs; ideas left in the data stay as they are.
  The routes that make or read ideas, models and their access are not there (404): `/api/ideas…`,
  `POST /api/looks/:id/refine`, `/api/models`, `/api/admin/models`, `/api/admin/ideas/…`, `/api/invite` and
  `/api/admin/invites…`, `/api/admin/people…`. `GET /api/me` has no `access`.
- **`profile`.** `POST /api/signup`, `POST /api/login` and `GET /api/me` answer `profile: 'hosted' | 'pi'` beside
  `user`. Under `pi` the app has no Ideas tab, no Refine panel and no Models or Access tab under Admin; its home is
  My looks, and `/ideas` leads there. The tutorial (SPEC-tutorial) leaves out its steps on Ideas.
- **The lights.** `/pi` (below) is the Pi's own Studio Live engine, not a dry run, and is open to curators as well
  as admins. Their header has **Lights** (`/pi/`, the engine's control page).
- **Defaults.** `STUDIO_PREVIEWS` is `front` (no browser on the Pi) and `STUDIO_FRAMES_MAX_BYTES` 1 GB (an SD
  card); either setting still wins.
- **Listening.** `HOST` may be any address. Under `hosted` the server refuses to start on anything but loopback
  (`127.0.0.1`, `localhost`, `::1`): the public site is reached through its tunnel.

Everything else is the hosted Studio's: accounts (the Pi's own), looks, versions, the gallery, bakes (503 without
bubblewrap), `/live` and bug reports.

## The Pi preview

With `PI_PREVIEW_URL` set (a Studio Live engine on loopback, started with `--base /pi`: a dry run on the hosting
machine, the real one on the Pi), `GET /pi`, `/pi/*` and the socket `/pi/ws` pass through to it unchanged, for
signed-in admins only (curators too under the Pi profile): no session is 401, anyone else 403, and a socket from
another origin 403. Pages keep the engine's own CSP; an engine that is down is 502. The socket carries the engine's
protocol (`pi/src/protocol.ts`): text frames up to 1 KB from the page. Unset, there is no `/pi`.

## Look files

A look file is JSON, `application/json`, named for its title (`<slug>.json`):

```
{ "title", "summary", "chain": 2, "duration", "layers", "bpm"?, "globals"?, "automation"? }
```

the look's words, `chain`, and what plays (SPEC-history "What plays"), as the Studio's Export → Look JSON writes it.
Several looks go in one file as `{ "looks": [look file] }` (`folly-looks-mine-<date>.json`,
`folly-looks-gallery-<date>.json`).

- **Export many.** My looks and the Gallery have **Export all**: every look the page lists (not just those a search
  shows), fetched one at a time with `GET /api/looks/:id`, as one file.
- **Import.** My looks has **Import**: a file picker taking one or more files, each a look file or a file of looks.
  Each look is `POST /api/looks` with its title, summary, `chain` and what plays, so the same checks apply; it
  becomes the importer's, unshared, with no idea. A look without `chain` is converted as any such `POST` is (SPEC
  "Looks"). One look refused (400, or past the 256 KB body) does not stop the rest: the page says how many came in
  and names each one that did not, with the server's reason.
