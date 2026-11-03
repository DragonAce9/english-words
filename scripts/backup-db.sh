#!/usr/bin/env bash
# Copy the live Postgres database out of the Docker volume.
# A container crash keeps the volume; this file survives a Docker reset.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${BACKUP_DIR:-$HOME/Backups/english-words}"
mkdir -p "$dest"

stamp="$(date +%Y%m%d-%H%M%S)"
file="$dest/english-$stamp.dump"

if ! docker compose -f "$root/docker-compose.yml" exec -T postgres \
  pg_dump -U english -d english --format=custom --no-owner --no-acl >"$file"; then
  rm -f "$file"
  echo "backup failed" >&2
  exit 1
fi

if [[ ! -s "$file" ]]; then
  rm -f "$file"
  echo "backup file is empty" >&2
  exit 1
fi

ls -1t "$dest"/english-*.dump | awk 'NR>14' | while read -r old; do
  rm -f "$old"
done

echo "$file ($(du -h "$file" | awk '{print $1}'))"
