#!/usr/bin/env bash
# The daily backup, run by the <unit>-backup timer deploy/host.sh writes (docs/HOSTING.md "Backups"), from the live
# release: a .tar.gz of STUDIO_DATA's JSON files in STUDIO_BACKUP_DIR (both set by the unit), the newest
# STUDIO_BACKUP_KEEP (default 14) kept there, then the new one copied to STUDIO_BACKUP_OFFSITE when that is set,
# with rsync (a path, or host:path over ssh with a key). Any failure exits non-zero: the unit fails, and its journal
# says why.
set -euo pipefail

: "${STUDIO_DATA:?set by the unit}" "${STUDIO_BACKUP_DIR:?set by the unit}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
out=$(node tools/backup.ts --data "$STUDIO_DATA" --out "$STUDIO_BACKUP_DIR" --keep "${STUDIO_BACKUP_KEEP:-14}")
printf '%s\n' "$out"
# The first line is "<archive>: <n> files, <size> KB".
line=${out%%$'\n'*}
file=${line%: * files, * KB}
[ -f "$file" ] || { echo "backup: no archive named in: $line" >&2; exit 1; }
if [ -n "${STUDIO_BACKUP_OFFSITE:-}" ]; then
  rsync --times --timeout=600 --rsh='ssh -o BatchMode=yes' -- "$file" "${STUDIO_BACKUP_OFFSITE%/}/"
  echo "backup: copied to $STUDIO_BACKUP_OFFSITE"
fi
