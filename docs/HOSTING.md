# Hosting Folly Studio at home

For tens of people, on your own computer, behind an HTTPS tunnel. Commands marked *(to verify)*
have not been run here. Check them against the tool's own docs.

## What runs where

| Where | What | Cost |
|---|---|---|
| Phone or laptop | The app, the 3D preview, every pattern's code (sandboxed iframe), playback of baked frames | Its own CPU and battery |
| Your computer (`npm start`) | Accounts, the JSON store, the API, static files, bakes, frame encoding | About 100 MB of RAM idle; a login takes 128 MiB for half a second (scrypt, at most three at once) |
| Render box (bubblewrap; without it, library looks only) | One bake at a time, `nice 10` (Admin → Baking: throttled is `nice 19` with 30 s between renders, or off), in its own systemd user scope: ≤ 256 tasks (`STUDIO_BAKE_TASKS`), ≤ 1 GB (`STUDIO_BAKE_MEMORY`); a wall clock | A 30 s look takes 2–3 s on one core |
| Encoder thread | Brotli for streaming, `nice 10`, one job at a time; a look's encode waits for any bake | 2.5–5.5 s per 30 s look at quality 9 |

Bakes and encodes yield to everything else: the API and your desktop stay responsive. Baked frames
take about 0.6 MB per second on disk. `STUDIO_FRAMES_MAX_BYTES` (default 2GB, roughly an hour of
frames) caps them: the least recently used go first, never a reviewed look's, and an evicted bake is
baked again when someone presses Play.

## Bandwidth

Static files are served under content-hashed URLs and cached for a year, so after the first visit
a reload costs about 2 KB (the page and two API checks, all `304`). A cold Studio load is about
145 KB. Lists send no code. Streaming a baked look costs 0.05–2 MB per 30 s, depending on how
busy it is. Brotli quality 11 (`STUDIO_FRAMES_BROTLI_QUALITY=11`) saves about 12 % of that, but
needs about 13 times the CPU (`node tools/frames-bench.ts`).

**Use HTTPS.** Browsers ask for `br` only over HTTPS. Over plain HTTP they get the gzip copy of each
frame chunk, which is up to 76 % larger, and is made on first request. Both tunnels below serve HTTPS.

## Install and update

```sh
npm ci           # once, and after every pull: the dependencies, exactly as package-lock.json pins them
npm start        # builds the app into dist/ (a few seconds), then serves it with the API
```

Everything is installed and built on your machine: once it is, the studio needs no network but the tunnel.
To keep it running, use `npm run host` (below).

## Bind to localhost

`HOST` defaults to `127.0.0.1`: keep it. Never forward port 8780 on your router. The tunnel connects
outward to its provider, so nothing on your network opens.

## Hosting on this machine (WSL)

The studio runs natively in WSL as a systemd user service, `folly-studio`; the Cloudflare tunnel's connector
(`cloudflared`) runs on Windows, as it does for Loopr's arcade, and reaches it through WSL's localhost forwarding.
Native rather than Docker because bakes need bubblewrap's user namespaces, which work here as they are and
which Docker would have to be loosened for.

What was checked on this machine (WSL 2.4, NAT networking, `systemd=true` in `/etc/wsl.conf`, linger on):

- A Windows program connecting to `127.0.0.1:<port>` reaches the studio listening on WSL's `127.0.0.1`, and the
  studio sees it as `127.0.0.1`, so `STUDIO_TRUST_PROXY=1` (trusted from loopback only) takes the client's address
  from `X-Forwarded-For`'s right-most entry, the one Cloudflare appends. Sign-in limits key on that address;
  whatever a client writes to the left of it is ignored.
- `localhost` on Windows tries `::1` first, which WSL does not forward to a `127.0.0.1` listener: each new
  connection waits for the fallback (0.2 s here). Point the tunnel at `127.0.0.1`, not `localhost`.
- A program on Windows that listens on the same port wins over WSL's forwarding: a studio started from Windows
  (`npm start` in a Windows checkout) hides the WSL one. `npm run host` checks this and fails if so.
- Bakes run in the service, each in its own systemd user scope, so a bake's task and memory caps count that bake
  alone, not the fleets running as the same user.

### Owner, once (in WSL)

1. A checkout of its own, apart from any fleet's trees, since `npm run host` builds its releases in it:

   ```sh
   git clone https://github.com/big-weary-dog/folly-studio.git ~/folly-studio
   ```

   The server runs the `prod` branch (`STUDIO_REF=origin/prod` in the settings): work lands on `dev`, and `prod`
   moves only when the owner says so (CONTRIBUTING "Branches").

2. The settings (the [Environment](#environment) below): `mkdir -p ~/.config/folly-studio`, then
   `nano ~/.config/folly-studio/studio.env && chmod 600 ~/.config/folly-studio/studio.env`.
3. Start it: `cd ~/folly-studio && npm run host`. It ends on
   `host: folly-studio serves <commit> on http://127.0.0.1:8780`, or says what failed.
4. The public hostname (Cloudflare, below).

### Updating

`cd ~/folly-studio && npm run host` again, or `npm run host -- <ref>` for another commit or branch
(default `STUDIO_REF`, else `origin/prod`; a ref `origin` lacks stops it before anything changes). Each commit is
built in a release of its own, `releases/<commit>` (a git worktree of the checkout), never in the one being served:
it fetches, adds the release, `npm ci`, builds and writes `dist/build.json` (`{ commit, builtAt }`) there, and checks
the settings with that build ([Checking the settings](#checking-the-settings)). Only then does it point the `current`
link at the release (the one it served becomes `previous`), write and restart the unit (`WorkingDirectory` is
`current`), and check that `/build.json` names the commit, `/api/me` answers 401, and Windows reaches it too. A
failure before the switch leaves the running service as it was, code and bundle alike. After a good deploy it keeps
three releases: `current`, `previous` and the newest other; it removes the rest. A release already built (the live
one again, after a settings change) is not built again. The unit's `KillMode=mixed` sends the restart's SIGTERM to
the server alone: it saves and closes. Requests during the few seconds of the restart may fail; a reload fixes them.

- Roll back: `npm run host -- --rollback` switches to `previous`, already built, with no fetch, and restarts; run
  again, it switches back.
- A relative `STUDIO_DATA` (default `data/`) is the checkout's, never a release's. One checkout hosts one instance:
  a run refuses a checkout another instance's unit serves, and a second run while one deploys.
- A commit from before releases (its `deploy/host.sh` builds in place) is refused: deploy a later one.

- Another port: set `PORT` in the env file, run `npm run host`, and change the tunnel's URL to match.
- Logs: `journalctl --user -u folly-studio -f`. Status: `systemctl --user status folly-studio`.
  Requests are one line each (`[studio] [http] GET / 200 3ms 1.1KB v=1a2b3c4d NZ`, SPEC-access "Stats"): only them,
  `journalctl --user -u folly-studio -g '\[http\]'`; Admin → Stats has the day's counts. More in
  [Monitoring](#monitoring).
- Stop: `systemctl --user stop folly-studio` (`disable` too, to keep it off at boot).
- The commit that is live, from anywhere: `https://folly.swampkat.com/build.json`.
- The units are written by the script, to `~/.config/systemd/user/`: `folly-studio.service`, and the daily
  backup's `folly-studio-backup.timer` and `.service` ([Backups](#backups)). Change the script, not them.
  The service runs the checkout's `current/server.ts`; what is installed and built lives in the releases, not in
  the checkout itself.
- The studio runs while WSL does. It starts with the distro (linger is on), but WSL only boots when something on
  Windows starts it and may stop an idle distro *(to verify after a Windows restart)*: if it is down, open a WSL
  terminal, or add a Windows Task Scheduler task at logon running `wsl.exe -d Ubuntu --exec sleep infinity`.

## Cloudflare Tunnel

swampkat.com's tunnel already serves Loopr's arcade (docs/deploy.md in Loopr); the studio is one more public
hostname on it, with no Worker: the one server answers both the pages and the API. In the dashboard:

1. Zero Trust → Networks → Tunnels → the existing tunnel → Edit → Public Hostname → Add a public hostname.
2. Subdomain `folly`, domain `swampkat.com`, path empty; Service type `HTTP`, URL `127.0.0.1:8780`
   (not `localhost`: above). Save. The DNS record is made with it.
3. Check: `https://folly.swampkat.com/build.json` names the commit `npm run host` printed, and the sign-in page
   loads.

Another name works the same: only the hostname changes; the studio needs no setting for it.

On the zone (swampkat.com), leave Rocket Loader and email obfuscation off (Speed → Optimization, Scrape Shield):
they inject scripts the CSP refuses. Add no cache rules for `/api/`; its answers are per user and say so
(`private`, `no-store`). Everything under `/assets/` is named by its content and may be cached at the edge, which
also spares your upload.

For a quick trial elsewhere, with no domain, `cloudflared tunnel --url http://127.0.0.1:8780` *(to verify)*.

## Dev instance

An internal studio beside the public one, for trying `dev` before it reaches `prod`: its own checkout, data,
port, settings and unit, so nothing it does reaches folly.swampkat.com.

| | public | dev |
|---|---|---|
| Checkout | `~/folly-prod`, `origin/prod` | `~/folly-dev`, `origin/dev` |
| Data (`STUDIO_DATA`) | `~/folly-data` | `~/folly-dev-data` |
| Port | 127.0.0.1:8780 | 127.0.0.1:8781 |
| Settings | `~/.config/folly-studio/studio.env` | `studio-dev.env` |
| Unit | `folly-studio` | `folly-studio-dev` |

Set up, once:

1. `git clone https://github.com/big-weary-dog/folly-studio.git ~/folly-dev`.
2. `~/.config/folly-studio/studio-dev.env` (chmod 600), as the [Environment](#environment) below, with at least
   `STUDIO_DATA=/home/<you>/folly-dev-data`, `PORT=8781` and `STUDIO_ADMINS=<your dev username>`. No account or
   session carries over: sign up there afresh as that username.
3. Seed its data from the public studio's, before its first start:

   ```sh
   cd ~/folly-dev && npm ci && node tools/seed-dev.ts --from ~/folly-data --to ~/folly-dev-data
   ```

   This copies the shared looks (with their baked frames and gallery previews) and the light settings; it only reads
   the source. It never copies users, sessions or reports, nor an older folder's AI files. A copied
   look keeps its owner's name in the gallery, but no dev account owns it: anyone may open and play it, no one edit
   it. Unshared looks stay behind. It refuses a target that is not empty, or that is the source or inside it; to seed
   again, stop the dev studio and empty its folder first.
4. `cd ~/folly-dev && npm run host -- --instance dev` (or `STUDIO_INSTANCE=dev npm run host`). It ends on
   `host: folly-studio-dev serves <commit> on http://127.0.0.1:8781`.

Updating is the same command again, from `~/folly-dev`; `npm run host -- --instance dev <ref>` for another
branch, `npm run host -- --instance dev --rollback` to roll back. Logs: `journalctl --user -u folly-studio-dev -f`.

Each run writes, enables and restarts its own instance's unit alone, and refuses to start when another instance's
settings (if this machine has them) name the same `PORT` or `STUDIO_DATA`. The data lock (`studio.lock`, under
[Environment](#environment)) keeps a studio off a folder another one has open, so a dev studio pointed at
`~/folly-data` by mistake stops at start.

Windows not reaching a dev instance's port is a note, not a failure, since it may have no tunnel. A `-pi` unit an
earlier deploy left (the archived Pi engine's dry run, ARCHIVE.md) is stopped and removed, with its Pi bundles in
`~/.cache/folly-studio/<unit>/`.

Later, `dev.folly.swampkat.com`: a second public hostname on the tunnel, to `127.0.0.1:8781`, behind a Cloudflare
Access application that admits the owner alone. The owner sets both up in the Cloudflare dashboard.

## Tailscale Funnel *(to verify)*

```sh
sudo tailscale up
sudo tailscale funnel --bg 8780        # https://<machine>.<tailnet>.ts.net → 127.0.0.1:8780
tailscale funnel status
sudo tailscale funnel reset            # stop
```

Funnel must be allowed for the machine in the admin console (HTTPS certificates and the `funnel`
node attribute). People reach it without installing Tailscale.

## Environment

`npm run host` reads `~/.config/folly-studio/studio.env` (chmod 600; `STUDIO_ENV_FILE` names another). By hand:
`set -a; . ~/.config/folly-studio/studio.env; set +a; npm start`. The server reads every setting once at start
(`src/config.ts`; all of them under "Every setting" below) and logs what is set. A value it cannot read stops it,
naming the variable: on/off takes `1`, `true`, `on` or `yes`, or `0`, `false`, `off` or `no` (any case); a duration
takes a unit (`500ms`, `90s`, `5m`, `2h`), and a bare number is in seconds; a size takes `k`, `m` or `g` (`2GB`). A
`STUDIO_` name it does not read is warned of (a typo?), but for the AI's settings an older file may still hold, which
it ignores. Unset, each setting has its default.

```sh
HOST=127.0.0.1
PORT=8780
STUDIO_REF=origin/prod            # what npm run host checks out
STUDIO_DATA=/home/you/folly-data  # outside the checkout
STUDIO_SECURE_COOKIES=1           # the tunnel serves HTTPS
STUDIO_TRUST_PROXY=1              # client IP (login limits) and host from the tunnel, trusted from this machine only
STUDIO_CURATORS=alice,bob         # who may mark looks reviewed
STUDIO_ADMINS=you                 # the Admin page (light, baking, reports, stats); admins are curators too
STUDIO_BAKE_SECONDS=120           # longest bake
STUDIO_FRAMES_BROTLI_QUALITY=9
STUDIO_FRAMES_MAX_BYTES=2GB
STUDIO_FLASH_PER_SECOND=3         # the flash check: flashes a second allowed (WCAG 2.3.1: 3)
STUDIO_FLASH_DELTA=0.5            # a flash's swing, as a share of the LEDs' full light (WCAG: 0.1)
STUDIO_FLASH_AREA=0.25            # share of the LEDs, or of the lit area from the front or side, that blocks
```

Sign-up is open to anyone who reaches the page.

One server per data folder: the server keeps its data in memory and rewrites whole files, so it holds
`studio.lock` (its pid) in `STUDIO_DATA` while it runs. A second server on the same folder does not start, naming
the folder and the pid using it. A lock left by a server that was killed is taken over when its pid is no longer a
running `node`.

### Checking the settings

`npm run config:check -- ~/.config/folly-studio/studio.env` (on the hosting checkout, from its `current`, where the
live release's dependencies are) reads a settings file as the server would and prints
`OK`, or the names of the settings that would stop it, then any it would warn of. It never prints a value. It exits
1 when the server would not start. `npm run host` runs it with the new build, after building and before restarting
anything: when it fails, the deploy stops there and the service already running keeps running, on its old settings.
Then fix the env file, or roll back: `npm run host -- --rollback`.

### Every setting

`npm run host` also reads `STUDIO_REF`, `STUDIO_ENV_FILE` and `STUDIO_UNIT` (`deploy/host.sh`), and the daily
backup `STUDIO_BACKUP_DIR`, `STUDIO_BACKUP_KEEP` and `STUDIO_BACKUP_OFFSITE` ([Backups](#backups)); the server ignores
them.

| Setting | What it is |
| --- | --- |
| `PORT` | the port, default 8780 |
| `HOST` | the address to listen on, default 127.0.0.1; loopback only |
| `STUDIO_RIG` | the rig: folly, the Folly's playa build (the default), or cog, City of Gods |
| `STUDIO_DATA` | the data folder, default data/ in the repo |
| `STUDIO_CURATORS` | comma-separated usernames with the curator role |
| `STUDIO_ADMINS` | comma-separated usernames with the admin role (admins are curators too) |
| `STUDIO_SECURE_COOKIES` | on: the session cookie is Secure (serve over https) |
| `STUDIO_TRUST_PROXY` | on: one proxy in front (a tunnel) gives the client's address and host |
| `STUDIO_FRAMES_BROTLI_QUALITY` | baked frames' brotli quality, default 9 |
| `STUDIO_FRAMES_MAX_BYTES` | baked frames' disk cap, default 2GB |
| `STUDIO_FLASH_CHECK` | off: flashing blocks and dims nothing (local use only) |
| `STUDIO_FLASH_PER_SECOND` | flashes a second allowed, default 3 (out of range: the default) |
| `STUDIO_FLASH_DELTA` | a flash's swing as a share of full light, default 0.5 |
| `STUDIO_FLASH_AREA` | the share of the LEDs or lit area that blocks, default 0.25 |
| `STUDIO_PREVIEWS` | the gallery previews' camera, default playa |
| `GIT_SHA` | the build's commit, for bug reports (default: the checkout's) |
| `STUDIO_BAKE_SECONDS` | the longest render-box bake, default 120 |
| `STUDIO_BAKE_TIMEOUT` | a bake's wall clock, default scaled to its length |
| `STUDIO_BAKE_CPU` | a bake's CPU seconds, default scaled to its length |
| `STUDIO_BAKE_TASKS` | a bake's task ceiling, default 256 |
| `STUDIO_BAKE_NICE` | a bake's nice level (0–19), default 10 |
| `STUDIO_BAKE_MEMORY` | a bake's memory cap, default 1GB |
| `STUDIO_BAKE_MAX_FRAMES` | the largest baked frames, default room for the longest bake |

### The flash check

Bakes that flash big and fast over a large area cannot be marked reviewed, and the preview dims them. Swings are
measured in the light the LEDs give (decoded by the output correction), not in colour values, and on each LED's
brightest channel, so a full red or blue strobe counts as fully as a white one. The three
`STUDIO_FLASH_*` limits above are the defaults: WCAG's three flashes a second, but only swings of half the light
over a quarter of the rig, so lively looks pass and real strobes do not. Set `STUDIO_FLASH_DELTA=0.1` and
`STUDIO_FLASH_AREA=0.1` for WCAG's own; out-of-range values fall back to the default (one that is not a number
stops the server). They apply to new
bakes and to the preview's guard (the browser gets them from `/api/me`). A curator can still approve a flashing
bake by giving a reason, which stays on the look with their name. Each person can turn the preview's dimming off
for themselves with "Don't dim for me".

`STUDIO_FLASH_CHECK=off` stops the check blocking or dimming anything (bakes still measure it and say so). It is
for trying things on your own machine: **not for public deployments**, where it would show strobes to people with
photosensitive epilepsy without warning.

## Without a systemd user session

Bakes run each in a systemd user scope with their caps, which works under WSL with `systemd=true` (as here: the user
manager has the memory and pids controllers). Without a user bus (WSL without systemd, containers), a bake's tasks
are capped only by your account's own limit (its pid namespace and wall clock still end it) and memory by
`RLIMIT_DATA`, and the log says so at start.

## Backups

Every deploy writes and enables a timer, `folly-studio-backup.timer` (`folly-studio-dev-backup.timer` for the dev
instance), that runs `deploy/backup.sh` from the live release daily at 04:15, or at the next start when the machine
was off then. It writes `folly-studio-<date>.tar.gz` of the data folder's JSON files into `STUDIO_BACKUP_DIR`, keeps
the newest `STUDIO_BACKUP_KEEP` there, and copies each new one to `STUDIO_BACKUP_OFFSITE` when that is set:

```sh
STUDIO_BACKUP_DIR=/home/you/folly-data-backups   # default: the data folder's path with -backups added
STUDIO_BACKUP_KEEP=14                            # archives kept there, default 14
STUDIO_BACKUP_OFFSITE=/mnt/d/folly-backups       # optional: another disk, or user@host:folly-backups over ssh
```

The off-site copy is `rsync`'s (install it: `sudo apt install rsync`; a deploy with `STUDIO_BACKUP_OFFSITE` set and
no `rsync` stops before anything changes). Over ssh it needs a key that works without a prompt (`ssh -o
BatchMode=yes user@host true` succeeds). Nothing is removed off-site: prune it there. Each instance keeps its own
`STUDIO_BACKUP_DIR`: a deploy refuses one another instance's settings name.

By hand, or with the baked frames:

```sh
npm run backup -- --out /mnt/d/folly-backups             # JSON files only: small
npm run backup -- --out /mnt/d/folly-backups --frames    # with the baked .fseq files (the render box can rebake)
```

A backup is safe while the server runs: the JSON files are read until none changes mid-read, and the archive
appears only once it is complete. A file it cannot read fails the backup rather than being left out, and the count
it prints is what went in. It holds password hashes, so keep it as private as the server. Bug reports
(`reports/`), previews and stream chunks are not in it; previews and chunks are made again on demand.

- Last runs: `systemctl --user list-timers 'folly-studio*'`; what it wrote or why it failed:
  `journalctl --user -u folly-studio-backup`. A failed run leaves the unit failed:
  `systemctl --user --failed` lists it.
- Without a systemd user session, use cron instead (`crontab -e`, then
  `15 4 * * * cd /path/to/studio && npm run backup -- --out /mnt/d/folly-backups`; WSL does not start cron for you:
  `sudo service cron start` *(to verify)*).

### Restore drill

Once a month, and after changing any backup setting, restore the newest archive into a throwaway studio and look
at it. Nothing here touches the live one:

```sh
f=$(ls -1 ~/folly-data-backups/folly-studio-*.tar.gz | tail -1)   # or the off-site copy
d=$(mktemp -d) && tar -xzf "$f" -C "$d" --strip-components=1
ls "$d"                                    # users.json, looks.json, … dated as you expect
cd ~/folly-studio/current && STUDIO_DATA="$d" PORT=8790 node server.ts
```

Open `http://127.0.0.1:8790`, sign in, and check that the newest looks are there. Then Ctrl-C and `rm -rf "$d"`.
It starts with the defaults (no env file; add your `STUDIO_RIG` if the env file sets one), so it may begin baking
or making previews: stop it once you have looked.

### Restoring

```sh
systemctl --user stop folly-studio
mkdir ~/folly-data.before-restore && cp -a ~/folly-data/*.json ~/folly-data.before-restore/
tar -xzf ~/folly-data-backups/folly-studio-<date>.tar.gz -C ~/folly-data --strip-components=1
systemctl --user start folly-studio
```

The archive's files replace those in the data folder; baked frames, previews and bug reports stay as they are. Keep
`folly-data.before-restore` until you are sure.

### Library only

The library-only step (SPEC-looks "Library only") drops stored looks and versions that hold code other than the
library's, logging each one, after copying `looks.json` and `users.json` beside themselves. Only you run it, once
per data folder: the server never does. First see what it would do (it writes nothing):
`node tools/library-only.ts --data ~/folly-data`; then stop the server and add `--apply`.

## Monitoring

- **Crashes restart.** An uncaught exception is logged (`[studio] uncaught exception, exiting: …`); the server saves
  what it can within 10 s and exits 1, and the unit's `Restart=on-failure` starts it again 5 s later. A failed promise
  (`[studio] unhandled rejection: …`) is one request's: it is logged and the server carries on. A stop
  (`systemctl --user stop`, a deploy) exits 0 and is not restarted. Restarts:
  `journalctl --user -u folly-studio -g 'uncaught|Started'`.
- **A line a day.** When a local day ends, the server writes its counts (SPEC-access "Stats"):
  `[studio] [stats] 2026-11-24 visitors=12 people=3 views=40 requests=900 errors=0 slow=2 bakes=5/0/0 uptime=86400s
  rss=120MB`. All of them: `journalctl --user -u folly-studio -g '\[stats\]'`.
- **From outside.** Nothing on this machine can say it is down, so let a free uptime service (UptimeRobot, Better
  Stack, or similar) fetch `https://folly.swampkat.com/build.json` every 5 minutes and email you when it fails twice:
  it expects a 200 whose body has `"commit"`. That one check covers WSL stopping, the tunnel or Cloudflare failing,
  and a server that keeps crashing. It costs one small request every 5 minutes, and `/build.json` is a static
  file, so it is counted in Stats but never logged.
