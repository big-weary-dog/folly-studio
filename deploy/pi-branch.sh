#!/usr/bin/env bash
# Make the `pi` branch (pi/STUDIO.md): a commit (default origin/prod) plus one commit holding the built app, dist/
# with dist/build.json, so the FPP Pi runs Studio with no build of its own. It builds in a temporary worktree and
# leaves this checkout as it is.
#
#   npm run pi:branch [-- [--no-push] [<ref>]]
#
#   --no-push   stop before the push: print the commit made, and keep nothing else
#   PI_REMOTE   the remote to push to, default origin
set -euo pipefail

die() { echo "pi-branch: $*" >&2; exit 1; }
push=1
if [ "${1:-}" = --no-push ]; then push=; shift; fi
ref=${1:-origin/prod}
remote=${PI_REMOTE:-origin}
root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)

git -C "$root" fetch --quiet "$remote"
commit=$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}") || die "no $ref in $remote"
work=$(mktemp -d "${TMPDIR:-/tmp}/folly-pi-branch.XXXXXX")
trap 'git -C "$root" worktree remove --force "$work" 2>/dev/null || rm -rf "$work"' EXIT
git -C "$root" worktree add --quiet --detach "$work" "$commit"

cd "$work"
echo "pi-branch: building ${commit:0:12} ($ref)"
npm ci --no-audit --no-fund --loglevel=error
npm run --silent build >/dev/null
# What the Pi's open pages ask for to notice an update (SPEC "Updates"), as npm run host writes it.
printf '{ "commit": "%s", "builtAt": "%s" }\n' "$commit" "$(date -u +%FT%TZ)" > dist/build.json
git add --force dist
git commit --quiet --no-verify -m "Pi build of ${commit:0:12} ($ref): dist/ for STUDIO_PROFILE=pi (pi/STUDIO.md)"
made=$(git rev-parse HEAD)
if [ -z "$push" ]; then echo "pi-branch: made $made (not pushed)"; exit 0; fi
# Made afresh from the ref each time, so the Pi resets to it (pi/STUDIO.md "Updating").
git push --quiet --force "$remote" "$made:refs/heads/pi"
echo "pi-branch: $remote/pi is $made, the build of ${commit:0:12}"
