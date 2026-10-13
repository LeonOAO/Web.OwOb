#!/bin/sh
# Restore the two files changed by SameOriginRootFix; keep all other files intact.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:?Usage: ROLLBACK.sh /path/to/project-copy}
[ -d "$TARGET" ] || { echo "Target directory does not exist" >&2; exit 2; }
for FILE in script.js worker.js; do
    cp "$HERE/Baseline/$FILE" "$TARGET/$FILE"
done
printf '%s\n' 'ROLLBACK restored MinimalFix script.js and worker.js'
