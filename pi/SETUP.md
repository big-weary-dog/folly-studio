# Setting up the FPP Pi, from a USB stick

From "Pi powered on" to "lights playing from the hub", with no internet at the site. One choice, at step 4:

| Setup | What runs on the Pi | Pages |
| --- | --- | --- |
| **Engine only** | `studio-live`, Studio Live, started by the ops hub: our library's looks | `:4043/` |
| **Engine + Studio** | the same, plus `folly-studio`: Studio offline, on at boot, sending nothing | `:4043/` `:8780/` |

The ops hub's link is `http://192.168.8.172:4043/` in both. With Studio, curators also reach the engine at
`:8780/pi/`. What the engine is: [README.md](README.md).

## Tonight, at home (online)

1. **Make the bundle** on the hosting machine, from the commit to ship (default the checkout's `HEAD`):

   ```sh
   npm run pi:bundle                 # or: npm run pi:bundle -- origin/prod
   ```

   It ends `pi-bundle: …/folly-studio-pi.tgz (58M), the build of <commit>; install.sh beside it`. It holds the
   built app, `node_modules` for the Pi (sharp for 64- and 32-bit ARM) and bubblewrap's `.deb`s, so the Pi
   downloads nothing.
2. **Copy `folly-studio-pi.tgz` and `install.sh` to a USB stick** (any format the Pi reads; FAT32 is fine).
3. **The hub's two entries** (lighting repo, John's): lighting PR #1 adds Folly Studio Live to
   `launchpad/live-sources.json` (`unit` `studio-live`, `url` `:4043/`) and `launchpad-sudoers.txt`. It should be
   merged, and a laptop that can reach the Pi should have it pulled.

## At the Pi

1. **Power on** the Pi and get a laptop on DustyRose. FPP's page (`http://192.168.8.172/`) should load.
2. **Log in:** `ssh fpp@192.168.8.172`.
3. **Mount the stick:** `lsblk` names it (usually `sda1`), then
   `sudo mkdir -p /mnt/usb && sudo mount /dev/sda1 /mnt/usb`.
4. **Install. Pick one:**

   ```sh
   bash /mnt/usb/install.sh --pin 2468                                   # engine only
   bash /mnt/usb/install.sh --studio --admin <your username> --pin 2468  # engine + Studio
   ```

   Choose your own PIN: the engine's page is open to anyone on DustyRose, and the PIN is its only lock. It takes
   about a minute and ends with a self-test that sends nothing to the lights. It should show:

   ```
     studio-pi: DRY RUN, nothing sent, channels 1-70401 (rose expanded), rig City of Gods 2026 2114 px at 40 fps, …
     studio-pi: heartbeat-plasma t 2.0s | 40.0 fps, render … ms (worst …), late 0 | gen … W …
   install: its page answers at /
   install: done. …
   ```

   With `--studio`, also `bubblewrap works`, `its page answers at /pi/` and `Studio answers on :8780`. Anything
   else ends `install: FAILED: <why>`.
5. **Unmount the stick:** `sudo umount /mnt/usb`.
6. **The hub:** from the laptop's lighting checkout, `bash playa-deploy/update-pi-code.sh`. Check it says
   **parsed OK**.
7. **Lights:** on the hub (`http://192.168.8.172:8080/`) pick **Folly Studio Live**. The hub stops FPP playback,
   pauses the night show and starts `studio-live`. Read its log once:

   ```sh
   journalctl -u studio-live -n 20 --no-pager
   ```

   It should show the same first line without `DRY RUN` (`DDP 127.0.0.1:4048, channels 1-70401 …`), then
   `control page on http://0.0.0.0:4043/`. Open `http://192.168.8.172:4043/` on a phone, enter the PIN, and play
   a look. The lights follow.
8. **With Studio:** open `http://192.168.8.172:8780/` and sign up first as the admin you named. Curators reach the
   engine from Studio's header, **Lights** (`:8780/pi/`). Name curators with `STUDIO_CURATORS=` in
   `/home/fpp/.config/folly-studio/studio.env`, then `sudo systemctl restart folly-studio`.
9. **Back to FPP:** pick FPP on the hub. The engine fades out over a second, and the night show resumes at the
   clock's slot inside its window.

At the night show's start (21:00) the hub takes the lights back from Studio Live, as from any live app:
[INSTALL.md](INSTALL.md#the-night-show-and-the-hub).

## When it goes wrong

| It says | Do |
| --- | --- |
| `no Node at /usr/bin/node` or `too old` | FPP 9 ships Node 22: `node --version`, then ask whoever looks after Studio |
| `has N px … stale map` | the rig and power tables disagree: bundle again from a commit that passes `npm run check` |
| `bubblewrap does not run here` | Studio works, but looks with custom code cannot be baked: play library looks |
| The hub greys it out, or `sudo` errors | step 6 again, and read for **parsed OK** |
| The page loads but nothing lights | `journalctl -u studio-live`: is it `DRY RUN`? Is FPP playing over it? |

## Updating

- **Offline:** make a new bundle, copy it, run the same `install.sh` line. It keeps `pi/config.json`,
  `pi/light.json`, `pi/local/`, `studio.env` and Studio's data (`/home/fpp/folly-data`), keeps the old tree as
  `/home/fpp/folly-studio.old-<time>`, and restarts what was running.
- **Online** (a phone hotspot will do): the git clone in [INSTALL.md](INSTALL.md) (engine only) or the `pi`
  branch in [STUDIO.md](STUDIO.md) (with Studio), with `npm ci --omit=dev`. A bundle install is no git clone, so
  move to one of those by following its step 1.
- **Rolling back:** `sudo systemctl stop studio-live folly-studio`, move `/home/fpp/folly-studio` aside and the
  `.old-<time>` tree back, then start what you stopped (the hub starts `studio-live`).

## Rehearsing it here

`bash install.sh --home DIR [--studio --admin NAME]` installs into `DIR/folly-studio` with no units and no
`sudo`, and runs the same self-test, Studio on `:18780` for a moment. Under `unshare -rn` (after
`ip link set lo up`) it shows that nothing needs the network.
