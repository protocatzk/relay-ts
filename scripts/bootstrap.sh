#!/usr/bin/env bash
#
# RELAY – initiales Setup des systemd-Deploy-Pfads (Bootstrap)
#
# Legt auf einem frischen Host das komplette native Layout an:
# relay-Systemuser, /srv/relay/{releases,config,data,logs}, systemd-Dienst,
# /etc/relay.env (0600, absolute Pfade) und das erste Release via deploy.sh.
# Jede Station prüft, ob sie bereits vorhanden ist, und überschreibt nichts
# ohne --force (nur /etc/relay.env; Release-Verzeichnisse regelt deploy.sh).
#
# Nutzung:
#   sudo scripts/bootstrap.sh                     # Setup + Initial-Deploy (Version aus package.json)
#   sudo scripts/bootstrap.sh 0.31.14             # Setup + Initial-Deploy fester Version
#   sudo scripts/bootstrap.sh --caddy             # zusätzlich minimale Caddyfile anlegen
#   sudo scripts/bootstrap.sh --dry-run           # nur ausgeben, nichts ändern (auch ohne root)
#   sudo scripts/bootstrap.sh --force             # vorhandene /etc/relay.env überschreiben
#
# Voraussetzungen: root, Debian-artiger Host, Node unter /opt/node22
# (siehe systemd/relay.service ExecStart und deploy.sh PATH).
set -euo pipefail

export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=/srv/relay
RELEASES="$BASE/releases"
CONFIG_DIR="$BASE/config"
DATA_DIR="$BASE/data"
LOGS_DIR="$BASE/logs"
ENV_FILE=/etc/relay.env
SERVICE=relay
SERVICE_USER=relay
CADDYFILE=/etc/caddy/Caddyfile
DOMAIN=relay.positronium.dev
WEB_DOMAIN=web.positronium.dev

log()  { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

# --- Argumente -----------------------------------------------------------------
DRY_RUN=0
FORCE=0
CADDY=0
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --caddy) CADDY=1 ;;
    -*) fail "Unbekannte Option: $1" ;;
    *) [ -z "$VERSION" ] || fail "Zu viele Argumente: $1"; VERSION="$1" ;;
  esac
  shift
done

[ "$DRY_RUN" = 1 ] && warn "Dry-Run: nur Ausgabe, keine Änderungen."
if [ ! "$(id -u)" = 0 ] && [ "$DRY_RUN" != 1 ]; then
  fail "Als root ausführen: sudo $0 $*"
fi

command -v systemctl >/dev/null 2>&1 || fail "systemctl nicht gefunden – dieses Skript ist für den nativen systemd-Betrieb."
[ -x /opt/node22/bin/node ] || warn "Hinweis: /opt/node22/bin/node fehlt – deploy.sh und die Unit benötigen Node dort."

# --- 1. Systemuser und Verzeichnisse -------------------------------------------
if id -r "$SERVICE_USER" >/dev/null 2>&1; then
  log "Systemuser '$SERVICE_USER' existiert bereits."
else
  log "Lege Systemuser '$SERVICE_USER' an ..."
  run useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

for dir in "$RELEASES" "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR"; do
  if [ -d "$dir" ]; then
    log "Verzeichnis vorhanden: $dir"
  else
    log "Lege Verzeichnis an: $dir"
    run mkdir -p "$dir"
  fi
done
for sub in "$DATA_DIR/media" "$DATA_DIR/recordings" "$DATA_DIR/pause"; do
  [ -d "$sub" ] || run mkdir -p "$sub"
done

log "Setze Eigentümer relay:relay und Rechte (config 0750, data 0700, logs 0750) ..."
run chown -R "$SERVICE_USER:$SERVICE_USER" "$BASE"
[ "$DRY_RUN" = 1 ] || { chmod 0750 "$RELEASES" "$CONFIG_DIR" "$LOGS_DIR"; chmod 0700 "$DATA_DIR"; }

# --- 2. systemd-Dienst -----------------------------------------------------------
if [ ! -d "$REPO_DIR/systemd" ] || [ ! -f "$REPO_DIR/systemd/relay.service" ]; then
  fail "systemd/relay.service fehlt im Repo: $REPO_DIR"
fi
log "Installiere systemd-Unit nach /etc/systemd/system/relay.service ..."
run install -m 0644 "$REPO_DIR/systemd/relay.service" /etc/systemd/system/relay.service
run systemctl daemon-reload
if systemctl is-enabled "$SERVICE" >/dev/null 2>&1; then
  log "Dienst '$SERVICE' ist bereits enabled."
else
  log "Aktiviere Dienst '$SERVICE' (autostart, noch nicht gestartet) ..."
  run systemctl enable "$SERVICE"
fi

# --- 3. /etc/relay.env -----------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  if [ "$FORCE" = 1 ]; then
    warn "Überschreibe vorhandene $ENV_FILE (--force). Vorhandene Secrets gehen verloren!"
  else
    log "$ENV_FILE existiert bereits – lasse sie unangetastet (ggf. manuell prüfen)."
  fi
else
  FORCE=1
fi
if [ "$FORCE" = 1 ]; then
  log "Schreibe $ENV_FILE (0600) mit absoluten Pfaden ..."
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] cat > $ENV_FILE <<EOF"
    sed 's/^/  /' <<EOF
CONFIG_DIR=$CONFIG_DIR
DATA_DIR=$DATA_DIR
LOGS_DIR=$LOGS_DIR
STREAMERS_FILE=$CONFIG_DIR/streamers.yml
SETTINGS_FILE=$CONFIG_DIR/settings.yml
COOKIES_FILE=$DATA_DIR/cookies.txt
SECURE_COOKIES=true
TRUST_PROXY=true
EOF
  else
    umask 077
    cat > "$ENV_FILE" <<EOF
CONFIG_DIR=$CONFIG_DIR
DATA_DIR=$DATA_DIR
LOGS_DIR=$LOGS_DIR
STREAMERS_FILE=$CONFIG_DIR/streamers.yml
SETTINGS_FILE=$CONFIG_DIR/settings.yml
COOKIES_FILE=$DATA_DIR/cookies.txt
SECURE_COOKIES=true
TRUST_PROXY=true
EOF
    chown root:root "$ENV_FILE"
  fi
fi

# --- 4. Initial-Release ----------------------------------------------------------
installed=""
if [ -L "$BASE/current" ]; then
  installed="$(basename "$(readlink -f "$BASE/current" 2>/dev/null || true)")"
fi
if [ -n "$installed" ]; then
  log "Release bereits aktiv: $installed – überspringe Initial-Deploy."
  warn "Für neue Versionen: sudo scripts/deploy.sh <version>"
else
  log "Kein aktives Release – starte Initial-Deploy ..."
  if [ -n "$VERSION" ]; then
    run "$REPO_DIR/scripts/deploy.sh" "$VERSION"
  else
    log "Keine Version angegeben – deploy.sh nutzt package.json des Repos."
    run "$REPO_DIR/scripts/deploy.sh"
  fi
fi

# --- 5. Caddy (optional) ---------------------------------------------------------
if [ "$CADDY" = 1 ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    warn "Caddy ist nicht installiert – überspringe Caddyfile-Setup."
  elif [ -f "$CADDYFILE" ]; then
    warn "$CADDYFILE existiert bereits – lasse sie unangetastet. Benötigte Blöcke:"
    printf '  %s {\n    reverse_proxy 127.0.0.1:3000\n  }\n  %s {\n    reverse_proxy 127.0.0.1:3001\n  }\n' "$DOMAIN" "$WEB_DOMAIN"
  elif [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] cat > $CADDYFILE (Blöcke: $DOMAIN -> 127.0.0.1:3000, $WEB_DOMAIN -> 127.0.0.1:3001)"
  else
    log "Lege minimale $CADDYFILE an ..."
    umask 022
    cat > "$CADDYFILE" <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:3000
}

$WEB_DOMAIN {
  reverse_proxy 127.0.0.1:3001
}
EOF
    systemctl restart caddy
    log "Caddy neu gestartet (Let's-Encrypt-Zertifikate zieht Caddy beim ersten Abruf)."
  fi
fi

# --- 6. Abschluss ----------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  log "Dry-Run beendet – keine Änderungen durchgeführt."
  exit 0
fi

if systemctl is-active --quiet "$SERVICE"; then
  log "Dienst '$SERVICE' läuft. State: $(systemctl is-active "$SERVICE")"
else
  warn "Dienst läuft nicht. Prüfen: journalctl -u $SERVICE -n 50 --no-pager"
fi
log "Bootstrap abgeschlossen. Produktive Instanz: https://$DOMAIN/health"
