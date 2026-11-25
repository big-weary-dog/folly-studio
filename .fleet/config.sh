# fleet overrides: dev is the integration branch; prod is what the public server runs.
FLEET_BASE=dev
FLEET_PROTECTED=prod
# The train's gate: the repo's full check. TMPDIR on disk: /tmp is a quota'd tmpfs that the backup test can exhaust.
FLEET_GATE='mkdir -p "$HOME/.cache/folly-tmp" && npm ci --no-audit --no-fund && TMPDIR="$HOME/.cache/folly-tmp" heavy npm run check'
