#!/usr/bin/env bash
# Start or update the hosted studio on this machine (docs/HOSTING.md "Updating"): install and build a commit in a
# release of its own, check its settings, switch the systemd user service to it and restart, then check it serves it.
#
#   npm run host [-- [--instance dev] [<ref> | --rollback]]
#                     <ref>: default STUDIO_REF from the env file, else origin/prod (dev: origin/dev)
#                     --rollback: back to the previous release, already built, with no fetch
#
#   STUDIO_INSTANCE   which studio: unset is the public one; dev is the internal one beside it (docs/HOSTING.md
#                     "Dev instance"), with its own env file, unit and port; one never touches another's units
#   STUDIO_ENV_FILE   the settings, default ~/.config/folly-studio/studio.env (studio-dev.env; chmod 600)
#   STUDIO_UNIT       the service's name, default folly-studio (folly-studio-dev)
#
# Each release is releases/<commit>, a git worktree of this checkout; the links current (what the unit runs) and
# previous name two of them. Nothing is installed or built in the release being served, and a good deploy keeps
# three: current, previous and the newest other.
#
# A commit's host.sh without the next line predates releases, and is refused:
# deploys: releases
#
# A $STUDIO_UNIT-pi service an earlier deploy left (the archived Pi engine's dry run, ARCHIVE.md) is stopped and
# removed, with its Pi bundles.
set -euo pipefail

die() { echo "host: $*" >&2; exit 1; }
studio=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root=$(git -C "$studio" rev-parse --show-toplevel)
if [ "${1:-}" = --instance ]; then STUDIO_INSTANCE=${2:-}; shift 2 || die "--instance needs a name"; fi
rollback=
if [ "${1:-}" = --rollback ]; then rollback=1; shift; [ $# = 0 ] || die "--rollback takes no ref"; fi
instance=${STUDIO_INSTANCE:-}
settings=$HOME/.config/folly-studio
# Each instance's settings file and port when the file does not name one.
declare -A PORTS=([studio]=8780 [studio-dev]=8781)
case $instance in
  '') suffix= default_ref=origin/prod ;;
  dev) suffix=-dev default_ref=origin/dev ;;
  *) die "--instance $instance: the instance is dev, or none for the public studio" ;;
esac
default_port=${PORTS[studio$suffix]}
env_file=${STUDIO_ENV_FILE:-$settings/studio$suffix.env}
unit=${STUDIO_UNIT:-folly-studio$suffix}
units=$HOME/.config/systemd/user
# The second step runs from the release, which is the checkout's releases/<commit>.
release=
if [ -n "${STUDIO_HOST_CHECKED_OUT:-}" ] && [ "$(basename "$(dirname "$studio")")" = releases ]; then
  release=$studio root=$(dirname "$(dirname "$studio")")
fi

[ -f "$env_file" ] || die "no $env_file: write it first (docs/HOSTING.md \"Environment\")"
[ "$(stat -c %a "$env_file")" = 600 ] || die "$env_file must be readable only by you: chmod 600 $env_file"
# shellcheck disable=SC1090 # read in a subshell: only what the service needs to be found comes out
read -r ref host port < <(set -a; . "$env_file"
  echo "${STUDIO_REF:-$default_ref} ${HOST:-127.0.0.1} ${PORT:-$default_port}")
ref=${1:-$ref}
# shellcheck disable=SC1090 # the data dir
data=$(cd "$root"; set -a; . "$env_file"; realpath -m "${STUDIO_DATA:-$root/data}")
case $host in 127.0.0.1|localhost|::1) ;; *) die "HOST=$host: keep the studio on loopback, the tunnel reaches it";; esac
# The other instances this machine has: never their port or their data.
for name in "${!PORTS[@]}"; do
  other=$settings/$name.env
  [ "$other" != "$env_file" ] && [ -r "$other" ] || continue
  # shellcheck disable=SC1090
  read -r other_port other_data < <(set -a; . "$other"
    echo "${PORT:-${PORTS[$name]}} ${STUDIO_DATA:+$(realpath -m "$STUDIO_DATA")}")
  [ "$other_port" != "$port" ] || die "PORT=$port is $other's too: give each studio its own port"
  [ "${other_data:-}" != "$data" ] || die "STUDIO_DATA=$data is $other's too: give each studio its own data"
done
for other in "$units"/*.service; do
  [ -f "$other" ] && [ "$other" != "$units/$unit.service" ] || continue
  # $root itself: a unit from before releases.
  ! grep -qxF -e "WorkingDirectory=$root/current" -e "WorkingDirectory=$root" "$other" \
    || die "$root is $(basename "$other" .service)'s checkout: give each studio its own"
done
command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 \
  || die "no systemd user session: in WSL, set [boot] systemd=true in /etc/wsl.conf and restart WSL"

if [ -z "$release" ]; then
  # One deploy at a time per checkout; the release's step below inherits the lock across the exec.
  exec 9>"$root/.host.lock"
  flock -n 9 || die "another npm run host is deploying from $root"
  if [ -n "$rollback" ]; then
    previous=$(readlink "$root/previous") || die "no previous release in $root to roll back to"
    ref=${previous#releases/}
  else
    git -C "$root" fetch --quiet origin
  fi
  commit=$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}") \
    || die "no $ref in $(git -C "$root" remote get-url origin): set STUDIO_REF in $env_file, or pass a ref"
  git -C "$root" show "$commit:deploy/host.sh" 2>/dev/null | grep -x '# deploys: releases' >/dev/null \
    || die "$commit's deploy/host.sh predates releases: deploy a later commit"
  release=$root/releases/$commit
  # dist/build.json is written last: without it, the release is one a failed run left, and is made again.
  if [ ! -f "$release/dist/build.json" ]; then
    git -C "$root" worktree remove --force "$release" 2>/dev/null || rm -rf "$release"
    git -C "$root" worktree prune
    git -C "$root" worktree add --quiet --detach "$release" "$commit"
  fi
  echo "host: $ref is $commit, in releases/"
  # The rest is the release's own steps: its unit, its checks.
  # Named outright, so a commit's host.sh from before instances still writes this instance's unit, not another's.
  STUDIO_INSTANCE=$instance STUDIO_ENV_FILE=$env_file STUDIO_UNIT=$unit \
    STUDIO_HOST_CHECKED_OUT=1 exec bash "$release/deploy/host.sh"
fi
commit=$(git -C "$release" rev-parse HEAD)
live=$(readlink "$root/current" || true)

cd "$release"
if [ ! -f dist/build.json ]; then
  npm ci --no-audit --no-fund --loglevel=error
  # The gallery previews' camera (src/previews/playa.ts): a headless Chromium, kept in ~/.cache/ms-playwright.
  node node_modules/playwright-core/cli.js install chromium-headless-shell >/dev/null
  npm run --silent build >/dev/null
  # What the check below asks for, and what anyone can ask the hosted studio for: /build.json.
  printf '{ "commit": "%s", "builtAt": "%s" }\n' "$commit" "$(date -u +%FT%TZ)" > dist/build.json.new
  mv dist/build.json.new dist/build.json
fi
# The new build's own reading of the settings, before anything restarts: a value it would refuse leaves the running
# service as it is. It prints names only, never values.
node tools/config-check.ts "$env_file" \
  || die "$commit would not start with $env_file (the names above; docs/HOSTING.md \"Environment\");" \
    "$unit left running${live:+ on $live}"

# The switch: current moves in one rename; the release it named becomes previous.
if [ "$live" != "releases/$commit" ]; then
  [ -z "$live" ] || ln -sfn "$live" "$root/previous"
  ln -sfn "releases/$commit" "$root/current.new"
  mv -T "$root/current.new" "$root/current"
fi

node=$(command -v node)
# The data folder (resolved above) is the checkout's, as when it was the working directory, never a release's.
# As one systemd argument: quoted, with its own \, ", $ and % escaped.
paths_args=
for setting in "STUDIO_DATA=$data"; do
  setting=${setting//\\/\\\\}; setting=${setting//\"/\\\"}; setting=${setting//\$/\$\$}
  paths_args+="\"${setting//%/%%}\" "
done
mkdir -p "$units"
cat > "$units/$unit.service" <<EOF
# Written by deploy/host.sh; run it again rather than editing this.
[Unit]
Description=Folly Studio${instance:+ ($instance)} ($root)

[Service]
WorkingDirectory=$root/current
EnvironmentFile=$env_file
Environment=PATH=$(dirname "$node"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
# Set here, as the env file would win over Environment=.
ExecStart=/usr/bin/env $paths_args$node server.ts
Restart=always
RestartSec=5
TimeoutStopSec=20
# A stop signals the server alone, which saves and closes itself.
KillMode=mixed

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --quiet "$unit"
systemctl --user restart "$unit"
if [ -f "$units/$unit-pi.service" ]; then
  systemctl --user disable --now --quiet "$unit-pi" || true
  rm -f "$units/$unit-pi.service"
  systemctl --user daemon-reload
fi
rm -rf "$HOME/.cache/folly-studio/$unit"

url="http://${host/::1/[::1]}:$port"
for _ in $(seq 60); do
  served=$(curl -fsS -m 2 "$url/build.json" 2>/dev/null | grep -o '"commit": "[0-9a-f]*"' | cut -d'"' -f4) || true
  [ "$served" = "$commit" ] && break
  systemctl --user is-failed --quiet "$unit" && break
  sleep 0.5
done
if [ "$served" != "$commit" ]; then
  journalctl --user -u "$unit" -n 30 --no-pager >&2 || true
  die "$unit does not serve $commit on $url (journalctl --user -u $unit)${live:+; back to $live:
    npm run host -- ${instance:+--instance $instance }--rollback}"
fi
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/api/me")
[ "$code" = 401 ] || die "$url/api/me answered $code, not 401"
# The tunnel's connector runs on Windows and reaches WSL through localhost forwarding: check that path too. Only the
# public studio must be reachable; a dev one may have no tunnel yet.
if command -v curl.exe >/dev/null; then
  if [ "$(curl.exe -fsS -m 5 "http://127.0.0.1:$port/build.json" 2>/dev/null | grep -o "$commit")" = "$commit" ]
  then echo "host: Windows reaches it on 127.0.0.1:$port"
  elif [ -n "$instance" ]; then echo "host: Windows' 127.0.0.1:$port is not this studio: a tunnel could not reach it"
  else die "Windows' 127.0.0.1:$port is not this studio, so the tunnel cannot reach it: is something on that port there?"
  fi
fi

previous=$(readlink "$root/previous" || true)
# Three releases stay: this one, previous and the newest other (two others before there is a previous).
others=2
[ -z "$previous" ] || others=1
while read -r dir; do
  name=releases/$(basename "$dir")
  [ "$name" != "releases/$commit" ] && [ "$name" != "$previous" ] || continue
  if [ "$others" -gt 0 ]; then others=$((others - 1)); continue; fi
  git -C "$root" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
done < <(ls -1td "$root"/releases/*/)
git -C "$root" worktree prune
echo "host: $unit serves $commit on $url"
