#!/usr/bin/env bash
# Seed margin-desktop/data with a copy of the web app's database and files.
set -euo pipefail

SRC="${MARGIN_SRC:-$HOME/Projects/margin}"
DST="$(cd "$(dirname "$0")/.." && pwd)/data"

if [ -e "$DST/margin.db" ] && [ "${1:-}" != "--force" ]; then
  echo "data/margin.db already exists — pass --force to overwrite." >&2
  exit 1
fi

mkdir -p "$DST"

echo "Copying database…"
cp "$SRC/data/margin.db" "$DST/margin.db"
[ -f "$SRC/data/margin.db-wal" ] && cp "$SRC/data/margin.db-wal" "$DST/margin.db-wal"
[ -f "$SRC/data/margin.db-shm" ] && cp "$SRC/data/margin.db-shm" "$DST/margin.db-shm"
# Fold the copied WAL into the copy so it is self-contained. Never touches the source.
sqlite3 "$DST/margin.db" "PRAGMA wal_checkpoint(TRUNCATE);" > /dev/null

echo "Copying uploaded files ($(du -sh "$SRC/uploaded_files" | cut -f1))…"
rm -rf "$DST/uploaded_files"
cp -r --reflink=auto "$SRC/uploaded_files" "$DST/uploaded_files"

echo "Done: $(sqlite3 "$DST/margin.db" 'select count(*) from document;') documents seeded."
