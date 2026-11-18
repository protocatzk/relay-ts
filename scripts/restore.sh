#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Verwendung: scripts/restore.sh <backup.tar.gz> [--force]" >&2
  exit 1
}

archive="${1:-}"
[[ -n "$archive" ]] || usage
shift || true
force=0
if [[ "${1:-}" == "--force" ]]; then
  force=1
fi

[[ -f "$archive" ]] || {
  echo "Archiv nicht gefunden: $archive" >&2
  exit 1
}

root="${RELAY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
entries="$(tar -tzf "$archive")"

if printf '%s\n' "$entries" | grep -Eq '(^/|(^|/)\.\./)'; then
  echo "Archiv enthält unsichere Pfade." >&2
  exit 1
fi

tops="$(printf '%s\n' "$entries" | cut -d/ -f1 | sort -u)"
while IFS= read -r top; do
  [[ -z "$top" ]] && continue
  if [[ "$top" != "config" && "$top" != "data" ]]; then
    echo "Unerwarteter Pfad im Archiv: $top" >&2
    exit 1
  fi
done <<<"$tops"

if [[ "$force" -eq 0 ]]; then
  for dir in config data; do
    if [[ -d "$root/$dir" ]] && [[ -n "$(ls -A "$root/$dir" 2>/dev/null)" ]]; then
      echo "Ziel ist nicht leer: $root/$dir"
      read -r -p "Vorhandene Dateien überschreiben? [y/N] " answer
      [[ "$answer" == "y" || "$answer" == "Y" ]] || {
        echo "Abgebrochen."
        exit 1
      }
      break
    fi
  done
fi

tar -xzf "$archive" -C "$root"
if [[ -f "$root/config/settings.yml" ]]; then
  chmod 600 "$root/config/settings.yml"
fi
printf 'Wiederhergestellt aus %s nach %s\n' "$archive" "$root"
echo "Hinweis: Enthaltene Stream-Keys und Zugangsdaten bleiben vertraulich."
