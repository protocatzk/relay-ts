#!/usr/bin/env bash
set -euo pipefail

root="${RELAY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
stamp="$(date +%Y%m%d-%H%M%S)"
dest="${1:-$root/backups/relay-$stamp.tar.gz}"

for dir in config data; do
  if [[ ! -d "$root/$dir" ]]; then
    echo "Fehlt: $root/$dir" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$dest")"
umask 077

# Sessions and the active overlay scratch files are runtime state and are not
# part of a portable backup. Secrets are never printed by this script.
tar \
  --exclude='data/sessions.json' \
  --exclude='data/overlays/active' \
  -czf "$dest" \
  -C "$root" \
  config data

chmod 600 "$dest"
printf 'Backup: %s (%s)\n' "$dest" "$(du -h "$dest" | cut -f1)"
