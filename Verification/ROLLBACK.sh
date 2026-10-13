#!/bin/sh
# Restore the pre-fix script in a project copy. Other files are not touched.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:?Usage: ROLLBACK.sh /path/to/project-copy}
[ -d "$TARGET" ] || { echo "Target directory does not exist" >&2; exit 2; }
cp "$HERE/Baseline/script.js" "$TARGET/script.js"
printf '%s\n' 'ROLLBACK restored pristine script.js'
