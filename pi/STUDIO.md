# Folly Studio on the FPP Pi, offline

The Studio people use at folly.swampkat.com, on the FPP Pi (192.168.8.172) with no internet, so the crew can make
and preview looks on the playa from any phone or laptop on DustyRose: `http://192.168.8.172:8780/`. It runs with
`STUDIO_PROFILE=pi` (SPEC-offline "The Pi profile"): no AI ideas, no Ideas tab, sign-ups and looks of the Pi's
own. Pattern code runs in each viewer's browser, never on the Pi.

Two units share one clone of the `pi` branch:

| Unit | What | Started by |
| --- | --- | --- |
| `folly-studio` | Studio (`server.ts`) on `:8780`, niced (`Nice=5`) | boot (enabled) |
| `studio-live` | the live engine (`pi/main.ts`), the only thing that sends to fppd ([INSTALL.md](INSTALL.md)) | the ops hub, as now |

Studio shows the engine's control page to curators at `/pi/` (their header's **Lights**). Studio itself sends
nothing to the lights, so it may run while FPP plays the night show.

To try it before the Pi, the hosting machine runs the same profile on loopback: `docs/HOSTING.md` "Dev instance"
(`--instance offline`).

Everything here is done at home with the Pi online (a phone hotspot will do), never on the playa: the clone and
`npm ci` download. **With no internet, install from the USB bundle instead:** [SETUP.md](SETUP.md),
`install.sh --studio`, which does steps 1 to 3 and carries bubblewrap.

## 0. Measure first (about 10 minutes)

On the Pi, as `fpp`, with FPP idle and no live app running, in the clone ([INSTALL.md](INSTALL.md) step 1):

```sh
uname -m          # aarch64 or armv7l
free -m
for look in safe fire heartbeat-plasma; do
  npm run pi -- --dry-run --http 0 --look $look --seconds 30 --stats 10 2>&1 | grep -E 'fps|render|late'
done
```

Each stats line gives the frame rate, the render time per frame and `late` (frames the timer skipped). A look whose
render time is over 25 ms cannot hold 40 fps: note which.

Bakes (a look with custom code plays on the lights only as its bake) run in the render box, which needs bubblewrap
and unprivileged user namespaces. Raspberry Pi OS (Debian) allows those as installed. `bake-bench` comes with the `pi`
branch: on an older clone, run this part after step 1.

```sh
sudo apt install -y bubblewrap
sysctl user.max_user_namespaces                    # above 0
sysctl kernel.unprivileged_userns_clone 2>/dev/null  # 1, where the kernel has it
bwrap --unshare-all --ro-bind / / --dev /dev --proc /proc true && echo "bubblewrap works"
npm run bake-bench
```

`bake-bench` bakes the same three looks, 30 s each, one after another, in the box Studio uses with the Pi's limits
(`nice 19`, 384 MB). Per look it prints the wall time, seconds of bake per second of look and frames per second. On
the hosting machine (Ryzen 7 8700F) they were 0.02 s per s (~2000 frames/s) for `safe`, 0.065 (~620) for `fire` and
0.17 (~235) for `heartbeat-plasma`. With `npm run pi -- --dry-run --http 0 --look fire` running in another terminal, its
stats show whether a bake costs the engine frames (`late`). Send all the output, both parts, to whoever looks after
Studio; it settles the default look, which presets are too heavy for the Pi, and whether the Pi bakes.

## 1. The `pi` branch

The Pi builds nothing. The `pi` branch is `prod` plus one commit holding the built app (`dist/`) and
`dist/build.json`, made on the hosting machine by `npm run pi:branch` (below). It contains Studio Live too, so the
engine moves to it as well.

A new clone:

```sh
cd /home/fpp
git clone -b pi https://github.com/big-weary-dog/folly-studio.git
```

The clone Studio Live already uses:

```sh
cd /home/fpp/folly-studio
git fetch origin pi && git checkout -B pi origin/pi
```

Then, in either case:

```sh
cd /home/fpp/folly-studio
npm ci --omit=dev
```

`sharp` (the gallery's WebP previews) is native: `npm ci` fetches its build for the Pi's CPU, so it needs the
internet.

## 2. Settings

Studio's data goes on the SD card, outside the clone, at `/home/fpp/folly-data` (so the Pi boots without the SSD).
Its settings go in `/home/fpp/.config/folly-studio/studio.env`:

```sh
mkdir -p /home/fpp/folly-data /home/fpp/.config/folly-studio
cat > /home/fpp/.config/folly-studio/studio.env <<'EOF'
STUDIO_PROFILE=pi
HOST=0.0.0.0
PORT=8780
STUDIO_DATA=/home/fpp/folly-data
STUDIO_ADMINS=crewlead
STUDIO_CURATORS=alice,bob
PI_PREVIEW_URL=http://127.0.0.1:4043
EOF
chmod 600 /home/fpp/.config/folly-studio/studio.env
cd /home/fpp/folly-studio && npm run config:check -- /home/fpp/.config/folly-studio/studio.env
```

`config:check` prints `OK` or the settings that would stop Studio. Name the crew lead as admin and whoever may drive
the lights as curators (usernames as they sign up). Under the Pi profile the previews are drawn flat (`front`) and
baked frames capped at 1 GB; `docs/HOSTING.md` "Every setting" lists the rest. Plain HTTP on DustyRose, so
`STUDIO_SECURE_COOKIES` stays off.

The engine sits behind Studio at `/pi`, reads the light settings Studio's Light page writes, and plays Studio's
baked frames. In `/home/fpp/folly-studio/pi/config.json` (gitignored; keep any settings already there):

```json
{ "base": "/pi", "light": "/home/fpp/folly-data/light.json", "frames": "/home/fpp/folly-data/frames",
  "bind": "0.0.0.0", "pin": "2468" }
```

The engine serves its page at `/pi/` for Studio and at `/` for the ops hub, whose link is
`http://192.168.8.172:4043/` in both setups. On the network, that page is outside Studio's sign-in: the PIN is its
only lock, so choose one, and put it in `studio.env` as `PI_PIN` too, so Studio can play looks on it. It plays only
library looks, never code, either way (SPEC-offline "The Pi preview").

Curators play looks from Studio (**Play on the lights**): a look made only of library modules plays live while Admin →
Light's **Live library looks** is on; a look with custom code plays only as its bake. Bakes are made on the Pi in the
render box (bubblewrap, step 0), one at a time, at `nice 19` under the engine and Studio, within 384 MB
(`STUDIO_BAKE_NICE`, `STUDIO_BAKE_MEMORY`). Without bubblewrap such looks cannot play on the lights until they are
rebuilt from library modules. Admin → Light's **Mode** (SPEC-liveplay) is **Jukebox** by default: the queue only,
each change a full fade, no Play now, knobs or Blackout. **Live Play** adds them, for whoever may drive
(`STUDIO_LIVE_CONTROL`), one person on the knobs at a time; Studio tells the engine at each change. Curators run
the lights from Studio's **Live** on a phone or a laptop: the live play page (SPEC-liveplay "The page"), adding
their own looks, the gallery's or the lights' own, with the Folly in 3D beside it. Members see the stage alone.

## 3. The Studio unit

```sh
sudo cp /home/fpp/folly-studio/pi/folly-studio.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now folly-studio
journalctl -u folly-studio -n 20 --no-pager
```

The log should say `Folly Studio on http://0.0.0.0:8780/`. Open `http://192.168.8.172:8780/` on a phone on
DustyRose and sign up as the admin first. If Studio Live is running, restart it once so it serves under `/pi`:
`sudo systemctl restart studio-live`.

The ops hub's entry (in the lighting repo, the hub's owner's to change) points at the engine,
`http://192.168.8.172:4043/`, as with the engine alone. Curators reach the same page from Studio's header,
**Lights** (`:8780/pi/`).

## Moving looks

Looks travel as files (SPEC-offline "Look files"). Before leaving: on folly.swampkat.com, My looks (or the Gallery)
→ **Export all**; on the Pi, My looks → **Import**. Coming back, the same the other way. An imported look is the
importer's, unshared.

## Updating

At home, online, after someone ran `npm run pi:branch` on the hosting machine:

```sh
cd /home/fpp/folly-studio
git fetch origin pi && git reset --hard origin/pi
npm ci --omit=dev
sudo systemctl restart folly-studio
sudo systemctl restart studio-live    # if it is running
```

The branch is made afresh from `prod` each time, so it is reset to, never pulled. `pi/config.json`, `pi/local/`
and the data in `/home/fpp/folly-data` are outside git and survive.

## Rolling back

`git reflog` lists the builds this clone has had: `git reset --hard <commit>`, then the same `npm ci` and restarts.

To take Studio off the Pi: `sudo systemctl disable --now folly-studio`, remove
`/etc/systemd/system/folly-studio.service` and `sudo systemctl daemon-reload`. The data stays in
`/home/fpp/folly-data` until removed.

## Making the `pi` branch (the hosting machine)

```sh
npm run pi:branch            # from origin/prod; or: npm run pi:branch -- <ref>
```

It builds the ref in a temporary worktree (`npm ci`, `npm run build`, `dist/build.json`), commits `dist/` on top as
one commit, and force-pushes it to `origin/pi`. `--no-push` stops before the push and prints the commit.
