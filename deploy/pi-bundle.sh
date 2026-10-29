#!/usr/bin/env bash
# Make the Pi's offline bundle (pi/SETUP.md): one tarball holding a commit (default HEAD) as files, its built app
# (dist/ with dist/build.json), node_modules for the Pi (sharp's native build for 64- and 32-bit ARM, and x64 for a
# rehearsal here) so pi/install.sh installs the engine, or Studio with it, with no internet.
# It builds in a temporary worktree and leaves this checkout as it is. Run it online (npm ci).
#
#   npm run pi:bundle [-- [<ref>] [--out FILE]]     # default: HEAD, folly-studio-pi.tgz here
set -euo pipefail

die() { echo "pi-bundle: $*" >&2; exit 1; }
ref=HEAD out=$PWD/folly-studio-pi.tgz
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$(realpath -m "$2"); shift 2 ;;
    -*) die "unknown option $1" ;;
    *) ref=$1; shift ;;
  esac
done
root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
commit=$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}") || die "no commit $ref"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/folly-pi-bundle.XXXXXX")
trap 'git -C "$root" worktree remove --force "$tmp/build" 2>/dev/null; rm -rf "$tmp"' EXIT
git -C "$root" worktree add --quiet --detach "$tmp/build" "$commit"

echo "pi-bundle: building ${commit:0:12} ($ref)"
cd "$tmp/build"
npm ci --no-audit --no-fund --loglevel=error
npm run --silent build >/dev/null
printf '{ "commit": "%s", "builtAt": "%s" }\n' "$commit" "$(date -u +%FT%TZ)" > dist/build.json

# The files as committed, the built app, and what the Pi runs: production modules, sharp's native build per arch.
dest=$tmp/folly-studio
git archive "$commit" | (mkdir -p "$dest" && tar -x -C "$dest")
cp -r dist "$dest/"
for cpu in arm64 arm x64; do
  rm -rf "$tmp/mods" && mkdir "$tmp/mods" && cp package.json package-lock.json "$tmp/mods/"
  (cd "$tmp/mods" && npm ci --omit=dev --ignore-scripts --os=linux --cpu=$cpu --libc=glibc \
    --no-audit --no-fund --loglevel=error)
  [ -d "$dest/node_modules" ] || cp -r "$tmp/mods/node_modules" "$dest/"
  cp -r "$tmp/mods/node_modules/@img/sharp-linux-$cpu" "$tmp/mods/node_modules/@img/sharp-libvips-linux-$cpu" \
    "$dest/node_modules/@img/"
done
rm -rf "$dest"/node_modules/@img/sharp-linuxmusl-* "$dest"/node_modules/@img/sharp-libvips-linuxmusl-*

mkdir -p "$(dirname "$out")"
tar -czf "$out" -C "$tmp" folly-studio
cp "$dest/pi/install.sh" "$(dirname "$out")/install.sh"
echo "pi-bundle: $out ($(du -h "$out" | cut -f1)), the build of ${commit:0:12}; install.sh beside it"
