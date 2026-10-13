#!/bin/sh
# Restore only the Worker; leave frontend and the 204 fix unchanged.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:?Usage: ROLLBACK.sh /path/to/project-copy}
[ -d "$TARGET" ] || { echo "Missing target directory" >&2; exit 2; }
cp "$HERE/BaselineWorker.js" "$TARGET/worker.js"
printf '%s\n' 'ROLLBACK restored uploaded MinimalFix worker.js'
