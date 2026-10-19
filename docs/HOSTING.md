# Hosting Folly Studio at home

For tens of people, on your own computer, behind an HTTPS tunnel. Commands marked *(to verify)*
were not run on a real tunnel when this was written. Check them against the tool's own docs.

## What runs where

| Where | What | Cost |
|---|---|---|
| Phone or laptop | The app, the 3D preview, every pattern's code (sandboxed iframe), playback of baked frames | Its own CPU and battery |
| Your computer (`npm start`) | Accounts, the JSON store, the API, static files, generators, bakes, frame encoding | About 100 MB of RAM idle; a login takes 128 MiB for half a second (scrypt, at most four at once) |
| Render box (bubblewrap) | One bake at a time, `nice 10`, ≤ 1 GB of data (`STUDIO_BAKE_MEMORY`), a wall clock | A 30 s look takes 2–3 s on one core |
| Encoder thread | Brotli for streaming, `nice 10`, one job at a time; a look's encode waits for any bake | 2.5–5.5 s per 30 s look at quality 9 |
| Fleet foundry (opt-in) | Deep ideas in a boxed agent, one at a time | Minutes, and **no memory cap on WSL** (below) |

Bakes and encodes yield to everything else: the API and your desktop stay responsive. Baked frames
take about 0.6 MB per second on disk. `STUDIO_FRAMES_MAX_BYTES` (default 2GB, roughly an hour of
frames) caps them: the least recently used go first, never a reviewed look's, and an evicted bake is
baked again when someone presses Play.

## Bandwidth

Static files are served under content-hashed URLs and cached for a year, so after the first visit
a reload costs about 2 KB (the page and two API checks, all `304`). A cold Studio load is about
145 KB. Lists send no code, and an idea being made is checked less and less often (2 s, then up to
10 s), never from a hidden tab. Streaming a baked look costs 0.05–2 MB per 30 s, depending on how
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

## Bind to localhost

`HOST` defaults to `127.0.0.1`: keep it. Never forward port 8780 on your router. The tunnel connects
outward to its provider, so nothing on your network opens.

## Cloudflare Tunnel *(to verify)*

```sh
cloudflared tunnel login                       # once: pick your domain
cloudflared tunnel create folly
cloudflared tunnel route dns folly studio.example.org
cat > ~/.cloudflared/config.yml <<'EOF'
tunnel: folly
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: studio.example.org
    service: http://127.0.0.1:8780
  - service: http_status:404
EOF
cloudflared tunnel run folly
```

For a quick trial with no domain, run `cloudflared tunnel --url http://127.0.0.1:8780`. In the
dashboard, leave Rocket Loader and email obfuscation off, because they inject scripts the CSP
refuses. Add no cache rules for `/api/`. Everything under `/assets/` is named by its content and may be cached
at the edge, which also spares your upload.

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

Keep it in a file only you can read (`chmod 600 ~/.folly-studio.env`), then start the server with
`set -a; . ~/.folly-studio.env; set +a; npm start`.

```sh
HOST=127.0.0.1
PORT=8780
STUDIO_DATA=/home/you/folly-data
STUDIO_SECURE_COOKIES=1           # the tunnel serves HTTPS
STUDIO_TRUST_PROXY=1              # client IP (login limits) and host from the tunnel, trusted from this machine only
STUDIO_CURATORS=alice,bob         # who may mark looks reviewed
STUDIO_GENERATOR=claude           # or sketch (offline, free)
ANTHROPIC_API_KEY=sk-ant-...      # a key with a spend limit
STUDIO_GENERATOR_FALLBACK=sketch  # when the generator fails, and for deep ideas while the foundry is off
STUDIO_BAKE_SECONDS=120           # longest bake
STUDIO_FRAMES_BROTLI_QUALITY=9
STUDIO_FRAMES_MAX_BYTES=2GB
```

## The Fleet foundry

`STUDIO_GENERATOR=fleet` sends ideas to a boxed Fleet worker (`fleet up`, boxed Codex). It runs only
with `STUDIO_FOUNDRY=on`, one job at a time. While the foundry is busy, the next idea goes to
`STUDIO_GENERATOR_FALLBACK`, or waits with `STUDIO_FOUNDRY_WAIT=1`. On a host without a systemd user
bus, such as WSL, Fleet's boxes get CPU and task limits but **no memory cap**, and the studio says
so in its log at start. A runaway worker can use all of your RAM. Prefer another machine for the
foundry, or watch it.

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
