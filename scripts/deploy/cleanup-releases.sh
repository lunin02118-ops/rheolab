#!/bin/bash
# Keeps the last KEEP release versions, deletes older ones.
ARTIFACTS_DIR="/var/www/license-server/releases/artifacts"
KEEP=5

mapfile -t VERSIONS < <(ls -d "$ARTIFACTS_DIR"/*/  2>/dev/null | sort -V)
TOTAL=${#VERSIONS[@]}

if [ "$TOTAL" -le "$KEEP" ]; then
    echo "[cleanup] $TOTAL versions present, nothing to delete (limit: $KEEP)"
    exit 0
fi

DELETE_COUNT=$(( TOTAL - KEEP ))
echo "[cleanup] Total: $TOTAL, keeping: $KEEP, deleting: $DELETE_COUNT"

for (( i=0; i<DELETE_COUNT; i++ )); do
    DIR="${VERSIONS[$i]}"
    echo "[cleanup] Removing: $DIR"
    rm -rf "$DIR"
done

echo "[cleanup] Done. Releases size: $(du -sh $ARTIFACTS_DIR | cut -f1)"
