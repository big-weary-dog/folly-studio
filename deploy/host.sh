#!/usr/bin/env bash
# Start or update the hosted studio on this machine (docs/HOSTING.md "Hosting on this machine"): check out a commit,
# install, build, and (re)start it as a systemd user service, then check it serves that commit.
#
#   npm run host [-- [--instance dev|offline] [--no-pi-bundle] <ref>]
#                     <ref>: default STUDIO_REF from the env file, else origin/prod (dev and offline: origin/dev)
#                     --no-pi-bundle: make no Pi bundle for this commit, so it serves none
#
#   STUDIO_INSTANCE   which studio: unset is the public one; dev is the internal one beside it, offline a trial of
#                     the Pi's (STUDIO_PROFILE=pi) on loopback (docs/HOSTING.md "Dev instance"), each with its own
#                     env file, unit and port; one never touches another's units
#   STUDIO_ENV_FILE   the settings, default ~/.config/folly-studio/studio.env (studio-dev.env, studio-offline.env;
#                     chmod 600)
#   STUDIO_UNIT       the service's name, default folly-studio (folly-studio-dev, folly-studio-offline)
#
# With PI_PREVIEW_URL in the env file, it also runs a dry-run Studio Live beside it as $STUDIO_UNIT-pi, for admins
# (offline: curators too) at /pi (docs/HOSTING.md "The Pi's page"); without it, that unit is stopped.
#
# It also makes the Pi bundle of the commit (deploy/pi-bundle.sh, SPEC-offline "Downloading the Pi bundle") in
# ~/.cache/folly-studio/<unit>/ and names it to the service; a bundle that fails is a warning, and the studio serves none.
set -euo pipefail

die() { echo "host: $*" >&2; exit 1; }
studio=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root=$(git -C "$studio" rev-parse --show-toplevel)
if [ "${1:-}" = --instance ]; then STUDIO_INSTANCE=${2:-}; shift 2 || die "--instance needs a name"; fi
if [ "${1:-}" = --no-pi-bundle ]; then STUDIO_NO_PI_BUNDLE=1; shift; fi
instance=${STUDIO_INSTANCE:-}
settings=$HOME/.config/folly-studio
# Each instance's settings file and port when the file does not name one.
declare -A PORTS=([studio]=8780 [studio-dev]=8781 [studio-offline]=8782)
case $instance in
  '') suffix= default_ref=origin/prod profile=hosted ;;
  dev) suffix=-dev default_ref=origin/dev profile=hosted ;;
  offline) suffix=-offline default_ref=origin/dev profile=pi ;;
  *) die "--instance $instance: the instances are dev and offline, or none for the public studio" ;;
esac
default_port=${PORTS[studio$suffix]}
env_file=${STUDIO_ENV_FILE:-$settings/studio$suffix.env}
unit=${STUDIO_UNIT:-folly-studio$suffix}

[ -f "$env_file" ] || die "no $env_file: write it first (docs/HOSTING.md \"Environment\")"
[ "$(stat -c %a "$env_file")" = 600 ] || die "$env_file must be readable only by you: chmod 600 $env_file"
# shellcheck disable=SC1090 # read in a subshell: only what the service needs to be found comes out
read -r ref host port has_profile pi_url < <(set -a; . "$env_file"
  echo "${STUDIO_REF:-$default_ref} ${HOST:-127.0.0.1} ${PORT:-$default_port} ${STUDIO_PROFILE:-hosted}" \
    "${PI_PREVIEW_URL:-}")
ref=${1:-$ref}
[ "$has_profile" = "$profile" ] \
  || die "STUDIO_PROFILE=$has_profile in $env_file: the ${instance:-public} studio runs $profile (docs/HOSTING.md)"
# shellcheck disable=SC1090 # the data dir, whose light settings the dry-run Pi reads too (SPEC "Light and output")
data=$(cd "$studio"; set -a; . "$env_file"; realpath -m "${STUDIO_DATA:-$studio/data}")
light=$data/light.json
case $host in 127.0.0.1|localhost|::1) ;; *) die "HOST=$host: keep the studio on loopback, the tunnel reaches it";; esac
# The dry-run engine's port, from PI_PREVIEW_URL ('' without one).
engine_port() {
  [ -n "$1" ] || return 0
  [[ $1 =~ ^http://127\.0\.0\.1:([0-9]+)/?$ ]] || die "PI_PREVIEW_URL=$1: must be http://127.0.0.1:<port>"
  echo "${BASH_REMATCH[1]}"
}
pi_port=$(engine_port "$pi_url")
# The other instances this machine has: never their port, their data or their engine's port.
for name in "${!PORTS[@]}"; do
  other=$settings/$name.env
  [ "$other" != "$env_file" ] && [ -r "$other" ] || continue
  # shellcheck disable=SC1090
  read -r other_port other_pi other_data < <(set -a; . "$other"
    echo "${PORT:-${PORTS[$name]}} ${PI_PREVIEW_URL:--} ${STUDIO_DATA:+$(realpath -m "$STUDIO_DATA")}")
  [ "$other_port" != "$port" ] || die "PORT=$port is $other's too: give each studio its own port"
  [ "${other_data:-}" != "$data" ] || die "STUDIO_DATA=$data is $other's too: give each studio its own data"
  # An assignment, so a malformed URL there stops this run too.
  other_engine=$([ "$other_pi" = - ] || engine_port "$other_pi") || die "in $other"
  [ -z "$other_engine" ] || [ -z "$pi_port" ] || [ "$other_engine" != "$pi_port" ] \
    || die "PI_PREVIEW_URL's port $pi_port is $other's too: give each studio's engine its own port"
  [ -z "$other_engine" ] || [ "$other_engine" != "$port" ] \
    || die "PORT=$port is the engine's port in $other: give each its own"
done
command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 \
  || die "no systemd user session: in WSL, set [boot] systemd=true in /etc/wsl.conf and restart WSL"

if [ -z "${STUDIO_HOST_CHECKED_OUT:-}" ]; then
  git -C "$root" diff --quiet && git -C "$root" diff --cached --quiet \
    || die "$root has uncommitted changes: this checkout is the hosted one, keep it clean"
  echo "host: checking out $ref"
  git -C "$root" fetch --quiet origin
  git -C "$root" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || die "no $ref in $(git -C "$root" remote get-url origin): set STUDIO_REF in $env_file, or pass a ref"
  git -C "$root" checkout --quiet --detach "$ref"
  # The rest is the checked-out commit's own steps: its unit, its checks.
  # Named outright, so a commit's host.sh from before instances still writes this instance's unit, not another's.
  STUDIO_INSTANCE=$instance STUDIO_ENV_FILE=$env_file STUDIO_UNIT=$unit \
    STUDIO_NO_PI_BUNDLE=${STUDIO_NO_PI_BUNDLE:-} STUDIO_HOST_CHECKED_OUT=1 exec bash "$studio/deploy/host.sh"
fi
commit=$(git -C "$root" rev-parse HEAD)

cd "$studio"
npm ci --no-audit --no-fund --loglevel=error
# The gallery previews' camera (src/previews/playa.ts): a headless Chromium, kept in ~/.cache/ms-playwright.
node node_modules/playwright-core/cli.js install chromium-headless-shell >/dev/null
npm run --silent build >/dev/null
# What the check below asks for, and what anyone can ask the hosted studio for: /build.json.
printf '{ "commit": "%s", "builtAt": "%s" }\n' "$commit" "$(date -u +%FT%TZ)" > dist/build.json
# The new build's own reading of the settings, before anything restarts: a value it would refuse leaves the running
# service as it is. It prints names only, never values.
node tools/config-check.ts "$env_file" \
  || die "$commit would not start with $env_file (the names above; docs/HOSTING.md \"Environment\"); $unit left running"

# The Pi bundle (SPEC-offline "Downloading the Pi bundle"): made here, never at a request; its listing checked for
# anything secret. A failure leaves the studio with no bundle rather than stopping the deploy.
bundles=$HOME/.cache/folly-studio/$unit
bundle=$bundles/folly-studio-pi-${commit:0:12}.tar
make_bundle() {
  local work=$bundles/work
  rm -rf "$work" && mkdir -p "$work/folly-studio-pi" || return 1
  bash deploy/pi-bundle.sh "$commit" --out "$work/folly-studio-pi/folly-studio-pi.tgz" | grep '^pi-bundle:' || return 1
  cp pi/SETUP.md "$work/folly-studio-pi/" || return 1
  tar -tzf "$work/folly-studio-pi/folly-studio-pi.tgz" | node tools/pi-bundle-check.ts || return 1
  tar -cf "$bundle.part" -C "$work" folly-studio-pi && mv "$bundle.part" "$bundle" && rm -rf "$work"
}
if [ -n "${STUDIO_NO_PI_BUNDLE:-}" ]; then
  echo "host: no Pi bundle (--no-pi-bundle)"
  bundle=
elif [ -f "$bundle" ]; then
  echo "host: the Pi bundle of ${commit:0:12} is already made"
elif ! make_bundle; then
  echo "host: WARNING: the Pi bundle failed (above); $unit serves none" >&2
  rm -rf "$bundles/work" "$bundle.part"
  bundle=
fi

node=$(command -v node)
units="$HOME/.config/systemd/user"
mkdir -p "$units"
cat > "$units/$unit.service" <<EOF
# Written by deploy/host.sh; run it again rather than editing this.
[Unit]
Description=Folly Studio${instance:+ ($instance)} ($studio)

[Service]
WorkingDirectory=$studio
EnvironmentFile=$env_file
${bundle:+Environment=STUDIO_PI_BUNDLE=$bundle
}Environment=PATH=$(dirname "$node"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
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
# Written by deploy/host.sh; run it again rather than editing this.
[Unit]
Description=Folly Studio Live, dry run, for the studio's /pi ($studio)

[Service]
WorkingDirectory=$studio
ExecStart=$node pi/main.ts --dry-run --base /pi --bind 127.0.0.1 --http $pi_port --stats 3600 --light "$light"
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

# Only this commit's bundle stays.
find "$bundles" -maxdepth 1 -name 'folly-studio-pi-*.tar' ! -path "${bundle:-/}" -delete 2>/dev/null || true

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

# The tunnel's connector runs on Windows and reaches WSL through localhost forwarding: check that path too. Only the
# public studio must be reachable; a dev one may have no tunnel yet.
if command -v curl.exe >/dev/null; then
  if [ "$(curl.exe -fsS -m 5 "http://127.0.0.1:$port/build.json" 2>/dev/null | grep -o "$commit")" = "$commit" ]
  then echo "host: Windows reaches it on 127.0.0.1:$port"
  elif [ -n "$instance" ]; then echo "host: Windows' 127.0.0.1:$port is not this studio: a tunnel could not reach it"
  else die "Windows' 127.0.0.1:$port is not this studio, so the tunnel cannot reach it: is something on that port there?"
  fi
fi
if [ -n "$bundle" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/api/pi-bundle/info")
  [ "$code" = 401 ] || die "$url/api/pi-bundle/info answered $code without a session, not 401"
  echo "host: the Pi bundle ($(du -h "$bundle" | cut -f1)) is at Admin → Pi bundle"
fi
echo "host: $unit serves $commit on $url"
