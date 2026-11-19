#!/usr/bin/env bash
#
# Fügt der RELAY-Site in der Caddyfile die HTTP-Kompression (encode) hinzu.
#
# Sicherheit: idempotent, Backup vor der Änderung, Validierung mit
# "caddy validate" und automatischer Rollback bei Validierungs-/Reload-Fehlern.
# Die App schützt ihre Streaming-Endpunkte bereits selbst (SSE sendet
# "Cache-Control: no-transform", die Vorschau ist video/mp2t), daher reicht
# eine einzige "encode"-Zeile ohne weitere Sonderbehandlung.
#
# Nutzung:
#   sudo scripts/add-caddy-compression.sh            # anwenden + caddy neu laden/starten
#   sudo scripts/add-caddy-compression.sh --dry-run  # nur Diff + Validierung zeigen
#
# Konfigurierbar über Umgebungsvariablen:
#   CADDYFILE   (Default: /etc/caddy/Caddyfile)
#   SITE        (Default: relay.positronium.dev)
#   SERVICE     (Default: caddy)
#   ENCODE_LINE (Default: "encode zstd gzip")

set -euo pipefail

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
SITE="${SITE:-relay.positronium.dev}"
SERVICE="${SERVICE:-caddy}"
ENCODE_LINE="${ENCODE_LINE:-encode zstd gzip}"
DRY_RUN=0

usage() {
  sed -n '2,20p' "$0"
}

for arg in "$@"; do
  case "$arg" in
    --dry-run | -n) DRY_RUN=1 ;;
    --help | -h) usage; exit 0 ;;
    *) echo "Unbekannte Option: $arg (siehe --help)" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;32m[caddy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[caddy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[caddy]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Bitte mit sudo ausführen (root erforderlich)."
[ -f "$CADDYFILE" ] || fail "Caddyfile nicht gefunden: $CADDYFILE"
command -v caddy >/dev/null 2>&1 || fail "caddy-Binary nicht gefunden."

# Idempotenz: encode-Direktive bereits vorhanden?
if grep -qE '^[[:space:]]*encode([[:space:]]|$)' "$CADDYFILE"; then
  log "encode ist bereits konfiguriert – keine Änderung nötig."
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Öffnungszeile der Site finden (enthält den Site-Namen, ist kein Kommentar und
# endet mit "{") und direkt darunter – mit passender Einrückung – die
# encode-Zeile einfügen.
awk -v site="$SITE" -v line="$ENCODE_LINE" '
  BEGIN { done = 0 }
  {
    print
    if (!done && $0 !~ /^[[:space:]]*#/ && index($0, site) > 0 && $0 ~ /\{[[:space:]]*$/) {
      match($0, /^[[:space:]]*/)
      indent = substr($0, RSTART, RLENGTH)
      print indent "    " line
      done = 1
    }
  }
  END { if (!done) exit 3 }
' "$CADDYFILE" > "$TMP" || fail "Site-Block '$SITE' nicht gefunden – SITE ggf. per Umgebungsvariable anpassen."

if [ "$DRY_RUN" = 1 ]; then
  log "Dry-run: geplante Änderung (Datei wird NICHT verändert):"
  diff -u "$CADDYFILE" "$TMP" || true
  if caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1; then
    log "Validierung OK."
  else
    warn "Validierung der temporären Datei fehlgeschlagen."
  fi
  exit 0
fi

# Neue Konfiguration zunächst anhand der temporären Datei validieren.
if ! caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1; then
  fail "caddy validate fehlgeschlagen – es wurde nichts geändert."
fi

# Backup anlegen und anwenden (in-place, erhält Rechte/Owner).
BACKUP="$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$CADDYFILE" "$BACKUP"
log "Backup: $BACKUP"

cat "$TMP" > "$CADDYFILE"
rm -f "$TMP"

# Caddy neu laden (reload-or-restart: lädt graceful, fällt bei Units ohne
# ExecReload automatisch auf restart zurück); bei Fehler Rollback.
if ! systemctl reload-or-restart "$SERVICE"; then
  warn "systemctl reload-or-restart $SERVICE fehlgeschlagen – stelle Backup wieder her."
  cat "$BACKUP" > "$CADDYFILE"
  systemctl reload-or-restart "$SERVICE" >/dev/null 2>&1 || true
  fail "Rollback durchgeführt. Bitte Log prüfen (journalctl -u $SERVICE)."
fi

log "Kompression ($ENCODE_LINE) hinzugefügt und $SERVICE neu geladen/gestartet."
log "Backup: $BACKUP"
