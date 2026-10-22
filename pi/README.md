# The Pi's live engine

Plays looks on City of Gods from the FPP Pi, live: Studio's pattern core runs looks made only of our library
(`public/patterns`), at 40 fps, out as DDP to fppd on the same Pi. Every frame goes through the rose's expansion and
the power compressor, held byte for byte to `compress-fseq.py` (`pi/test/power.test.ts`). The flash guard dips a
look that strobes to the dim `safe` look.

**Installing it on the Pi:** [SETUP.md](SETUP.md) from a USB stick with no internet (the engine alone, or with
Studio), or [INSTALL.md](INSTALL.md) online (clone, `npm ci --omit=dev`, a dry run, the unit and the ops hub,
updating, rolling back).

> **Start it from the ops hub.** Switching to Studio Live there pauses the night show, and switching back to FPP
> resumes it; at the show's start (21:00) the hub takes the lights back. Started by hand inside the night-show
> window, FPP plays over it: [INSTALL.md](INSTALL.md#the-night-show-and-the-hub).

Run from the repo root, on Node 22 (tested on 22.18; `npm run pi` passes `--experimental-strip-types` for an older 22). Node runs the `.ts` directly; the control page is committed as built
(`pi/page/dist`), so the Pi builds nothing and `npm ci --omit=dev` is enough.

```sh
npm run pi -- --dry-run      # render and limit as live, send nothing; a stats line every 5 s; idle with no page open
npm run pi                   # live: DDP to 127.0.0.1:4048 (fppd)
npm run pi -- --help         # every setting
```

The stats line reads: the look and its time; fps, render ms (worst); frames skipped (`late`); the generator's
watts and peak; frames the compressor cut; the level, then `BLACKOUT` or `FLASH-TRIPPED` when either is on.
SIGINT or SIGTERM fades out over a second, then sends black frames before exiting. It will not start on a rig whose
pixel count is not what lighting's pixel map says (`pixels` in `pi/data/power.json`, from `pi/tools/build_power.py`):
ADD_LIVE_APP.md's self-check for a stale map.

## The control page

`http://<the Pi>:4043/` from a phone on the same network, alone or behind Studio (which also passes it through
to curators at `:8780/pi/`): the live play page (SPEC-liveplay "The page"), one layout
that fits a phone without scrolling and spreads to three columns on a laptop. In Jukebox, the queue alone: what plays,
**Up next**, **Add a look** (a pick opens its preview first: the gallery's looping preview when it has one, as
Studio's looks do) and **Fade to next**. In Live Play, also the playing look's knobs four to a bank (its
numbers and the palette), Master, tap tempo with the beat (a ±1 BPM nudge when the look offers its tempo), a cued
crossfade for each look played, and **Black out the lights**, held for half a second (B on a keyboard) either way.
It says who drives and who is here, when the run is dry, when the link is lost and when the flash guard has cut to
`safe` (the safe look plays, and the queue waits, until someone picks a look or goes on); its aside is the
generator's draw and what the Pi sends. `pi/page/controller.tsx` lays it out from its parts (`status`, `bank`,
`show`, `queue`, `add`, `preview`, styled by `public/css/liveplay.css`); Studio's `/live` on the Pi is the same page for curators,
with Studio's looks to add and the Folly in 3D as its aside.

The queue is the jukebox (SPEC-offline "Playing on the lights"): each queued look plays its whole pattern once, then
the next, fading out over its last second and in over the next's first; with nothing queued, what plays loops on.
In Jukebox the fades are 4 s each way, and with nothing queued the engine picks the next of its own looks (not
`safe`), a seeded shuffle that plays each once a round and none twice in a row.
At most 20, in memory (a restart empties it). Studio's **Play on the lights** queues its looks here too: a library
look sent by `ref` (its code always ours), shown with who queued it.

- Its socket (`/ws`, messages in `pi/src/protocol.ts`) takes the page's own origin only: another site open on the
  same phone cannot drive the lights. Each socket is rate-limited, and the page holds at most 32.
- No PIN by default. `--pin 2468` (or `"pin"` in `pi/config.json`) makes the page ask for it before it changes
  anything; five wrong ones lock the page out for a minute.
- `--http 0` turns the page off; `--bind 127.0.0.1` keeps it to the Pi itself.
- **Jukebox or Live Play** (SPEC-liveplay): in Jukebox (the default, `--mode live` for the other) the engine takes
  only the queue: no knobs, Master, tempo, Blackout or Play now, whatever a page sends. Behind Studio, the admin's
  setting wins (Studio's feed says it). In Live Play one person has the knobs at a time (Take over); the Pi's own page
  drives as "the Pi's page". Who a socket is comes from Studio's proxy: on the LAN the PIN is the only gate, so anyone
  with it may say they are Studio's feed and change the mode. Behind Studio it still listens on the network, for the
  hub's `:4043/` link, so set a PIN (`pi/STUDIO.md`).
- The socket also sends what plays (`source`: the look, its modules by ref, at each change) and its clock in the
  state, so Studio's Live tab can follow a dry run behind Studio's `/pi` (SPEC-live "Following /pi"). The Pi itself
  connects to nothing and needs no setting for it.
- **Relay to the lights** (SPEC-live "Relay to the lights"): a page that may drive can take the relay lease
  (`relay-start`) and send binary frames, the look's rgb as Uint16 rendered ahead in its browser; the engine plays
  them in place of its own render, through the same flash guard, light settings, master, rose and compressor. A
  late frame is held for 100 ms, then the engine dips to its own render, and goes back after 1 s of steady frames.
  One sender at a time; the lease ends when it stops, closes, or sends nothing for a second (`pi/src/relay.ts`).
  The stats line adds `relay <who> on|off, ahead N, missed M` while one holds it. Measuring it on site:
  [INSTALL.md](INSTALL.md#relay-measuring-it-on-site).
- A dry run renders only while a page is open (here or through Studio's `/pi/`; Studio's own feed, whose hello says
  `feed: true`, does not count), and picks up where it stopped. The Pi always plays.
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
- `--frames DIR` (or `"frames"`): Studio's baked frames, its `<STUDIO_DATA>/frames` (on the Pi
  `/home/fpp/folly-data/frames`), so it can play looks' bakes Studio queues; unset, it plays none. It reads only
  `<lookId>.fseq` there, held to the SHA-256 Studio sent.
- Looks are `pi/looks/<id>.json`, plus the Pi's own `pi/local/looks/` (gitignored; one there replaces a shipped
  look with the same id). A look is Studio's look whose modules name library entries by `ref`; the code always
  comes from the library. `globals.live` lists the controls it offers.

## The simulator

`npm run pi:sim` stands in for fppd on a laptop. Start it, then `npm run pi` beside it. Each second it prints the
frames it got, any that arrived torn (lost packets, or petals that are not what their cells expand to), and the
draw against the generator's budget. `--png out.png` writes the rig from the front each second. On SIGINT it prints
its totals and exits 1 if any frame was torn or over budget.
