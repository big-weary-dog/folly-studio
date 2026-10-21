# Installing Studio Live on the FPP Pi

Studio Live plays looks from this repo's library on City of Gods, straight from the FPP Pi (192.168.8.172), with a
control page on `:4043`. It sends DDP to fppd on `127.0.0.1:4048`, like Folly Mix. It needs no internet, no Studio
server, no sign-in and no build step: a git clone, `npm ci`, and Node.

What it is and how to drive it: [README.md](README.md). How live apps fit the Pi: `ADD_LIVE_APP.md` in the
lighting repo.

> **Before using it during show hours, read [The night show will play over it](#the-night-show-will-play-over-it).**

## 1. Clone and install (once)

On the Pi, as `fpp`. Node 22 is already there (`node --version`: 22.18 is what it is tested on).

Studio Live ships on the branch Studio itself ships from, `prod`:

```sh
cd /home/fpp
git clone -b prod https://github.com/big-weary-dog/folly-studio.git
cd folly-studio
npm ci --omit=dev
```

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

## The night show will play over it

The hub's night-show AUTO mode is not cleared when it switches to a live app. Inside the night-show window
(`night-show.json`: 21:00–05:02 on the Pi at the last look; check it), with AUTO on and FPP idle, the hub starts the
night show within about 15 s. FPP then plays over Studio Live and the two fight at frame rate. Folly Mix has the same
problem.

Until the hub clears AUTO itself (John's fix: `switch_source` calling `night_mode.clear()`):

- **Inside the window:** switch to Studio Live, then press **STOP** on the hub or the Launchpad. STOP takes the hub to
  manual (the AUTO pad dims) and leaves live apps running. Press **AUTOMATIC** to hand the night back.
- **Across the window's start:** at the start time the hub goes back to AUTO when FPP is idle, and it is idle while
  Studio Live plays. Press STOP again just after the start time, or set `"enabled": false` in `night-show.json`
  for the session and back afterwards (ask John first).

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

To return to the latest, run `git checkout "$BRANCH" && git pull` ($BRANCH as in step 1), then the same `npm ci` and restart.
To take Studio Live off the Pi entirely, follow these steps:

1. Switch the hub to FPP.
2. Remove the unit: `sudo rm /etc/systemd/system/studio-live.service && sudo systemctl daemon-reload`.
3. Ask John to drop the two hub entries.

The clone can stay or go.
