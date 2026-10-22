#!/usr/bin/env bash
# Make the Pi's offline bundle (pi/SETUP.md): one tarball holding a commit (default HEAD) as files, its built app
# (dist/ with dist/build.json), node_modules for the Pi (sharp's native build for 64- and 32-bit ARM, and x64 for a
# rehearsal here) and bubblewrap's .debs, so pi/install.sh installs the engine, or Studio with it, with no internet.
# It builds in a temporary worktree and leaves this checkout as it is. Run it at home, online.
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

# bubblewrap for the render box (bakes), Debian's own builds, held to their hashes: bookworm and trixie, both ARMs.
mkdir -p "$dest/pi/debs"
while read -r sum deb; do
  curl -sSf -o "$dest/pi/debs/$deb" "https://deb.debian.org/debian/pool/main/b/bubblewrap/$deb"
  echo "$sum  $dest/pi/debs/$deb" | sha256sum -c --quiet - || die "$deb is not the one pinned"
done <<'EOF'
d044ba1d7961d835669035fcd1e11121f1dc960a1a2e1c6489a93ea44e083557 bubblewrap_0.8.0-2+deb12u1_arm64.deb
f84a01837499f96027fe846e22b65fa8ee238170c3ba68a15a175f0faa2bda8f bubblewrap_0.8.0-2+deb12u1_armhf.deb
d1ac1d0d81c815fc15842b9f04fdf414830ed14a0a602bf6344740f90bb36c00 bubblewrap_0.12.0-1~deb13u1_arm64.deb
e0c09b03161b8251a8d00a21f3a947575a44232a633a468f0037ba3f98933021 bubblewrap_0.12.0-1~deb13u1_armhf.deb
EOF

tar -czf "$out" -C "$tmp" folly-studio
cp "$dest/pi/install.sh" "$(dirname "$out")/install.sh"
echo "pi-bundle: $out ($(du -h "$out" | cut -f1)), the build of ${commit:0:12}; install.sh beside it"
