#!/usr/bin/env bash
# npm run check:fast [base]: a pre-check while iterating, never the gate (npm run check is). Types and lint as the
# gate runs them, then only the tests Vitest finds importing what changed since base (origin/dev by default). Tests
# that read the library, the looks or the rig from disk name no import of them, so a change there adds those.
set -euo pipefail
base=${1:-origin/dev}
npm run typecheck
npm run lint
npx vitest run --changed "$base" --passWithNoTests
changed=$({ git diff --name-only "$(git merge-base "$base" HEAD)"; git ls-files --others --exclude-standard; })
if grep -qE '^(public/patterns|public/data)/' <<<"$changed"; then
  npx vitest run test/patterns.test.js test/library test/presets.test.ts test/output-bytes
fi
