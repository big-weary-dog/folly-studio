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
   git clone https://github.com/big-weary-dog/show-builder.git ~/folly-studio
   ```

   Until `studio/` is on main, check out its branch:
   `git -C ~/folly-studio checkout --detach origin/ccr-c0df4e5c-e6amkz`.

2. The settings (the [Environment](#environment) below): `mkdir -p ~/.config/folly-studio`, then
   `nano ~/.config/folly-studio/studio.env && chmod 600 ~/.config/folly-studio/studio.env`.
3. Start it: `cd ~/folly-studio/studio && npm run host`. It ends on
   `host: folly-studio serves <commit> on http://127.0.0.1:8780`, or says what failed.
4. The public hostname (Cloudflare, below).

### Updating

`cd ~/folly-studio/studio && npm run host` again, or `npm run host -- <ref>` for another commit or branch
(default `STUDIO_REF`, else `origin/main`). It refuses a checkout with uncommitted changes, then: fetches and checks
out the ref, `npm ci`, builds, writes `dist/build.json` (`{ commit, builtAt }`), writes and restarts the unit, and
checks that `/build.json` names the commit, `/api/me` answers 401, and Windows reaches it too. The server saves
and closes on the restart's SIGTERM; ideas cut short queue again at start. Requests during the few seconds of
install and restart may fail; a reload fixes them.

- Another port: set `PORT` in the env file, run `npm run host`, and change the tunnel's URL to match.
- Logs: `journalctl --user -u folly-studio -f`. Status: `systemctl --user status folly-studio`.
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
so give the API key a spend limit.

```sh
HOST=127.0.0.1
PORT=8780
STUDIO_REF=origin/main            # what npm run host checks out
STUDIO_DATA=/home/you/folly-data  # outside the checkout
STUDIO_SECURE_COOKIES=1           # the tunnel serves HTTPS
STUDIO_TRUST_PROXY=1              # client IP (login limits) and host from the tunnel, trusted from this machine only
STUDIO_CURATORS=alice,bob         # who may mark looks reviewed
STUDIO_ADMINS=you                 # the Models and Access pages (models, invite codes); admins are curators too
ANTHROPIC_API_KEY=sk-ant-...      # for Opus: a key with a spend limit
STUDIO_GENERATOR_FALLBACK=sketch  # when a model fails, and for deep ideas while the foundry is off
STUDIO_BAKE_SECONDS=120           # longest bake
STUDIO_FRAMES_BROTLI_QUALITY=9
STUDIO_FRAMES_MAX_BYTES=2GB
STUDIO_FLASH_PER_SECOND=3         # the flash check: flashes a second allowed (WCAG 2.3.1: 3)
STUDIO_FLASH_DELTA=0.1            # a flash's swing in relative luminance (WCAG: 0.1)
STUDIO_FLASH_AREA=0.1             # share of the LEDs, or of the lit area from the front or side, that blocks
STUDIO_LIVE_CONTROL=curators      # who drives /live: curators (and admins), admins, or members (anyone signed in)
STUDIO_LIVE_LOOKS=reviewed        # what may play on /live: reviewed looks, or any shared look
```

Sign-up is open to anyone who reaches the page.

### The live stage

`/live` shows everyone signed in the same look at the same moment; `/live/control` drives it (SPEC-live). Its
socket is `/api/live/socket` on the same host, which both tunnels carry as they are. Its state survives a restart
in `live.json` in `STUDIO_DATA`. It has no flash guard yet: keep `STUDIO_LIVE_LOOKS=reviewed` on a public site.

### The flash check

Bakes that flash fast over a large area cannot be marked reviewed, and the preview dims them. The three
`STUDIO_FLASH_*` limits above default to WCAG's; out-of-range values fall back to the default. They apply to new
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
    { "id": "sol", "label": "Sol", "via": "codex", "model": "gpt-6.1-sol", "effort": "low", "enabled": true },
    { "id": "luna", "label": "Luna", "via": "codex", "model": "gpt-6-luna", "effort": "low", "enabled": true },
    { "id": "sketch", "label": "Sketch", "via": "sketch", "enabled": true, "limits": { "perHour": 30, "perDay": 100 } }
  ],
  "concurrency": { "claude": 4, "codex": 2 },
  "limits": { "inviteOnly": true, "perHour": 6, "perDay": 20, "concurrent": 2, "dailyCeiling": 200 }
}
```

Edit it by hand or on the **Models** page (admins only: `STUDIO_ADMINS`): turn a model on or off, set its effort,
pick the default. The server reads the file again when it changes, with no restart; a file that does not parse is
reported in the log and on the Models page, and the last good one stays in use. Each model may also say
`"roles": ["admin"]` (who may pick it; none: everyone), `"maxTokens"` and `"timeoutSeconds"`. `via` is how it is
reached: `claude` (the Anthropic API), `codex` (the Codex CLI), `sketch` (offline) or `fleet` (the foundry, below).
A model whose transport is not set up (no `ANTHROPIC_API_KEY`, no `codex` on PATH) shows as unavailable and is not
offered; the form hides its choice when only one model can run. `STUDIO_GENERATOR` is superseded: it only names the
default when the file is first written.

**Speed.** Effort is the main lever: each model's is pinned in the file (Opus medium, Sol and Luna low), and lower
is faster. Each transport has its own lane (`concurrency`), so an Opus idea never waits behind a Sol one. The
system prompt is built once per library and rig and sent the same, byte for byte, every time, so Anthropic's prompt
cache (and OpenAI's prefix caching, for Codex) can serve it after the first idea. The log says where each idea's
time went (`queued … prompt … request … parse`), and so does the idea's `timing` in `ideas.json`.

### Invites and limits

Anyone can sign up, browse, edit, preview and use Sketch. The **paid** models (every `via` but `sketch`: they spend
your API money or your Codex and Fleet capacity) need an **invite code**, and each person's use is limited. Admins
are exempt from both. The `limits` block above holds the defaults; tune them in the file, and they apply at once:

| Setting | Default | Why |
|---|---|---|
| `inviteOnly` | `true` | Paid models need a code. `false` unlocks everyone (a private server) |
| `perHour` | 6 | An idea takes 20–60 s, so six lets someone try, look and try again through a sitting |
| `perDay` | 20 | The cap the studio had before invites; enough for a good evening's work |
| `concurrent` | 2 | Ideas queued or being made at once, so one person cannot fill Opus's 4 lanes |
| `dailyCeiling` | 200 | Everyone's paid ideas in 24 hours: about 10 people at their full allowance, ~$40 a day of Opus at medium at worst. A backstop: still give the API key its own spend limit |

The hour and day are rolling (the last 60 minutes, the last 24 hours), and a person's paid ideas share one
allowance. A model may also say `"limits": { "perHour", "perDay", "concurrent" }`, a cap counted on that model's
ideas alone (Sketch's 30 an hour and 100 a day keep a script from filling the disk). **One idea is one use**, counted
when it is accepted, whatever comes of it: a retry, the fallback or any repair inside it adds nothing, and "Try
again" sends a new idea.

On the **Access** page (admins) make a code: a label for who it is for, how many people may redeem it, and how many
days it lasts (blank: no expiry). It is shown once (only its hash is kept), so copy it then; revoke it any time. A
person types it in the idea form's code box and their account is unlocked for good. Redeeming is limited to 5 wrong
codes per account and 20 tries per address in 15 minutes. Under **People** you can unlock or lock someone by hand,
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
time. While the foundry is busy, the next idea goes to `STUDIO_GENERATOR_FALLBACK`, or waits with
`STUDIO_FOUNDRY_WAIT=1`. Fleet puts each box in a systemd user scope with a memory cap, which works under WSL with
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
