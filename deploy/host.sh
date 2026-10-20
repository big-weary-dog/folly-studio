#!/usr/bin/env bash
# Start or update the hosted studio on this machine (docs/HOSTING.md "Hosting on this machine"): check out a commit,
# install, build, and (re)start it as a systemd user service, then check it serves that commit.
#
#   npm run host [-- <ref>]   default STUDIO_REF from the env file, else origin/main
#
#   STUDIO_ENV_FILE   the settings, default ~/.config/folly-studio/studio.env (chmod 600)
#   STUDIO_UNIT       the service's name, default folly-studio
#
# With PI_PREVIEW_URL in the env file, it also runs a dry-run Studio Live beside it as $STUDIO_UNIT-pi, for admins at
# /pi (docs/HOSTING.md "The Pi's page"); without it, that unit is stopped.
set -euo pipefail

die() { echo "host: $*" >&2; exit 1; }
studio=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root=$(git -C "$studio" rev-parse --show-toplevel)
env_file=${STUDIO_ENV_FILE:-$HOME/.config/folly-studio/studio.env}
unit=${STUDIO_UNIT:-folly-studio}

[ -f "$env_file" ] || die "no $env_file: write it first (docs/HOSTING.md \"Environment\")"
[ "$(stat -c %a "$env_file")" = 600 ] || die "$env_file must be readable only by you: chmod 600 $env_file"
# shellcheck disable=SC1090 # read in a subshell: only what the service needs to be found comes out
read -r ref host port pi_url < <(set -a; . "$env_file"
  echo "${STUDIO_REF:-origin/main} ${HOST:-127.0.0.1} ${PORT:-8780} ${PI_PREVIEW_URL:-}")
ref=${1:-$ref}
case $host in 127.0.0.1|localhost|::1) ;; *) die "HOST=$host: keep the studio on loopback, the tunnel reaches it";; esac
pi_port=
if [ -n "$pi_url" ]; then
  [[ $pi_url =~ ^http://127\.0\.0\.1:([0-9]+)/?$ ]] || die "PI_PREVIEW_URL=$pi_url: must be http://127.0.0.1:<port>"
  pi_port=${BASH_REMATCH[1]}
fi
command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 \
  || die "no systemd user session: in WSL, set [boot] systemd=true in /etc/wsl.conf and restart WSL"

if [ -z "${STUDIO_HOST_CHECKED_OUT:-}" ]; then
  git -C "$root" diff --quiet && git -C "$root" diff --cached --quiet \
    || die "$root has uncommitted changes: this checkout is the hosted one, keep it clean"
  echo "host: checking out $ref"
  git -C "$root" fetch --quiet origin
  git -C "$root" checkout --quiet --detach "$ref"
  # The rest is the checked-out commit's own steps: its unit, its checks.
  STUDIO_HOST_CHECKED_OUT=1 exec bash "$studio/deploy/host.sh"
fi
commit=$(git -C "$root" rev-parse HEAD)

cd "$studio"
npm ci --no-audit --no-fund --loglevel=error
# The gallery previews' camera (src/previews/playa.ts): a headless Chromium, kept in ~/.cache/ms-playwright.
node node_modules/playwright-core/cli.js install chromium-headless-shell >/dev/null
npm run --silent build >/dev/null
# What the check below asks for, and what anyone can ask the hosted studio for: /build.json.
printf '{ "commit": "%s", "builtAt": "%s" }\n' "$commit" "$(date -u +%FT%TZ)" > dist/build.json

node=$(command -v node)
units="$HOME/.config/systemd/user"
mkdir -p "$units"
cat > "$units/$unit.service" <<EOF
# Written by studio/deploy/host.sh; run it again rather than editing this.
[Unit]
Description=Folly Studio ($studio)

[Service]
WorkingDirectory=$studio
EnvironmentFile=$env_file
Environment=PATH=$(dirname "$node"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node server.ts
Restart=always
RestartSec=5
TimeoutStopSec=20
# A stop signals the server alone, which stops its generator calls itself and leaves their ideas for the next start.
KillMode=mixed

[Install]
WantedBy=default.target
EOF
if [ -n "$pi_port" ]; then
  # A dry run sends nothing to any lights; it is only the page, behind the studio's admin sign-in.
  cat > "$units/$unit-pi.service" <<EOF
# Written by studio/deploy/host.sh; run it again rather than editing this.
[Unit]
Description=Folly Studio Live, dry run, for the studio's /pi ($studio)

[Service]
WorkingDirectory=$studio
ExecStart=$node pi/main.ts --dry-run --base /pi --bind 127.0.0.1 --http $pi_port --stats 3600
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
fi
systemctl --user daemon-reload
systemctl --user enable --quiet "$unit"
systemctl --user restart "$unit"
if [ -n "$pi_port" ]; then
  systemctl --user enable --quiet "$unit-pi"
  systemctl --user restart "$unit-pi"
elif [ -f "$units/$unit-pi.service" ]; then
  systemctl --user disable --now --quiet "$unit-pi" || true
fi

url="http://${host/::1/[::1]}:$port"
for _ in $(seq 60); do
  served=$(curl -fsS -m 2 "$url/build.json" 2>/dev/null | grep -o '"commit": "[0-9a-f]*"' | cut -d'"' -f4) || true
  [ "$served" = "$commit" ] && break
  systemctl --user is-failed --quiet "$unit" && break
  sleep 0.5
done
if [ "$served" != "$commit" ]; then
  journalctl --user -u "$unit" -n 30 --no-pager >&2 || true
  die "$unit does not serve $commit on $url (journalctl --user -u $unit)"
fi
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/api/me")
[ "$code" = 401 ] || die "$url/api/me answered $code, not 401"
if [ -n "$pi_port" ]; then
  for _ in $(seq 20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 2 "http://127.0.0.1:$pi_port/pi/") || true
    [ "$code" = 200 ] && break
    sleep 0.5
  done
  [ "$code" = 200 ] || die "$unit-pi does not serve /pi/ on 127.0.0.1:$pi_port (journalctl --user -u $unit-pi)"
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/pi/")
  [ "$code" = 401 ] || die "$url/pi/ answered $code without a session, not 401"
  echo "host: $unit-pi serves the dry-run Pi page to admins at /pi/"
fi

# The tunnel's connector runs on Windows and reaches WSL through localhost forwarding: check that path too.
if command -v curl.exe >/dev/null; then
  if [ "$(curl.exe -fsS -m 5 "http://127.0.0.1:$port/build.json" 2>/dev/null | grep -o "$commit")" = "$commit" ]
  then echo "host: Windows reaches it on 127.0.0.1:$port"
  else die "Windows' 127.0.0.1:$port is not this studio, so the tunnel cannot reach it: is something on that port there?"
  fi
fi
echo "host: $unit serves $commit on $url"
