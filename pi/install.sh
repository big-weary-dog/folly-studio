#!/usr/bin/env bash
# Install Folly Studio Live (the engine), or Studio with it (--studio), on the FPP Pi from the offline bundle that
# `npm run pi:bundle` makes (pi/SETUP.md). Needs no internet. Run as fpp, with the bundle beside this script:
#
#   bash install.sh                              # the engine alone: studio-live, its page on :4043/
#   bash install.sh --studio --admin NAME        # Studio on :8780/ too, the engine at :8780/pi/ and :4043/
#
#   --pin N       the engine's page asks for this PIN (Studio is told it too)
#   --looks DIR   engine looks to add to pi/local/looks (default: looks/ beside this script, if there)
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
studio='' admin='' pin='' bundle=$here/folly-studio-pi.tgz home=/home/fpp units=1 looks=$here/looks
while [ $# -gt 0 ]; do
  case $1 in
    --studio) studio=1; shift ;;
    --admin) admin=$2; shift 2 ;;
    --pin) pin=$2; shift 2 ;;
    --bundle) bundle=$2; shift 2 ;;
    --looks) looks=$2; shift 2 ;;
    --home) home=$(realpath -m "$2"); shift 2 ;;
    --no-units) units=''; shift ;;
    *) die "unknown option $1 (see the top of $0)" ;;
  esac
done
[ "$home" = /home/fpp ] || units=''
app=$home/folly-studio data=$home/folly-data env=$home/.config/folly-studio/studio.env
[ ! -f "$env" ] || studio=1
[ -f "$bundle" ] || die "no bundle at $bundle: copy folly-studio-pi.tgz beside install.sh"
[ -z "$studio" ] || [ -n "$admin" ] || [ -f "$env" ] || die "--studio needs --admin <the crew lead's username>"

# Node: the units run /usr/bin/node; match the repository's minimum.
node=/usr/bin/node
[ -n "$units" ] || node=$(command -v node || true)
[ -x "$node" ] || die "no Node at ${node:-PATH}: FPP 9 ships Node 22"
ver=$("$node" -p 'process.versions.node')
"$node" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a * 100 + b >= 2218 ? 0 : 1)' \
  || die "Node $ver is too old: Studio Live needs 22.18 or later"
say "Node $ver ($node), $("$node" -p 'process.arch'), $(uname -m)"
ts() { "$node" --experimental-strip-types --disable-warning=ExperimentalWarning "$@"; }   # as the units run it
wait_http() {
  for _ in $(seq 100); do
    [ -z "${2:-}" ] || kill -0 "$2" 2>/dev/null || return 1
    curl -sf -o /dev/null "$1" && return 0
    sleep 0.1
  done
  return 1
}
stop_rehearsal() {
  local child=$1 name=$2 logfile=$3 signalled='' status=0
  # The deadline may already have stopped it. Always reap it so a crash cannot pass as a successful check.
  if kill "$child" 2>/dev/null; then signalled=1; fi
  wait "$child" 2>/dev/null || status=$?
  if [ "$status" -ne 0 ] && { [ "$status" -ne 143 ] || [ -z "$signalled" ]; }; then
    cat "$logfile"
    die "the staged $name exited with status $status"
  fi
}
rehearsal_port() {
  local child=$1 logfile=$2 label=$3 port=''
  for _ in $(seq 100); do
    kill -0 "$child" 2>/dev/null || return 1
    port=$(sed -n "s|.*$label http://127.0.0.1:\([0-9][0-9]*\).*|\1|p" "$logfile" | head -1)
    if [ -n "$port" ]; then echo "$port"; return 0; fi
    sleep 0.1
  done
  return 1
}

# The tree: unpack beside the old one, carry the Pi's own settings and looks over, then swap.
mkdir -p "$home"
stage=$(mktemp -d "$app.stage-XXXXXX")
old='' swapped='' committed='' pid='' spid='' log=''
live_active='' studio_active=''
if [ -n "$units" ]; then
  systemctl is-active --quiet studio-live && live_active=1
  systemctl is-active --quiet folly-studio && studio_active=1
fi
cleanup() {
  result=$?
  set +e
  trap - EXIT
  for child in "$pid" "$spid"; do
    [ -z "$child" ] || { kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }
  done
  if [ -n "$swapped" ] && [ -z "$committed" ]; then
    say "activation failed: restoring the previous install"
    if [ -n "$units" ]; then sudo systemctl stop studio-live folly-studio || true; fi
    cd "$home"
    rm -rf "$app"
    [ -z "$old" ] || mv "$old" "$app"
    if [ -f "$stage/env.old" ]; then cp -p "$stage/env.old" "$env";
    elif [ -n "$studio" ]; then rm -f "$env"; fi
    if [ -n "$units" ]; then
      for unit in studio-live folly-studio; do
        if [ -f "$stage/$unit.service" ]; then sudo cp "$stage/$unit.service" /etc/systemd/system/;
        else sudo rm -f "/etc/systemd/system/$unit.service"; fi
      done
      sudo systemctl daemon-reload || true
      sudo systemctl disable folly-studio || true
      [ -z "$live_active" ] || sudo systemctl restart studio-live || true
      [ -z "$studio_active" ] || sudo systemctl restart folly-studio || true
    fi
  fi
  rm -rf "$stage"
  [ -z "$log" ] || rm -f "$log"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$stage/tree"
tar -xzf "$bundle" -C "$stage/tree" --strip-components=1 --no-same-owner
if [ -d "$app" ]; then
  for keep in pi/config.json pi/light.json pi/local; do
    if [ -e "$app/$keep" ]; then cp -a "$app/$keep" "$stage/tree/$keep"; fi
  done
fi
cd "$stage/tree"
if [ -d "$looks" ] && ls "$looks"/*.json >/dev/null 2>&1; then
  mkdir -p pi/local/looks
  cp "$looks"/*.json pi/local/looks/
  count=$("$node" --input-type=module - "$looks"/*.json <<'JS'
import { readFileSync } from 'node:fs';
let count = 0;
for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  count += Array.isArray(raw?.looks) ? raw.looks.length : 1;
}
console.log(count);
JS
  )
  say "added $count looks to pi/local/looks from $looks"
fi
say "staged $(sed -n 's/.*"commit": "\([0-9a-f]\{12\}\).*/\1/p' dist/build.json) for $app"

# The engine's settings: the PIN, and behind Studio its base, light, frames and an open page (:4043/ for the hub).
"$node" -e '
  const fs = require("fs"), [file, studio, pin, data] = process.argv.slice(1);
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (pin) c.pin = pin;
  if (studio) Object.assign(c, { base: "/pi", light: `${data}/light.json`, frames: `${data}/frames`, bind: "0.0.0.0" });
  fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
' pi/config.json "$studio" "$pin" "$data"
"$node" -e 'process.exit(JSON.parse(require("fs").readFileSync("pi/config.json", "utf8")).pin ? 0 : 1)' 2>/dev/null \
  || say "WARNING: no PIN: anyone on the network can drive the lights from :4043/ (install again with --pin N)"

if [ -n "$studio" ]; then
  mkdir -p "$data" "$(dirname "$env")"
  if [ -f "$env" ]; then cp -p "$env" "$stage/env.old"; cp -p "$env" "$stage/studio.env";
  else
    cat > "$stage/studio.env" <<EOF
STUDIO_PROFILE=pi
HOST=0.0.0.0
PORT=8780
STUDIO_DATA=$data
STUDIO_ADMINS=$admin
PI_PREVIEW_URL=http://127.0.0.1:4043
EOF
  fi
  "$node" -e '
    const fs = require("fs"), [file] = process.argv.slice(1);
    const pin = JSON.parse(fs.readFileSync("pi/config.json", "utf8")).pin || "";
    const text = fs.readFileSync(file, "utf8").replace(/^\s*(?:export\s+)?PI_PIN\s*=.*\n?/gm, "");
    fs.writeFileSync(file, text.trimEnd() + "\nPI_PIN=" + JSON.stringify(pin) + "\n", { mode: 0o600 });
  ' "$stage/studio.env"
  chmod 600 "$stage/studio.env"
  ts tools/config-check.ts "$stage/studio.env" || die "studio.env: fix what it says"
  "$node" -e 'require("sharp")' 2>/dev/null || die "sharp has no build for $("$node" -p 'process.arch') in the bundle"

  # bubblewrap (bakes of custom code) is used when the OS has it; the installer never installs it.
  if command -v bwrap >/dev/null && bwrap --unshare-all --ro-bind / / --dev /dev --proc /proc true 2>/dev/null; then
    say "bubblewrap works: Studio bakes looks here"
  else
    say "WARNING: bubblewrap does not run here, so Studio cannot bake looks with custom code (library looks play live)"
  fi
fi

# The self-test, sending nothing: a dry run with no page (so it renders) for its frame and fps, then its page on a
# spare port, read at / (the hub's) and, behind Studio, at /pi/.
say "self-test: a 6 s dry run, nothing sent to the lights"
log=$(mktemp)
ts pi/main.ts --dry-run --http 0 --seconds 6 --stats 2 >"$log" 2>&1 || { cat "$log"; die "the dry run failed"; }
sed 's/^/  /' "$log"
grep -q 'DRY RUN, nothing sent, channels 1-70401 (rose expanded)' "$log" || die "the dry run did not say its frame"
! grep -q 'cannot play' "$log" || die "a look cannot play (above): fix or remove it in pi/local/looks"
(exec "$node" --experimental-strip-types --disable-warning=ExperimentalWarning pi/main.ts \
  --dry-run --http auto --bind 127.0.0.1 --seconds 30) >"$log" 2>&1 &
pid=$!
test_port=$(rehearsal_port "$pid" "$log" 'control page on') \
  || { cat "$log"; die "the staged engine did not bind its rehearsal port"; }
paths=/
[ -z "$studio" ] || paths="/ /pi/"
for p in $paths; do
  wait_http "http://127.0.0.1:$test_port$p" "$pid" || { cat "$log"; die "the staged engine did not start"; }
  curl -sf "http://127.0.0.1:$test_port$p" | grep -q '<title>Studio Live</title>' && say "its page answers at $p" \
    || { kill "$pid" 2>/dev/null; cat "$log"; die "the engine's page did not answer at $p"; }
done
"$node" --input-type=module - "$test_port" "${studio:+$stage/studio.env}" <<'JS'
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import WebSocket from 'ws';
const [port, env] = process.argv.slice(2);
const pin = env ? parseEnv(fs.readFileSync(env, 'utf8')).PI_PIN
  : JSON.parse(fs.readFileSync('pi/config.json', 'utf8')).pin;
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
const timer = setTimeout(() => { ws.terminate(); process.exitCode = 1; }, 5000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', feed: true, pin })));
ws.on('error', () => { clearTimeout(timer); process.exitCode = 1; });
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.type !== 'hello') return;
  clearTimeout(timer);
  if (!m.ok) process.exitCode = 1;
  ws.close();
});
JS
say "authenticated feed hello passed"
stop_rehearsal "$pid" engine "$log"
pid=''
rm -f "$log"

if [ -n "$studio" ]; then
  port=0
  # Rehearse against disposable data with no feed to the running engine.
  "$node" --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module \
    - "$stage/studio.env" "$stage/data" "$port" >"$data/self-test.log" 2>&1 <<'JS' &
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [file, data, port] = process.argv.slice(2);
Object.assign(process.env, parseEnv(fs.readFileSync(file, 'utf8')), {
  HOST: '127.0.0.1', PORT: port, STUDIO_DATA: data, STUDIO_MODELS: `${data}/models.json`, PI_PREVIEW_URL: '',
});
await import(pathToFileURL(path.resolve('server.ts')).href);
JS
  spid=$!
  port=$(rehearsal_port "$spid" "$data/self-test.log" 'Folly Studio on') \
    || die "the staged Studio did not bind its rehearsal port (see $data/self-test.log)"
  wait_http "http://127.0.0.1:$port/" "$spid" || die "the staged Studio did not answer (see $data/self-test.log)"
  stop_rehearsal "$spid" Studio "$data/self-test.log"
  spid=''
  say "Studio answers on :$port"
fi

# Activate only after the staged tree has passed. Keep rollback material until checks pass.
if [ -n "$units" ]; then
  for unit in studio-live folly-studio; do
    [ ! -f "/etc/systemd/system/$unit.service" ] || cp -p "/etc/systemd/system/$unit.service" "$stage/"
  done
fi
cd "$home"
if [ -d "$app" ]; then
  old=$(mktemp -d "$app.old-$(date +%Y%m%d-%H%M%S)-XXXXXX")
  rmdir "$old"
  mv "$app" "$old"
fi
swapped=1
mv "$stage/tree" "$app"
cd "$app"
[ -z "$studio" ] || cp -p "$stage/studio.env" "$env"
if [ -n "$units" ]; then
  sudo cp pi/studio-live.service /etc/systemd/system/
  [ -z "$studio" ] || sudo cp pi/folly-studio.service /etc/systemd/system/
  sudo systemctl daemon-reload
  if [ -n "$studio" ]; then
    sudo systemctl disable folly-studio >/dev/null 2>&1
    sudo systemctl restart folly-studio
    port=$("$node" -p 'require("node:util").parseEnv(require("fs").readFileSync(process.argv[1], "utf8")).PORT || 8780' "$env")
    wait_http "http://127.0.0.1:$port/" || die "Studio did not answer after activation"
    systemctl is-active --quiet folly-studio || die "Studio stopped after activation"
  fi
  if [ -n "$live_active" ]; then
    sudo systemctl restart studio-live
    port=$("$node" -p 'JSON.parse(require("fs").readFileSync("pi/config.json", "utf8")).http ?? 4043')
    [ "$port" = 0 ] || wait_http "http://127.0.0.1:$port/" || die "engine did not answer after activation"
    systemctl is-active --quiet studio-live || die "engine stopped after activation"
  fi
else
  say "no systemd units (--no-units)"
fi
[ -z "$old" ] || say "the previous install is kept at $old"

ip=$(hostname -I 2>/dev/null | cut -d' ' -f1)
say "done. The engine's page: http://${ip:-<the Pi>}:4043/ once the ops hub starts studio-live"
[ -z "$studio" ] || say "Studio: http://${ip:-<the Pi>}:8780/ (sign up as $admin first), the engine at /pi/ there"
committed=1
