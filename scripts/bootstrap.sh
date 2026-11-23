#!/usr/bin/env bash
#
# RELAY – modulares Bootstrap des systemd-Deploy-Pfads
#
# Richtet einen frischen Host ein, Station für Station (Module):
#   user     – Systemuser 'relay' anlegen
#   dirs     – /srv/relay/{releases,config,data,logs} anlegen (relay:relay)
#   systemd  – relay.service installieren, daemon-reload, enable (ohne Start)
#   env      – /etc/relay.env aus Vorlage (0600, absolute Pfade)
#   release  – erstes Release via deploy.sh inkl. Health-Check
#   caddy    – minimale Caddyfile (benötigt --domain, optional --web-domain)
#
# Das Skript ist generisch gehalten: Domain (und optional Web-Domain) werden
# als Parameter übergeben, nichts ist auf eine konkrete Instanz festgelegt.
# Jedes Modul prüft, ob es bereits ausgeführt wurde – erneuter Aufruf ändert
# nichts. /etc/relay.env wird ohne --force nie überschrieben.
#
# Nutzung:
#   sudo scripts/bootstrap.sh                                # alle Module außer caddy
#   sudo scripts/bootstrap.sh 0.31.14                        # + feste Release-Version
#   sudo scripts/bootstrap.sh --domain stream.example.com --caddy
#   sudo scripts/bootstrap.sh --modules user,dirs,systemd    # nur ausgewählte Module
#   sudo scripts/bootstrap.sh --dry-run                      # Vorschau, auch ohne root
#   sudo scripts/bootstrap.sh --force                        # vorhandene /etc/relay.env ersetzen
#
# Voraussetzungen: root (außer --dry-run), Debian-artiger Host,
# Node unter /opt/node22 (siehe systemd/relay.service und deploy.sh PATH).
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
APP_PORT=3000
WEB_PORT=3001
ALL_MODULES="user,dirs,systemd,env,release,caddy"
DEFAULT_MODULES="user,dirs,systemd,env,release"

log()  { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

DRY_RUN=0
run() {
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

# --- Argumente -----------------------------------------------------------------
FORCE=0
DOMAIN=""
WEB_DOMAIN=""
MODULES="$DEFAULT_MODULES"
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --caddy) case ",$MODULES," in *,caddy,*) ;; *) MODULES="$MODULES,caddy" ;; esac ;;
    --domain) shift; [ $# -gt 0 ] || fail "--domain braucht einen Wert"; DOMAIN="$1" ;;
    --web-domain) shift; [ $# -gt 0 ] || fail "--web-domain braucht einen Wert"; WEB_DOMAIN="$1" ;;
    --modules) shift; [ $# -gt 0 ] || fail "--modules braucht eine Liste"; MODULES="$1" ;;
    -*) fail "Unbekannte Option: $1 (Module: $ALL_MODULES)" ;;
    *) [ -z "$VERSION" ] || fail "Zu viele Argumente: $1"; VERSION="$1" ;;
  esac
  shift
done

has_module() {
  case ",$MODULES," in *,"$1",*) return 0 ;; *) return 1 ;; esac
}

for m in ${MODULES//,/ }; do
  case ",$ALL_MODULES," in *,"$m",*) ;; *) fail "Unbekanntes Modul: $m (verfügbar: $ALL_MODULES)" ;; esac
done
if has_module caddy && [ -z "$DOMAIN" ]; then
  fail "Modul 'caddy' benötigt --domain <domain>."
fi

[ "$DRY_RUN" = 1 ] && warn "Dry-Run: nur Ausgabe, keine Änderungen."
if [ ! "$(id -u)" = 0 ] && [ "$DRY_RUN" != 1 ]; then
  fail "Als root ausführen: sudo $0 $*"
fi

command -v systemctl >/dev/null 2>&1 || fail "systemctl nicht gefunden – dieses Skript ist für den nativen systemd-Betrieb."
[ -x /opt/node22/bin/node ] || warn "Hinweis: /opt/node22/bin/node fehlt – deploy.sh und die Unit benötigen Node dort."

# --- Modul: user ---------------------------------------------------------------
setup_user() {
  if id -r "$SERVICE_USER" >/dev/null 2>&1; then
    log "[user] Systemuser '$SERVICE_USER' existiert bereits."
  else
    log "[user] Lege Systemuser '$SERVICE_USER' an ..."
    run useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

# --- Modul: dirs ---------------------------------------------------------------
setup_dirs() {
  for dir in "$RELEASES" "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR"; do
    if [ -d "$dir" ]; then
      log "[dirs] Verzeichnis vorhanden: $dir"
    else
      log "[dirs] Lege Verzeichnis an: $dir"
      run mkdir -p "$dir"
    fi
  done
  for sub in "$DATA_DIR/media" "$DATA_DIR/recordings" "$DATA_DIR/pause"; do
    [ -d "$sub" ] || run mkdir -p "$sub"
  done
  log "[dirs] Setze Eigentümer relay:relay und Rechte ..."
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$BASE"
  [ "$DRY_RUN" = 1 ] || { chmod 0750 "$RELEASES" "$CONFIG_DIR" "$LOGS_DIR"; chmod 0700 "$DATA_DIR"; }
}

# --- Modul: systemd -------------------------------------------------------------
setup_systemd() {
  if [ ! -f "$REPO_DIR/systemd/relay.service" ]; then
    fail "[systemd] relay.service fehlt im Repo: $REPO_DIR/systemd"
  fi
  log "[systemd] Installiere Unit nach /etc/systemd/system/relay.service ..."
  run install -m 0644 "$REPO_DIR/systemd/relay.service" /etc/systemd/system/relay.service
  run systemctl daemon-reload
  if systemctl is-enabled "$SERVICE" >/dev/null 2>&1; then
    log "[systemd] Dienst '$SERVICE' ist bereits enabled."
  else
    log "[systemd] Aktiviere Dienst '$SERVICE' (autostart, noch nicht gestartet) ..."
    run systemctl enable "$SERVICE"
  fi
}

# --- Modul: env -----------------------------------------------------------------
setup_env() {
  local write=0
  if [ -f "$ENV_FILE" ]; then
    if [ "$FORCE" = 1 ]; then
      warn "[env] Überschreibe vorhandene $ENV_FILE (--force). Vorhandene Secrets gehen verloren!"
      write=1
    else
      log "[env] $ENV_FILE existiert bereits – lasse sie unangetastet (ggf. manuell prüfen)."
    fi
  else
    write=1
  fi
  [ "$write" = 1 ] || return 0

  log "[env] Schreibe $ENV_FILE (0600) mit absoluten Pfaden ..."
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] cat > $ENV_FILE <<EOF"
    sed 's/^/  /' <<EOF
CONFIG_DIR=$CONFIG_DIR
DATA_DIR=$DATA_DIR
LOGS_DIR=$LOGS_DIR
STREAMERS_FILE=$CONFIG_DIR/streamers.yml
SETTINGS_FILE=$CONFIG_DIR/settings.yml
COOKIES_FILE=$DATA_DIR/cookies.txt
SERVER_PORT=$APP_PORT
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
SERVER_PORT=$APP_PORT
SECURE_COOKIES=true
TRUST_PROXY=true
EOF
    chown root:root "$ENV_FILE"
  fi
}

# --- Modul: release ---------------------------------------------------------------
setup_release() {
  local installed=""
  if [ -L "$BASE/current" ]; then
    installed="$(basename "$(readlink -f "$BASE/current" 2>/dev/null || true)")"
  fi
  if [ -n "$installed" ]; then
    log "[release] Release bereits aktiv: $installed – überspringe Initial-Deploy."
    warn "[release] Für neue Versionen: sudo scripts/deploy.sh <version>"
    return 0
  fi
  log "[release] Kein aktives Release – starte Initial-Deploy ..."
  if [ -n "$VERSION" ]; then
    run "$REPO_DIR/scripts/deploy.sh" "$VERSION"
  else
    log "[release] Keine Version angegeben – deploy.sh nutzt package.json des Repos."
    run "$REPO_DIR/scripts/deploy.sh"
  fi
}

# --- Modul: caddy -----------------------------------------------------------------
setup_caddy() {
  if ! command -v caddy >/dev/null 2>&1; then
    warn "[caddy] Caddy ist nicht installiert – überspringe Caddyfile-Setup."
    return 0
  fi
  if [ -f "$CADDYFILE" ]; then
    warn "[caddy] $CADDYFILE existiert bereits – lasse sie unangetastet. Benötigte Blöcke:"
    printf '  %s {\n    reverse_proxy 127.0.0.1:%s\n  }\n' "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && printf '  %s {\n    reverse_proxy 127.0.0.1:%s\n  }\n' "$WEB_DOMAIN" "$WEB_PORT"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] cat > $CADDYFILE: $DOMAIN -> 127.0.0.1:$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && log "[dry-run] cat > $CADDYFILE: $WEB_DOMAIN -> 127.0.0.1:$WEB_PORT"
    return 0
  fi
  log "[caddy] Lege minimale $CADDYFILE an ..."
  umask 022
  {
    printf '%s {\n  reverse_proxy 127.0.0.1:%s\n}\n\n' "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && printf '%s {\n  reverse_proxy 127.0.0.1:%s\n}\n' "$WEB_DOMAIN" "$WEB_PORT"
  } > "$CADDYFILE"
  systemctl restart caddy
  log "[caddy] Caddy neu gestartet (Let's-Encrypt-Zertifikate zieht Caddy beim ersten Abruf)."
}

# --- Module ausführen ---------------------------------------------------------------
has_module user    && setup_user
has_module dirs    && setup_dirs
has_module systemd && setup_systemd
has_module env     && setup_env
has_module release && setup_release
has_module caddy   && setup_caddy

# --- Abschluss ----------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  log "Dry-Run beendet – keine Änderungen durchgeführt."
  exit 0
fi

if systemctl is-active --quiet "$SERVICE"; then
  log "Dienst '$SERVICE' läuft."
else
  warn "Dienst läuft nicht. Prüfen: journalctl -u $SERVICE -n 50 --no-pager"
fi
if [ -n "$DOMAIN" ]; then
  log "Bootstrap abgeschlossen. Health-Check: https://$DOMAIN/health"
else
  log "Bootstrap abgeschlossen. Health-Check: http://127.0.0.1:$APP_PORT/health"
fi
