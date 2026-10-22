#!/usr/bin/env bash
# Install Folly Studio Live (the engine), or Studio with it (--studio), on the FPP Pi from the offline bundle that
# `npm run pi:bundle` makes (pi/SETUP.md). Needs no internet. Run as fpp, with the bundle beside this script:
#
#   bash install.sh                              # the engine alone: studio-live, its page on :4043/
#   bash install.sh --studio --admin NAME        # Studio on :8780/ too, the engine at :8780/pi/ and :4043/
#
#   --pin N       the engine's page asks for this PIN (Studio is told it too)
#   --bundle F    the bundle (default: folly-studio-pi.tgz beside this script)
#   --home DIR    install into DIR/folly-studio (default /home/fpp); anything else implies --no-units
#   --no-units    install no systemd units and use no sudo (a rehearsal off the Pi)
#
# Again over an install, it keeps pi/config.json, pi/light.json, pi/local/, studio.env and Studio's data, and keeps
# the old tree as folly-studio.old-<time>. It ends with a self-test that sends nothing to the lights.
set -euo pipefail

say() { echo "install: $*"; }
die() { echo "install: FAILED: $*" >&2; exit 1; }
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
studio='' admin='' pin='' bundle=$here/folly-studio-pi.tgz home=/home/fpp units=1
while [ $# -gt 0 ]; do
  case $1 in
    --studio) studio=1; shift ;;
    --admin) admin=$2; shift 2 ;;
    --pin) pin=$2; shift 2 ;;
    --bundle) bundle=$2; shift 2 ;;
    --home) home=$(realpath -m "$2"); shift 2 ;;
    --no-units) units=''; shift ;;
    *) die "unknown option $1 (see the top of $0)" ;;
  esac
done
[ "$home" = /home/fpp ] || units=''
app=$home/folly-studio data=$home/folly-data env=$home/.config/folly-studio/studio.env
[ -f "$bundle" ] || die "no bundle at $bundle: copy folly-studio-pi.tgz beside install.sh"
[ -z "$studio" ] || [ -n "$admin" ] || [ -f "$env" ] || die "--studio needs --admin <the crew lead's username>"

# Node: the units run /usr/bin/node; 22.6 or later runs our .ts as written.
node=/usr/bin/node
[ -n "$units" ] || node=$(command -v node || true)
[ -x "$node" ] || die "no Node at ${node:-PATH}: FPP 9 ships Node 22"
ver=$("$node" -p 'process.versions.node')
"$node" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a * 100 + b >= 2206 ? 0 : 1)' \
  || die "Node $ver is too old: Studio Live needs 22.6 or later"
say "Node $ver ($node), $("$node" -p 'process.arch'), $(uname -m)"
ts() { "$node" --experimental-strip-types --disable-warning=ExperimentalWarning "$@"; }   # as the units run it

# The tree: unpack beside the old one, carry the Pi's own settings and looks over, then swap.
mkdir -p "$home"
rm -rf "$app.new" && mkdir "$app.new"
tar -xzf "$bundle" -C "$app.new" --strip-components=1 --no-same-owner
if [ -d "$app" ]; then
  for keep in pi/config.json pi/light.json pi/local; do
    if [ -e "$app/$keep" ]; then cp -a "$app/$keep" "$app.new/$keep"; fi
  done
  old=$app.old-$(date +%Y%m%d-%H%M%S)
  mv "$app" "$old"
  say "the previous install is kept at $old"
fi
mv "$app.new" "$app"
cd "$app"
say "installed $(sed -n 's/.*"commit": "\([0-9a-f]\{12\}\).*/\1/p' dist/build.json) in $app"

# The engine's settings: the PIN, and behind Studio its base, light, frames and an open page (:4043/ for the hub).
"$node" -e '
  const fs = require("fs"), [file, studio, pin, data] = process.argv.slice(1);
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (pin) c.pin = pin;
  if (studio) Object.assign(c, { base: "/pi", light: `${data}/light.json`, frames: `${data}/frames`, bind: "0.0.0.0" });
  if (Object.keys(c).length) fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
' pi/config.json "$studio" "$pin" "$data"
"$node" -e 'process.exit(JSON.parse(require("fs").readFileSync("pi/config.json", "utf8")).pin ? 0 : 1)' 2>/dev/null \
  || say "WARNING: no PIN: anyone on the network can drive the lights from :4043/ (install again with --pin N)"

if [ -n "$studio" ]; then
  mkdir -p "$data" "$(dirname "$env")"
  if [ ! -f "$env" ]; then
    cat > "$env" <<EOF
STUDIO_PROFILE=pi
HOST=0.0.0.0
PORT=8780
STUDIO_DATA=$data
STUDIO_ADMINS=$admin
PI_PREVIEW_URL=http://127.0.0.1:4043
EOF
    [ -z "$pin" ] || echo "PI_PIN=$pin" >> "$env"
    chmod 600 "$env"
    say "wrote $env (admin $admin)"
  else
    say "kept $env"
  fi
  ts tools/config-check.ts "$env" || die "studio.env: fix what it says"
  "$node" -e 'require("sharp")' 2>/dev/null || die "sharp has no build for $("$node" -p 'process.arch') in the bundle"

  # bubblewrap for the render box (bakes): Debian's .deb from the bundle when it is missing.
  if ! command -v bwrap >/dev/null && [ -n "$units" ]; then
    . /etc/os-release
    case ${VERSION_CODENAME:-} in bookworm) v=0.8.0-2+deb12u1 ;; trixie) v=0.12.0-1~deb13u1 ;; *) v='' ;; esac
    deb=pi/debs/bubblewrap_${v}_$(dpkg --print-architecture).deb
    if [ -n "$v" ] && [ -f "$deb" ]; then sudo dpkg -i "$deb" >/dev/null && say "installed bubblewrap $v"
    else say "no bubblewrap .deb for ${VERSION_CODENAME:-this OS} $(dpkg --print-architecture)"; fi
  fi
  if command -v bwrap >/dev/null && bwrap --unshare-all --ro-bind / / --dev /dev --proc /proc true 2>/dev/null; then
    say "bubblewrap works: Studio bakes looks here"
  else
    say "WARNING: bubblewrap does not run here, so Studio cannot bake looks with custom code (library looks play live)"
  fi
fi

if [ -n "$units" ]; then
  sudo cp pi/studio-live.service /etc/systemd/system/
  [ -z "$studio" ] || sudo cp pi/folly-studio.service /etc/systemd/system/
  sudo systemctl daemon-reload
  say "installed studio-live.service (the ops hub starts it; not enabled at boot)"
  if [ -n "$studio" ]; then
    sudo systemctl enable folly-studio >/dev/null 2>&1
    sudo systemctl restart folly-studio
    say "folly-studio.service enabled and (re)started"
  fi
  if systemctl is-active --quiet studio-live; then sudo systemctl restart studio-live; say "restarted studio-live"; fi
else
  say "no systemd units (--no-units)"
fi

# The self-test, sending nothing: a dry run with no page (so it renders) for its frame and fps, then its page on a
# spare port, read at / (the hub's) and, behind Studio, at /pi/.
say "self-test: a 6 s dry run, nothing sent to the lights"
log=$(mktemp)
ts pi/main.ts --dry-run --http 0 --seconds 6 --stats 2 >"$log" 2>&1 || { cat "$log"; die "the dry run failed"; }
sed 's/^/  /' "$log"
grep -q 'DRY RUN, nothing sent, channels 1-70401 (rose expanded)' "$log" || die "the dry run did not say its frame"
test_port=14043
ts pi/main.ts --dry-run --http "$test_port" --bind 127.0.0.1 --seconds 30 >"$log" 2>&1 &
pid=$!
paths=/
[ -z "$studio" ] || paths="/ /pi/"
for p in $paths; do
  for _ in $(seq 100); do
    curl -sf -o /dev/null "http://127.0.0.1:$test_port$p" && break
    sleep 0.1
  done
  curl -sf "http://127.0.0.1:$test_port$p" | grep -q '<title>Studio Live</title>' && say "its page answers at $p" \
    || { kill "$pid" 2>/dev/null; cat "$log"; die "the engine's page did not answer at $p"; }
done
kill "$pid"
wait "$pid" 2>/dev/null || true
rm -f "$log"

if [ -n "$studio" ]; then
  port=8780
  if [ -z "$units" ]; then   # a rehearsal: Studio for a moment on a spare port
    port=18780
    (set -a; . "$env"; PORT=$port; PI_PREVIEW_URL=http://127.0.0.1:$test_port; ts server.ts) \
      >"$data/self-test.log" 2>&1 &
    spid=$!
  fi
  ok=''
  for _ in $(seq 100); do curl -sf -o /dev/null "http://127.0.0.1:$port/" && { ok=1; break; }; sleep 0.2; done
  [ -z "${spid:-}" ] || { kill "$spid"; wait "$spid" 2>/dev/null || true; }
  [ -n "$ok" ] || die "Studio did not answer on :$port (journalctl -u folly-studio -n 30)"
  say "Studio answers on :$port"
fi

ip=$(hostname -I 2>/dev/null | cut -d' ' -f1)
say "done. The engine's page: http://${ip:-<the Pi>}:4043/ once the ops hub starts studio-live"
[ -z "$studio" ] || say "Studio: http://${ip:-<the Pi>}:8780/ (sign up as $admin first), the engine at /pi/ there"
