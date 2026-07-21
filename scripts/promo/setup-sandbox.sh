#!/usr/bin/env bash
# Builds a sandboxed data dir at .promo/data for recording the promo video.
# The real ./data is opened read-only and never modified.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SB="$ROOT/.promo/data"
KEEP_DOCS=(2 26 28 34)

if [ -f "$HOME/.config/margin-desktop/settings.json" ]; then
  echo "WARNING: ~/.config/margin-desktop/settings.json exists; a custom CLI path there overrides the claude PATH lookup." >&2
fi

rm -rf "$SB"
mkdir -p "$SB/uploaded_files/docs"

# The db is WAL-mode; .backup snapshots db+wal consistently.
sqlite3 "file:$ROOT/data/margin.db?mode=ro" ".backup '$SB/margin.db'"

KEEP_CSV=$(IFS=,; echo "${KEEP_DOCS[*]}")
sqlite3 "$SB/margin.db" <<SQL
PRAGMA foreign_keys = OFF;
DELETE FROM block WHERE page_id IN (SELECT id FROM page WHERE document_id NOT IN ($KEEP_CSV));
DELETE FROM page WHERE document_id NOT IN ($KEEP_CSV);
DELETE FROM chatmessage;
DELETE FROM chatthread;
DELETE FROM documentopen WHERE document_id NOT IN ($KEEP_CSV);
DELETE FROM ingestionerror;
DELETE FROM document WHERE id NOT IN ($KEEP_CSV);
DELETE FROM providerchoice;
INSERT INTO providerchoice (user_id, provider, model, effort) VALUES (2, 'claude', 'sonnet', 'low');
VACUUM;
SQL

for d in "${KEEP_DOCS[@]}"; do
  cp -r "$ROOT/data/uploaded_files/docs/$d" "$SB/uploaded_files/docs/"
done

echo "Sandbox ready at $SB"
sqlite3 "$SB/margin.db" "SELECT 'docs: ' || group_concat(id || '=' || title, ' | ') FROM document;"
sqlite3 "$SB/margin.db" "SELECT 'provider: ' || provider || '/' || model || '/' || effort FROM providerchoice;"
