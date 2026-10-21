# The Pi's live engine

Plays looks on City of Gods from the FPP Pi, live: Studio's pattern core runs looks made only of our library
(`public/patterns`), at 40 fps, out as DDP to fppd on the same Pi. Every frame goes through the rose's expansion and
the power compressor, held byte for byte to `compress-fseq.py` (`pi/test/power.test.ts`). The flash guard dips a
look that strobes to the dim `safe` look.

**Installing it on the Pi:** [INSTALL.md](INSTALL.md) (clone, `npm ci --omit=dev`, a dry run, the unit and the ops
hub, updating, rolling back).

> **The ops hub's night-show AUTO mode fights live apps.** Inside the night-show window (21:00–05:02 on the Pi), the
> hub starts the night show over Studio Live within about 15 s, and FPP and the engine write the same channels at
> frame rate. Press STOP on the hub after switching to Studio Live; [INSTALL.md](INSTALL.md#the-night-show-will-play-over-it)
> has the details and the start-time case.

Run from the repo root, on Node 22 (tested on 22.18; `npm run pi` passes `--experimental-strip-types` for an older 22). Node runs the `.ts` directly; the control page is committed as built
(`pi/page/dist`), so the Pi builds nothing and `npm ci --omit=dev` is enough.

```sh
npm run pi -- --dry-run      # render and limit as live, send nothing; a stats line every 5 s
npm run pi                   # live: DDP to 127.0.0.1:4048 (fppd)
npm run pi -- --help         # every setting
```

The stats line reads: the look and its time; fps, render ms (worst); frames skipped (`late`); the generator's
watts and peak; frames the compressor cut; the level, then `BLACKOUT` or `FLASH-TRIPPED` when either is on.
SIGINT or SIGTERM fades out over a second, then sends black frames before exiting.

## The control page

`http://<the Pi>:4043/` from a phone on the same network: blackout, the master, tap tempo with the beat (a ±1 BPM nudge either side), the playing
look's own controls (its `globals.live`), every look to switch to, and the generator's draw. It says when the run is
dry and when the flash guard has cut to `safe` (the safe look plays until someone picks one).

- Its socket (`/ws`, messages in `pi/src/protocol.ts`) takes the page's own origin only: another site open on the
  same phone cannot drive the lights. Each socket is rate-limited, and the page holds at most 32.
- No PIN by default. `--pin 2468` (or `"pin"` in `pi/config.json`) makes the page ask for it before it changes
  anything; five wrong ones lock the page out for a minute.
- `--http 0` turns the page off; `--bind 127.0.0.1` keeps it to the Pi itself.
- The socket also sends what plays (`source`: the look, its modules by ref, at each change) and its clock in the
  state, so Studio's Live tab can follow a dry run behind Studio's `/pi` (SPEC-live "Following /pi"). The Pi itself
  connects to nothing and needs no setting for it.
- The page is Preact on Studio's own components and styles (`pi/page/`). Changed, run `npm run pi:page` and commit
  `pi/page/dist`; `pi/test/page.test.ts` fails while it is stale.

## Settings and looks

- Defaults, then `pi/config.json` (the Pi's own, gitignored, so `git pull` never touches it), then flags. For
  example `{ "look": "fire", "gen": 4000 }`.
- The light settings (`--light FILE`, default `pi/light.json`, gitignored): Studio's Light page's "Download for the
  Pi", the same record Export and the bake checks use (SPEC "Light and output", docs/LIGHT.md). Missing, it is the
  defaults (gamma 2.2, no balance, floor or trims). They bend the colours on the way out only, so the Live tab and the
  engine's frames stay the look's own; the master, blackout and fades scale the light after the curve. The F48s are
  set to Gamma None, so this is the only gamma; their port brightness stays the electrical cap.
- Looks are `pi/looks/<id>.json`, plus the Pi's own `pi/local/looks/` (gitignored; one there replaces a shipped
  look with the same id). A look is Studio's look whose modules name library entries by `ref`; the code always
  comes from the library. `globals.live` lists the controls it offers.

## The simulator

`npm run pi:sim` stands in for fppd on a laptop. Start it, then `npm run pi` beside it. Each second it prints the
frames it got, any that arrived torn (lost packets, or petals that are not what their cells expand to), and the
draw against the generator's budget. `--png out.png` writes the rig from the front each second. On SIGINT it prints
its totals and exits 1 if any frame was torn or over budget.
