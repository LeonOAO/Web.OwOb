#!/bin/sh
# Restore only files changed by this fix. Keep unrelated user data untouched.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:?Usage: ROLLBACK.sh /path/to/project-copy}
[ -d "$TARGET" ] || { echo "Target directory does not exist" >&2; exit 2; }
for FILE in script.js worker.js index.html; do
    cp "$HERE/Baseline/$FILE" "$TARGET/$FILE"
done
rm -f "$TARGET/Assets/acorn.js" "$TARGET/Assets/AcornLicense.txt"
printf '%s\n' 'ROLLBACK restored script.js, worker.js, index.html; removed added parser assets'
