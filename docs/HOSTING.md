# Hosting Folly Studio at home

For tens of people, on your own computer, behind an HTTPS tunnel. Commands marked *(to verify)*
were not run when this was written. Check them against the tool's own docs.

## What runs where

| Where | What | Cost |
|---|---|---|
| Phone or laptop | The app, the 3D preview, every pattern's code (sandboxed iframe), playback of baked frames | Its own CPU and battery |
| Your computer (`npm start`) | Accounts, the JSON store, the API, static files, generators, bakes, frame encoding | About 100 MB of RAM idle; a login takes 128 MiB for half a second (scrypt, at most four at once) |
| Codex CLI (Sol, Luna) | One `codex exec` per idea, two at once by default, read-only and with no tools | A short-lived process per idea; the model runs at OpenAI |
| Render box (bubblewrap) | One bake at a time, `nice 10`, in its own systemd user scope: ≤ 256 tasks (`STUDIO_BAKE_TASKS`), ≤ 1 GB (`STUDIO_BAKE_MEMORY`); a wall clock | A 30 s look takes 2–3 s on one core |
| Encoder thread | Brotli for streaming, `nice 10`, one job at a time; a look's encode waits for any bake | 2.5–5.5 s per 30 s look at quality 9 |
| Fleet foundry (opt-in) | Deep ideas in a boxed agent, one at a time | Minutes, and **no memory cap** without a systemd user session (below) |

Bakes and encodes yield to everything else: the API and your desktop stay responsive. Baked frames
take about 0.6 MB per second on disk. `STUDIO_FRAMES_MAX_BYTES` (default 2GB, roughly an hour of
frames) caps them: the least recently used go first, never a reviewed look's, and an evicted bake is
baked again when someone presses Play.

## Bandwidth

Static files are served under content-hashed URLs and cached for a year, so after the first visit
a reload costs about 2 KB (the page and two API checks, all `304`). A cold Studio load is about
145 KB. Lists send no code, and an idea being made is followed by long polls: the server answers when it
changes, or after 25 s, so a page learns at once that its look is ready, with two or three requests per idea and
none from a hidden tab. Streaming a baked look costs 0.05–2 MB per 30 s, depending on how
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

1. A checkout of its own, apart from any fleet's trees, since `npm run host` checks out commits in it:

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
(default `STUDIO_REF`, else `origin/prod`; a ref `origin` lacks stops it before anything changes). It refuses a checkout with uncommitted changes, then: fetches and checks
out the ref, `npm ci`, builds, writes `dist/build.json` (`{ commit, builtAt }`), writes and restarts the unit, and
checks that `/build.json` names the commit, `/api/me` answers 401, and Windows reaches it too. The unit's `KillMode=mixed`
sends the restart's SIGTERM to the server alone: it stops its generator calls, saves and closes, and the ideas it
cut short (left queued or generating) resume at the next start, so a deploy never fails an idea in progress. Requests during the few seconds of
install and restart may fail; a reload fixes them.

- Another port: set `PORT` in the env file, run `npm run host`, and change the tunnel's URL to match.
- Logs: `journalctl --user -u folly-studio -f`. Status: `systemctl --user status folly-studio`. An unhandled error is logged there (`[studio] unhandled …`) and the server carries on.
- Stop: `systemctl --user stop folly-studio` (`disable` too, to keep it off at boot).
- The commit that is live, from anywhere: `https://folly.swampkat.com/build.json`.
- The unit is written by the script, to `~/.config/systemd/user/folly-studio.service`: change the script, not it.
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
port, settings and unit, so nothing it does reaches folly.swampkat.com. `offline` is a third, a trial of the Pi's
Studio (`STUDIO_PROFILE=pi`, [The Pi profile](#the-pi-profile)) here on loopback, with a dry-run engine for its
**Lights**.

| | public | dev | offline |
|---|---|---|---|
| Checkout | `~/folly-prod`, `origin/prod` | `~/folly-dev`, `origin/dev` | `~/folly-offline`, `origin/dev` |
| Data (`STUDIO_DATA`) | `~/folly-data` | `~/folly-dev-data` | `~/folly-offline-data` |
| Port | 127.0.0.1:8780 | 127.0.0.1:8781 | 127.0.0.1:8782 |
| Engine (`PI_PREVIEW_URL`) | 127.0.0.1:4043 | | 127.0.0.1:4045 |
| Settings | `~/.config/folly-studio/studio.env` | `studio-dev.env` | `studio-offline.env` |
| Unit | `folly-studio` (and `folly-studio-pi`) | `folly-studio-dev` | `folly-studio-offline` (and `-offline-pi`) |

Set up, once:

1. `git clone https://github.com/big-weary-dog/folly-studio.git ~/folly-dev`.
2. `~/.config/folly-studio/studio-dev.env` (chmod 600), as the [Environment](#environment) below, with at least
   `STUDIO_DATA=/home/<you>/folly-dev-data`, `PORT=8781` and `STUDIO_ADMINS=<your dev username>`. No account,
   session or invite code carries over: sign up there afresh as that username.
3. Seed its data from the public studio's, before its first start:

   ```sh
   cd ~/folly-dev && npm ci && node tools/seed-dev.ts --from ~/folly-data --to ~/folly-dev-data
   ```

   This copies the shared looks (with their baked frames and gallery previews), the light settings and the model
   registry; it only reads the source. It never copies users, sessions or invites, nor ideas, reports or the live
   stage. A copied look keeps its owner's name in the gallery, but no dev account owns it: anyone may open and
   play it, no one edit it. Unshared looks stay behind. It refuses a target that is not empty, or that is the
   source or inside it; to seed again, stop the dev studio and empty its folder first.
4. `cd ~/folly-dev && npm run host -- --instance dev` (or `STUDIO_INSTANCE=dev npm run host`). It ends on
   `host: folly-studio-dev serves <commit> on http://127.0.0.1:8781`.

Updating is the same command again, from `~/folly-dev`; `npm run host -- --instance dev <ref>` for another
branch. Logs: `journalctl --user -u folly-studio-dev -f`.

The offline one is set up the same way from `~/folly-offline`, with `--instance offline` and
`~/.config/folly-studio/studio-offline.env` (chmod 600) holding at least `STUDIO_PROFILE=pi`,
`STUDIO_DATA=/home/<you>/folly-offline-data`, `PORT=8782`, `PI_PREVIEW_URL=http://127.0.0.1:4045` and
`STUDIO_ADMINS=<your username>` (`STUDIO_CURATORS` for others who may open **Lights**). It needs no seeding: bring
looks in with Import. `HOST` stays loopback, as for the others. It ends on `host: folly-studio-offline serves
<commit> on http://127.0.0.1:8782`.

Each run writes, enables and restarts its own instance's unit alone, and refuses to start when another instance's
settings (if this machine has them) name the same `PORT`, `STUDIO_DATA` or engine port, or when its own name the
wrong `STUDIO_PROFILE` (`pi` for offline only). The data lock (`studio.lock`, under
[Environment](#environment)) keeps a studio off a folder another one has open, so a dev studio pointed at
`~/folly-data` by mistake stops at start.

A dev instance runs no `-pi` unit unless its settings name `PI_PREVIEW_URL`; Windows not reaching its port is a
note, not a failure, since it may have no tunnel.

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
`set -a; . ~/.config/folly-studio/studio.env; set +a; npm start`. Every session running as your user can read it,
so give the API key a spend limit. The server reads every setting once at start (`src/config.ts`; all of them under
"Every setting" below) and logs what is set, the API key only as set. A value it cannot read stops it, naming the
variable: on/off takes `1`, `true`, `on` or `yes`, or `0`, `false`, `off` or `no` (any case); a duration takes a unit
(`500ms`, `90s`, `5m`, `2h`), and a bare number is in milliseconds for a `_MS` name, else seconds (a bare `_MS`
value under 1000 is warned of: seconds were likely meant); a size takes `k`, `m` or `g` (`2GB`). A `STUDIO_` name it
does not read is warned of (a typo?). Unset, each setting has its default.

```sh
HOST=127.0.0.1
PORT=8780
STUDIO_REF=origin/prod            # what npm run host checks out
STUDIO_DATA=/home/you/folly-data  # outside the checkout
STUDIO_SECURE_COOKIES=1           # the tunnel serves HTTPS
STUDIO_TRUST_PROXY=1              # client IP (login limits) and host from the tunnel, trusted from this machine only
STUDIO_CURATORS=alice,bob         # who may mark looks reviewed
STUDIO_ADMINS=you                 # the Admin page (models, access, light, reports); admins are curators too
ANTHROPIC_API_KEY=sk-ant-...      # for Opus: a key with a spend limit
STUDIO_GENERATOR_FALLBACK=sol     # optional: foundry ideas go here while it is off or busy (else wait, or fail)
STUDIO_BAKE_SECONDS=120           # longest bake
STUDIO_FRAMES_BROTLI_QUALITY=9
STUDIO_FRAMES_MAX_BYTES=2GB
STUDIO_FLASH_PER_SECOND=3         # the flash check: flashes a second allowed (WCAG 2.3.1: 3)
STUDIO_FLASH_DELTA=0.5            # a flash's swing, as a share of the LEDs' full light (WCAG: 0.1)
STUDIO_FLASH_AREA=0.25            # share of the LEDs, or of the lit area from the front or side, that blocks
STUDIO_LIVE_CONTROL=curators      # who drives /live: curators (and admins), admins, or members (anyone signed in)
STUDIO_LIVE_LOOKS=reviewed        # what may play on /live: reviewed looks, or any shared look
PI_PREVIEW_URL=http://127.0.0.1:4043  # the Pi's control page, dry run, for admins at /pi (below); unset: no /pi
```

Sign-up is open to anyone who reaches the page.

One server per data folder: the server keeps its data in memory and rewrites whole files, so it holds
`studio.lock` (its pid) in `STUDIO_DATA` while it runs. A second server on the same folder does not start, naming
the folder and the pid using it. A lock left by a server that was killed is taken over when its pid is no longer a
running `node`.

### Checking the settings

`npm run config:check -- ~/.config/folly-studio/studio.env` reads a settings file as the server would and prints
`OK`, or the names of the settings that would stop it, then any it would warn of. It never prints a value. It exits
1 when the server would not start. `npm run host` runs it with the new build, after building and before restarting
anything: when it fails, the deploy stops there and the service already running keeps running, on its old settings.
Then fix the env file, or redeploy the previous commit: `npm run host -- <old sha>`.

### Every setting

`npm run host` also reads `STUDIO_REF`, `STUDIO_ENV_FILE` and `STUDIO_UNIT` (`deploy/host.sh`); the server ignores
them.

| Setting | What it is |
| --- | --- |
| `PORT` | the port, default 8780 |
| `HOST` | the address to listen on, default 127.0.0.1; loopback only unless STUDIO_PROFILE=pi |
| `STUDIO_PROFILE` | hosted (the default), or pi: the Pi's offline Studio (SPEC-offline) |
| `STUDIO_DATA` | the data folder, default data/ in the repo |
| `STUDIO_CURATORS` | comma-separated usernames with the curator role |
| `STUDIO_ADMINS` | comma-separated usernames with the admin role (admins are curators too) |
| `STUDIO_SECURE_COOKIES` | on: the session cookie is Secure (serve over https) |
| `STUDIO_TRUST_PROXY` | on: one proxy in front (a tunnel) gives the client's address and host |
| `STUDIO_MODELS` | the model registry, default \<STUDIO_DATA>/models.json |
| `STUDIO_GENERATOR` | superseded by the registry: its default when first written (claude, fleet) |
| `STUDIO_GENERATOR_FALLBACK` | a model or transport foundry ideas go to while it is off or busy |
| `STUDIO_GENERATOR_CONCURRENCY` | jobs at once per lane where the registry says nothing |
| `STUDIO_FOUNDRY` | on: the Fleet foundry runs, one job at a time |
| `STUDIO_FOUNDRY_WAIT` | on: foundry ideas wait while it is busy, even with a fallback |
| `STUDIO_CRITIQUE_BUDGET_MS` | past this, no critique starts; default 90s |
| `STUDIO_IDEA_LOGS` | ideas' logs kept, default 300; 0: none written |
| `STUDIO_IDEA_LOGS_MAX_BYTES` | their disk cap, default 500MB |
| `STUDIO_FRAMES_BROTLI_QUALITY` | baked frames' brotli quality, default 9 |
| `STUDIO_FRAMES_MAX_BYTES` | baked frames' disk cap, default 2GB (the Pi: 1GB) |
| `STUDIO_FLASH_CHECK` | off: flashing blocks and dims nothing (local use only) |
| `STUDIO_FLASH_PER_SECOND` | flashes a second allowed, default 3 (out of range: the default) |
| `STUDIO_FLASH_DELTA` | a flash's swing as a share of full light, default 0.5 |
| `STUDIO_FLASH_AREA` | the share of the LEDs or lit area that blocks, default 0.25 |
| `STUDIO_LIVE_CONTROL` | who drives /live, default curators |
| `STUDIO_LIVE_LOOKS` | what may play on /live, default reviewed |
| `STUDIO_PREVIEWS` | the gallery previews' camera, default playa (the Pi: front) |
| `PI_PREVIEW_URL` | a Studio Live engine on this machine, at /pi (here a dry run; the Pi's own on it) |
| `PI_PIN` | the engine's PIN, if it has one: Studio's feed says it to play on the lights; a secret |
| `GIT_SHA` | the build's commit, for bug reports (default: the checkout's) |
| `STUDIO_BAKE_SECONDS` | the longest render-box bake, default 120 |
| `STUDIO_BAKE_TIMEOUT` | a bake's wall clock, default scaled to its length |
| `STUDIO_BAKE_CPU` | a bake's CPU seconds, default scaled to its length |
| `STUDIO_BAKE_TASKS` | a bake's task ceiling, default 256 |
| `STUDIO_BAKE_NICE` | a bake's nice level (0–19), default 10 (the Pi: 19) |
| `STUDIO_BAKE_MEMORY` | a bake's memory cap, default 1GB (the Pi: 384MB) |
| `STUDIO_BAKE_MAX_FRAMES` | the largest baked frames, default room for the longest bake |
| `ANTHROPIC_API_KEY` | the Messages API key (Opus); a secret |
| `ANTHROPIC_BASE_URL` | the Messages API, default https://api.anthropic.com |
| `STUDIO_CLAUDE_MODEL` | a claude model's name where its entry names none |
| `STUDIO_CLAUDE_EFFORT` | a claude model's effort where its entry names none, default medium |
| `STUDIO_CLAUDE_MAX_TOKENS` | a claude answer's tokens, thinking too; default 32000 |
| `STUDIO_CLAUDE_TIMEOUT_MS` | a claude call's attempt, default 300s |
| `STUDIO_CLAUDE_FALLBACKS` | off: no server-side refusal fallback |
| `STUDIO_CODEX_BIN` | the Codex CLI, default codex on PATH |
| `STUDIO_CODEX_TIMEOUT_MS` | a codex call's wall clock, default 300s |
| `STUDIO_CODEX_IDLE_MS` | a codex call silent this long has stalled; default 180s |
| `STUDIO_CODEX_WORK` | codex's empty work folder, default in the system's temp folder |
| `STUDIO_CODEX_SCHEMA` | off: no --output-schema |
| `STUDIO_CODEX_USER_CONFIG` | on: codex reads ~/.codex/config.toml |
| `STUDIO_FLEET_BIN` | the fleet command, default fleet |
| `STUDIO_FLEET_WORK` | the foundry's workspaces, default ~/.folly-studio/fleet |
| `STUDIO_FLEET_MODEL` | the foundry's model where its entry names none, default gpt-6.1-sol |
| `STUDIO_FLEET_TIMEOUT` | a foundry job's wall clock, default 30m |
| `STUDIO_FLEET_POLL` | how often a foundry job is looked at, default 5s |
| `STUDIO_FLEET_DATA` | fleet's state folder, default ~/.fleet |
| `STUDIO_FLEET_TMUX` | the tmux command, default tmux |
| `STUDIO_FLEET_MAX_FRAMES` | the largest frames a foundry job may leave, default room for 120 s |

### The live stage

`/live` shows everyone signed in the same look at the same moment; `/live/control` drives it (SPEC-live). Its
socket is `/api/live/socket` on the same host, which both tunnels carry as they are. Its state survives a restart
in `live.json` in `STUDIO_DATA`. It has no flash guard yet: keep `STUDIO_LIVE_LOOKS=reviewed` on a public site.

### The Pi's page

`/pi/` shows Studio Live's live play page (`pi/README.md` "The control page") to signed-in admins, so it can be tried away from the
Pi's network. With `PI_PREVIEW_URL` set, `npm run host` also runs `folly-studio-pi`: `npm run pi -- --dry-run
--base /pi` on that loopback port, which renders as the Pi would and sends nothing to any lights (the page says
"Dry run"). Studio passes `/pi/` and its socket `/pi/ws` through to it, for admins only: a session-less visit is
asked to sign in (401), anyone else is refused (403), and the socket must come from this site. The page keeps its
own CSP. It drives only that dry run, never the Pi itself. Using a control there makes Studio's Live tab play what the
dry run plays, for every viewer, until a curator uses Live control again (SPEC-live "Following /pi"); both pages say
which drives (on `/pi/`, in its Output panel). The dry run renders only while someone has its page open (here or through `/pi/`), so to save the
CPU Studio's `/live` holds still while it follows a dry run no one has open. Unset `PI_PREVIEW_URL` and run `npm run host` again to take it down. The Admin page links it.

### The Pi profile

`STUDIO_PROFILE=pi` is the Studio on the FPP Pi itself, offline, beside the real engine: no generators, no Ideas,
listening on the Pi's network, `/pi` open to curators (SPEC-offline), the lights in Jukebox until an admin picks
Live Play (Admin → Light, kept in `lights.json`; SPEC-liveplay), and curators' `/live` the live play page. It is not for this machine: here the server
refuses any `HOST` but loopback. Installing it: `pi/SETUP.md`, from the offline bundle `npm run pi:bundle` makes
here (the app built, `node_modules` for the Pi); or `pi/STUDIO.md`, from the `pi` branch, which `npm run pi:branch`
makes here from `prod` (the app built, `dist/` committed) and force-pushes.

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

## Models

People pick a model for each idea from the ones you offer. They live in `models.json` in `STUDIO_DATA`
(`STUDIO_MODELS` names another file), written with the defaults on first run:

```json
{
  "default": "opus",
  "models": [
    { "id": "opus", "label": "Opus", "via": "claude", "model": "claude-opus-5-5", "effort": "medium", "enabled": true },
    { "id": "sol", "label": "Sol", "via": "codex", "model": "gpt-6.1-sol", "effort": "low", "critique": "images",
      "enabled": true },
    { "id": "luna", "label": "Luna", "via": "codex", "model": "gpt-6-luna", "effort": "low", "critique": "text",
      "enabled": true }
  ],
  "concurrency": { "claude": 4, "codex": 2 },
  "limits": { "inviteOnly": true, "perHour": 6, "perDay": 20, "concurrent": 2, "dailyCeiling": 200 }
}
```

Edit it by hand or on Admin's **Models** tab (admins only: `STUDIO_ADMINS`): turn a model on or off, set its effort,
pick the default. The server reads the file again when it changes, with no restart; a file that does not parse is
reported in the log and on the Models page, and the last good one stays in use. Each model may also say
`"roles": ["admin"]` (who may pick it; none: everyone), `"maxTokens"`, `"timeoutSeconds"` and `"critique"`
(`"images"` or `"text"`: a round where the model sees what it made; only by hand, and a file written before Sol
and Luna had it keeps its own settings, so add it there). `via` is how it is
reached: `claude` (the Anthropic API), `codex` (the Codex CLI) or `fleet` (the foundry, below).
A model whose transport is not set up (no `ANTHROPIC_API_KEY`, no `codex` on PATH) shows as unavailable and is not
offered; the form hides its choice when only one model can run. `STUDIO_GENERATOR` is superseded: it only names the
default when the file is first written.

**Speed.** Effort is the main lever: each model's is pinned in the file (Opus medium, Sol and Luna low), and lower
is faster. Each transport has its own lane (`concurrency`), so an Opus idea never waits behind a Sol one. The
system prompt is built once per library and rig and sent the same, byte for byte, every time, so Anthropic's prompt
cache (and OpenAI's prefix caching, for Codex) can serve it after the first idea. The log says where each idea's
time went (`queued … prompt … request … parse`), and so does the idea's `timing` in `ideas.json`, with its tokens.

**The idea log.** Each idea leaves a record of what its model was asked, answered and shown in
`STUDIO_DATA/ideas-log/<id>/` (SPEC-generators "The idea log"); an admin opens it from the idea's "Log" link. An
explore idea's is about 0.25 MB, a third of it the stills. `STUDIO_IDEA_LOGS=300` keeps the newest 300 (`0` writes none) and
`STUDIO_IDEA_LOGS_MAX_BYTES=500MB` caps them all; older ones are removed as new ones start. Its owner reads it as the idea's
"How it was made" page, live while it runs (SPEC-generators "How it was made"): the shared prompt by size only, no
errors, no dollars; admins see those too. Once the log is gone, the page shows the summary the idea keeps.

### Invites and limits

Anyone can sign up, browse, edit, preview and use the gallery. Every model is **paid** (it
spends your API money or your Codex and Fleet capacity), so making a look needs an **invite code**, and each person's
use is limited. Admins are exempt from both. The `limits` block above holds the defaults; tune them in the file, and they apply at once:

| Setting | Default | Why |
|---|---|---|
| `inviteOnly` | `true` | Paid models need a code. `false` unlocks everyone (a private server) |
| `perHour` | 6 | An idea takes 20–60 s, so six lets someone try, look and try again through a sitting |
| `perDay` | 20 | The cap the studio had before invites; enough for a good evening's work |
| `concurrent` | 2 | Ideas queued or being made at once, so one person cannot fill Opus's 4 lanes |
| `dailyCeiling` | 200 | Everyone's paid ideas in 24 hours: about 10 people at their full allowance, ~$40 a day of Opus at medium at worst. A backstop: still give the API key its own spend limit |

The hour and day are rolling (the last 60 minutes, the last 24 hours), and a person's paid ideas share one
allowance. A model may also say `"limits": { "perHour", "perDay", "concurrent" }`, a cap counted on that model's
ideas alone. **One idea is one use**, counted
when it is accepted, whatever comes of it: a retry or any repair inside it adds nothing, and "Try
again" sends a new idea.

On the **Access** page (admins) make a code: a label for who it is for, how many people may redeem it, and how many
days it lasts (blank: no expiry). It is shown once (only its hash is kept), so copy it then; revoke it any time. A
person types it in the idea form's code box and their account is unlocked for good. Redeeming is limited to 5 wrong
codes per account and 20 wrong codes per address in 15 minutes; good codes never count. Under **People** you can unlock or lock someone by hand,
**Reset** their count (their ideas so far stop counting), or give them their own **Limits** (blank fields keep the
defaults).

### Codex (Sol, Luna)

Sol and Luna run through the Codex CLI on this computer, signed in with its own login, as Fleet's workers do:

```sh
npm install -g @openai/codex@0.160.1     # or a later version
codex login                              # once, as the user who runs the studio
codex exec --skip-git-repo-check -m gpt-6-luna "reply ok"   # check: it answers
```

On Windows, run these in the same kind of terminal as the studio: `npm install -g` puts `codex.cmd` on PATH, and the
studio runs the script it points to with Node directly, never through `cmd.exe`. Under WSL, install and log in
inside WSL. `STUDIO_CODEX_BIN` names the command if it is not on PATH. Each idea runs `codex exec` once, with no
session saved, in an empty folder (`STUDIO_CODEX_WORK`, default in the system's temp folder) under a read-only
sandbox with Codex's command, web and image tools off; it sees only the environment the CLI needs (its home, login
and proxy settings), and gets 5 minutes (`timeoutSeconds`) before its whole process tree is stopped. The studio skips
your `~/.codex/config.toml` (MCP servers, instructions) so calls start fast and alike; `STUDIO_CODEX_USER_CONFIG=1`
reads it, if you need it for your login. `STUDIO_CODEX_SCHEMA=0` drops the output schema, should a model refuse it.
The code a model writes is data: it only ever runs in the browser's sandbox and the render box.

## The Fleet foundry

A model with `"via": "fleet"` (`STUDIO_GENERATOR=fleet` adds one, `foundry`, when the registry is first written)
sends ideas to a boxed Fleet worker (`fleet up`, boxed Codex). It runs only with `STUDIO_FOUNDRY=on`, one job at a
time. While the foundry is busy the next idea waits, and while it is off its ideas fail, saying so; with
`STUDIO_GENERATOR_FALLBACK` set they go there instead (while busy, unless `STUDIO_FOUNDRY_WAIT=1`). Fleet puts each box in a systemd user scope with a memory cap, which works under WSL with
`systemd=true` (as here: the user manager has the memory and pids controllers). On a host without a systemd user
session (WSL without systemd, containers), Fleet's boxes get CPU and task limits but **no memory cap**, and the
studio says so in its log at start: a runaway worker can use all of your RAM. Prefer another machine for the
foundry there, or watch it.

Bakes get the same treatment: without a user bus, a bake's tasks are capped only by your account's own limit
(its pid namespace and wall clock still end it) and memory by `RLIMIT_DATA`, and the log says so at start.

## Backups

```sh
npm run backup -- --out /mnt/d/folly-backups             # JSON files only: small
npm run backup -- --out /mnt/d/folly-backups --frames    # with the baked .fseq files
```

This writes `folly-studio-<date>.tar.gz`, safe while the server runs. The JSON files are read until
none changes mid-read, and the archive appears only once it is complete. It holds password hashes,
so keep it private. Run it daily with cron (`crontab -e`, then
`15 4 * * * cd /path/to/studio && npm run backup -- --out /mnt/d/folly-backups`). WSL does not
start cron for you: run `sudo service cron start` *(to verify)*. To restore, stop the server and
unpack the archive's files into `STUDIO_DATA`. Baked frames and stream chunks that are missing are
made again on demand.
