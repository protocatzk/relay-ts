#!/usr/bin/env bash
#
# RELAY – nativer Deploy (systemd)
#
# Baut aus einem Git-Tag ein sauberes Release in /srv/relay/releases/<version>,
# wechselt den "current"-Symlink atomar und startet den systemd-Dienst neu.
# Bei fehlgeschlagenem Health-Check wird automatisch auf die vorherige
# Version zurückgerollt.
#
# Nutzung:
#   sudo scripts/deploy.sh [VERSION]      # z. B. 0.8.0 oder v0.8.0 (Default: Version aus package.json)
#   sudo scripts/deploy.sh --rollback     # auf die vorherige Version zurück
#
# Voraussetzungen: Root, Git-Tag vorhanden (ggf. vorher "git fetch --tags").
set -euo pipefail

export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=/srv/relay
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
SERVICE=relay
HEALTH_URL="http://127.0.0.1:3000/health"
KEEP=3
HEALTH_RETRIES=10
HEALTH_DELAY=2

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Als root ausführen: sudo $0 $*"
[ -d "$RELEASES" ] || fail "Layout nicht vorhanden: $RELEASES (Migration nötig)"

health_ok() {
  curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1
}

wait_healthy() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if health_ok && [ "$(systemctl is-active "$SERVICE")" = "active" ]; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

# Versionen nach semantischer Reihenfolge auflisten (absteigend).
list_versions() {
  ls -1 "$RELEASES" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -Vr
}

current_version() {
  local t
  t="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  [ -n "$t" ] && basename "$t"
}

# --- Rollback -----------------------------------------------------------------
if [ "${1:-}" = "--rollback" ]; then
  cur="$(current_version)"
  prev="$(list_versions | awk -v c="$cur" '$0 != c { print; exit }')"
  [ -n "$prev" ] || fail "Keine frühere Version zum Zurückrollen gefunden."
  log "Rollback: $cur -> $prev"
  ln -sfn "releases/$prev" "$CURRENT"
  systemctl restart "$SERVICE"
  if wait_healthy; then
    log "Rollback erfolgreich, Dienst läuft auf $prev."
  else
    fail "Rollback auf $prev fehlgeschlagen (Health-Check schlug fehl)."
  fi
  exit 0
fi

# --- Version bestimmen --------------------------------------------------------
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('$REPO_DIR/package.json').version")"
  log "Keine Version angegeben – verwende package.json: $VERSION"
fi
VERSION="${VERSION#v}"

REF="v$VERSION"
if ! git -C "$REPO_DIR" rev-parse --verify --quiet "$REF^{commit}" >/dev/null 2>&1; then
  # Fallback: VERSION ohne v-Präfix als Ref, sonst HEAD
  if git -C "$REPO_DIR" rev-parse --verify --quiet "$VERSION^{commit}" >/dev/null 2>&1; then
    REF="$VERSION"
  elif [ -z "${1:-}" ]; then
    REF="HEAD"
    warn "Tag v$VERSION nicht gefunden – deploye HEAD (ohne Tag)."
  else
    fail "Ref für '$1' nicht gefunden. Vorher: git fetch --tags"
  fi
fi

REL="$RELEASES/$VERSION"
[ -e "$REL" ] && fail "Release-Verzeichnis existiert bereits: $REL (kein Überschreiben)."
prev="$(current_version)"

# --- Build in frischem Release-Verzeichnis ------------------------------------
log "Baue Release $VERSION aus $REF ..."
mkdir -p "$REL"
git -C "$REPO_DIR" archive "$REF" | tar -x -C "$REL"
(
  cd "$REL"
  npm ci --no-audit --no-fund
  npm run build
  npm prune --omit=dev
)
chown -R root:root "$REL"
chmod -R u=rwX,go=rX "$REL"
log "Build abgeschlossen: $REL"

# --- Aktivieren + Health-Check ------------------------------------------------
log "Aktiviere $VERSION (vorher: ${prev:-keine}) ..."
ln -sfn "releases/$VERSION" "$CURRENT"
systemctl restart "$SERVICE"

if wait_healthy; then
  log "Deploy erfolgreich: $VERSION ist aktiv."
else
  warn "Health-Check fehlgeschlagen – Rolle zurück auf ${prev:-keine Version}."
  if [ -n "$prev" ]; then
    ln -sfn "releases/$prev" "$CURRENT"
    systemctl restart "$SERVICE"
    wait_healthy || warn "Auch Rollback auf $prev ist nicht gesund – manuell prüfen!"
  fi
  fail "Deploy fehlgeschlagen; auf $prev zurückgerollt."
fi

# --- Alte Releases aufräumen --------------------------------------------------
if [ "$(list_versions | wc -l)" -gt "$KEEP" ]; then
  log "Räume alte Releases auf (behalte die letzten $KEEP) ..."
  list_versions | tail -n "+$((KEEP + 1))" | while read -r old; do
    if [ "$old" = "$VERSION" ] || [ "$old" = "$prev" ]; then
      continue
    fi
    warn "Entferne altes Release: $old"
    rm -rf "$RELEASES/$old"
  done
fi

log "Fertig. Aktive Version: $(current_version)"
