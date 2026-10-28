# Installing Studio Live on the FPP Pi

Studio Live plays looks from this repo's library on City of Gods, straight from the FPP Pi (192.168.8.172), with a
control page on `:4043/`. It sends DDP to fppd on `127.0.0.1:4048`, like Folly Mix. It needs no internet, no Studio
server, no sign-in and no build step: a git clone, `npm ci`, and Node.

**With no internet at the site, install from the USB bundle instead: [SETUP.md](SETUP.md)** (one command, the engine
alone or with Studio). This page is the online way, a git clone, and what the engine does once installed.

What it is and how to drive it: [README.md](README.md). How live apps fit the Pi: `ADD_LIVE_APP.md` in the
lighting repo.

Its page is `http://192.168.8.172:4043/`; with Studio on the Pi too, also `:8780/pi/` ([SETUP.md](SETUP.md)'s
table).

## 1. Clone and install (once)

On the Pi, as `fpp`. Node 22 is already there (`node --version`: 22.18 is what it is tested on).

Studio Live ships on the branch Studio itself ships from, `prod`:

```sh
cd /home/fpp
git clone -b prod https://github.com/big-weary-dog/folly-studio.git
cd folly-studio
npm ci --omit=dev
```

When Studio runs on the Pi as well, install the built bundle using [SETUP.md](SETUP.md).

The repo is public, so the clone needs no credential. `--omit=dev` installs only what the engine runs (about 85 packages, no native builds, no browsers).

## 2. A dry run

```sh
npm run pi -- --dry-run
```

It renders, limits and serves the page exactly as live, but sends nothing to the lights. Check the first line. It
should read like this:

```
studio-pi: DRY RUN, nothing sent, channels 1-70401 (rose expanded), rig City of Gods 2026 2114 px at 40 fps, ...
```

70,401 channels with the rose expanded and 2,114 pixels are the numbers `ADD_LIVE_APP.md` asks a live app to state.
Then open `http://192.168.8.172:4043/` on a phone on DustyRose. The page says "Dry run" at the top. Every 5 s a
stats line gives fps, render time and the generator's draw. Ctrl-C stops it.

## 3. Settings (optional)

Settings go in `pi/config.json`, which `git pull` never touches (it is gitignored). For example:

```json
{ "look": "fire", "pin": "2468" }
```

`npm run pi -- --help` lists every setting. The page has no PIN by default. Set one if the network is not only the
crew's. Looks of the Pi's own go in `pi/local/looks/` (also gitignored).

On prod, My looks or Gallery → **Export all** downloads `folly-looks-*.json`. For the bundle installer, put that
file in `looks/` beside `install.sh`, then install ([SETUP.md](SETUP.md)); for this clone, copy it into
`pi/local/looks/`. Both single look files and exports of many work. With Studio on the Pi, the same file goes
through My looks → **Import**. The laptop signs in to prod; the Pi does not fetch looks itself.

## 4. The unit and the ops hub

Install the unit, but do not enable it at boot. The ops hub starts it, as it does Folly Mix:

```sh
sudo cp /home/fpp/folly-studio/pi/studio-live.service /etc/systemd/system/
sudo systemctl daemon-reload
```

The hub needs two entries in the lighting repo. That is John's repo, so they are his to add:

- `launchpad/live-sources.json`, in `sources`:

  ```json
  {
    "id": "studio",
    "label": "Folly Studio Live",
    "sub": "Studio's looks, played on the Pi",
    "unit": "studio-live",
    "url": "http://192.168.8.172:4043/"
  }
  ```

- `playa-deploy/pi-system/launchpad-sudoers.txt`, in the `Cmnd_Alias`:

  ```
  /usr/bin/systemctl start studio-live.service, \
  /usr/bin/systemctl stop  studio-live.service, \
  ```

Then `bash playa-deploy/update-pi-code.sh`, and check that it says **parsed OK**.

## 5. Live

Pick **Folly Studio Live** on the ops hub (`:8080`). The hub stops FPP playback and the other live apps, then starts
the unit. Read its log once:

```sh
journalctl -u studio-live -n 20 --no-pager
```

It should show the line from step 2 without `DRY RUN`, then `control page on http://0.0.0.0:4043/`. Open the page
and play. To stop, switch the hub back to FPP: the unit fades to black over about a second and exits.

Without the hub (first test only, with FPP idle and nothing else live): `npm run pi`, then Ctrl-C.

## The night show and the hub

The hub keeps the night show (`night-show.json`: 21:00–05:02 on the Pi at the last look; check it) and live apps
apart, through its source switch (`night_follow_source` in lighting's `launchpad/launchpad-fpp.py`):

- **Switching to Studio Live pauses the night show.** The hub stops FPP playback and clears its AUTO mode, so it
  does not restart the show over the engine.
- **Switching back to FPP resumes it**, inside its window, at the slot the clock says (not where it left off).
  Outside the window FPP stays idle.
- **At the window's start the show takes the lights**, whatever plays: the hub stops `studio-live` (and every live
  app) and starts the night show. A demo at 20:58 is cut off at 21:00, as meant.

That is the hub's switch only. An engine started by hand (`npm run pi`, `systemctl start studio-live`) is invisible
to it: inside the window, with AUTO on, the hub restarts the night show within about 15 s and FPP plays over the
engine. Start it from the hub.

## Measuring the engine on this Pi

How fast this Pi renders, so we know which looks it can play itself. Run these as `fpp` in
`/home/fpp/folly-studio`, with the show stopped and `studio-live` stopped (`sudo systemctl stop studio-live`):

```sh
cat /proc/device-tree/model; nproc; lscpu | grep -iE 'model name|max mhz'
vcgencmd measure_clock arm; vcgencmd measure_temp; vcgencmd get_throttled   # 0x0 = never throttled
node tools/live-bench.ts --only pi:,preset:plasma,preset:tunnel,stack --frames 400 --json ~/bench-pi.json
node tools/live-bench.ts --frames 200 > ~/bench-all.txt              # every look: a few minutes
# The engine as live, beside fppd, no page, nothing sent: read fps, render ms (worst) and late from its stats lines.
npm run pi -- --dry-run --http 0 --look heartbeat-plasma --seconds 300 --stats 10
top -b -d 10 -n 6 | grep -E 'fppd|node'                              # in a second shell, during the dry run
vcgencmd get_throttled                                               # again, after 5 minutes of load
```

`--dry-run` sends no DDP and `--http 0` opens no port, so it cannot collide with anything. Send back what they print
and the two files. The engine is fast enough when heartbeat-plasma's tick is ≤ 12 ms mean and ≤ 20 ms p95, and the
dry run holds 40 fps with `late` under 0.1% of frames over the 5 minutes, with fppd running.

## Relay: measuring it on site

Relay to the lights (SPEC-live "Relay to the lights") has a laptop's browser render and the Pi play its frames.
Its buffer is set by the Wi-Fi, so measure the link first, from the laptop on the site's network (DustyRose), with
the Pi's address for `<pi>`:

```sh
ping -i 0.025 -c 2400 -s 1400 <pi>        # one minute at 40 a second, a frame's size; Windows: see below
```

On Windows, `ping -n 600 -l 1400 <pi>` (it cannot go faster than once a second without admin). Read p50, p99 and the
max. The buffer should be p99 plus 50 ms (two frames); the default is 200 ms, and the Live tab offers 80, 400 and
800.

Then relay for 30 minutes, from Chrome on the laptop, plugged in:

1. Open Studio's **Live** tab on the Pi as a curator, and turn on **Relay to the lights** at the default buffer.
   The tab says the buffer it holds, the misses and that it keeps the screen awake.
2. On the Pi, follow the engine's stats line (`journalctl -u studio-live -f`): it says `relay <who> on, ahead N,
   missed M`. Play a few looks, push a few knobs (each lands one buffer later).
3. Hide the tab (another tab in front) for 10 minutes: the stats line keeps `fps 40` and `relay … on`.
4. Open the Live tab in a second browser and turn relay on there: it is refused, saying who relays.
5. Turn the laptop's Wi-Fi off: within half a second the lights dip and play the Pi's own render, and the stats
   line says `relay off`. Wi-Fi back on: the tab relays again within a few seconds.

Done when the 30 minutes play at 40 fps with at most 0.1% of frames missed (`missed` over 72,000 frames: ≤ 72), and
steps 3–5 behave as said. Send back the ping summary and the stats lines.

## Updating

```sh
cd /home/fpp/folly-studio
git pull
npm ci --omit=dev        # only when package-lock.json changed; harmless otherwise
sudo systemctl restart studio-live    # if it is running
```

`pi/config.json` and `pi/local/` survive: git never touches them. The page is committed as built, so there is
nothing to build.

## Rolling back

```sh
cd /home/fpp/folly-studio
git log --oneline -10             # find the last commit that worked
git checkout <commit>
npm ci --omit=dev
sudo systemctl restart studio-live
```

To return to the latest, run `git checkout prod && git pull`, then the same `npm ci` and restart.
To take Studio Live off the Pi entirely, follow these steps:

1. Switch the hub to FPP.
2. Remove the unit: `sudo rm /etc/systemd/system/studio-live.service && sudo systemctl daemon-reload`.
3. Ask John to drop the two hub entries.

The clone can stay or go.
