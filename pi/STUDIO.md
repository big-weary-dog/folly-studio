# Folly Studio on the FPP Pi, offline

The Studio people use at folly.swampkat.com, on the FPP Pi (192.168.8.172) with no internet, so the crew can make
and preview looks on the playa from any phone or laptop on DustyRose: `http://192.168.8.172:8780/`. It runs with
`STUDIO_PROFILE=pi` (SPEC-offline "The Pi profile"): no AI ideas, no Ideas tab, sign-ups and looks of the Pi's
own. Pattern code runs in each viewer's browser, never on the Pi.

Two units share one installed bundle:

| Unit | What | Started by |
| --- | --- | --- |
| `folly-studio` | Studio (`server.ts`) on `:8780`, niced (`Nice=5`) | boot (enabled) |
| `studio-live` | the live engine (`pi/main.ts`), the only thing that sends to fppd ([INSTALL.md](INSTALL.md)) | the ops hub |

Studio shows the engine's control page to curators at `/pi/` (their header's **Lights**). Studio itself sends
nothing to the lights, so it may run while FPP plays the night show.

To try it before the Pi, the hosting machine runs the same profile on loopback: `docs/HOSTING.md` "Dev instance"
(`--instance offline`).

Install from the bundle using [SETUP.md](SETUP.md), `install.sh --studio`. Make or download the bundle at home;
the Pi needs no internet. The settings and units below describe what the installer configures.

## 0. Measure first (about 10 minutes)

On the Pi, as `fpp`, with FPP idle and no live app running, in `/home/fpp/folly-studio` after [SETUP.md](SETUP.md):

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
and unprivileged user namespaces. Raspberry Pi OS (Debian) allows those as installed.

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

## 1. Install the bundle

Follow [SETUP.md](SETUP.md), choosing **Engine + Studio**. The bundle carries the built app, native dependencies
and bubblewrap; the Pi builds and downloads nothing. The installer stages and checks it before activation.

## 2. Settings

Studio's data goes on the SD card, outside the installed tree, at `/home/fpp/folly-data` (so it boots without the SSD).
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

Curators play looks from Studio (**Play on the lights**): a look made only of library modules plays live while
Admin → Light's **Live library looks on the lights** is on; a look with custom code plays only as its bake. Bakes are
made on the Pi in the render box (bubblewrap, step 0), one at a time, at `nice 19` under the engine and Studio,
within 384 MB (`STUDIO_BAKE_NICE`, `STUDIO_BAKE_MEMORY`). Without bubblewrap such looks cannot play on the lights
until they are rebuilt from library modules. Admin → Light's **Mode** is **Jukebox** by default, or **Live Play** for
whoever may drive (`STUDIO_LIVE_CONTROL`) (SPEC-liveplay "Modes"); Studio tells the engine at each change. Curators
run the lights from Studio's **Live** on a phone or a laptop: the live play page (SPEC-liveplay "The page"). Members
see the stage alone.

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

Install a new bundle using [SETUP.md](SETUP.md). The installer preserves local settings and looks and keeps
Studio data outside the installed tree.

## Rolling back

Install a bundle of the earlier commit using [SETUP.md](SETUP.md).

To take Studio off the Pi: `sudo systemctl disable --now folly-studio`, remove
`/etc/systemd/system/folly-studio.service` and `sudo systemctl daemon-reload`. The data stays in
`/home/fpp/folly-data` until removed.
