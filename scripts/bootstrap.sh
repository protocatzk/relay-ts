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
#   nginx    – Vhost für nativen nginx; Docker-Reverse-Proxy (nginx-proxy)
#              wird erkannt und nur mit Anleitung bedient (benötigt --domain)
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
#   sudo scripts/bootstrap.sh --domain stream.example.com --nginx
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
NGINX_SITE=relay
NGINX_SITES_AVAILABLE=/etc/nginx/sites-available
NGINX_SITES_ENABLED=/etc/nginx/sites-enabled
NGINX_CONF_D=/etc/nginx/conf.d
ALL_MODULES="user,dirs,systemd,env,release,caddy,nginx"
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
    --nginx) case ",$MODULES," in *,nginx,*) ;; *) MODULES="$MODULES,nginx" ;; esac ;;
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
if has_module caddy || has_module nginx; then
  [ -n "$DOMAIN" ] || fail "Module 'caddy' und 'nginx' benötigen --domain <domain>."
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

# --- Modul: nginx -----------------------------------------------------------------
# Gibt einen Vhost-Block für 'Domain -> Upstream' auf stdout aus.
# Buffered Streaming (SSE/Preview-Tap) wird explizit abgeschaltet, damit
# Status-Events und der MPEG-TS-Tap nicht verzögert werden; client_max_body_size
# deckt Asset-Uploads (max. 50 MB) ab.
nginx_vhost_snippet() {
  printf 'server {\n'
  printf '    listen 80;\n'
  printf '    server_name %s;\n\n' "$1"
  printf '    location / {\n'
  printf '        proxy_pass http://127.0.0.1:%s;\n' "$2"
  printf '        proxy_http_version 1.1;\n'
  printf '        proxy_set_header Host $host;\n'
  printf '        proxy_set_header X-Real-IP $remote_addr;\n'
  printf '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
  printf '        proxy_set_header X-Forwarded-Proto $scheme;\n'
  printf '        proxy_buffering off;\n'
  printf '        proxy_read_timeout 24h;\n'
  printf '        client_max_body_size 64m;\n'
  printf '    }\n'
  printf '}\n\n'
}

# Läuft ein Docker-Container (z. B. legacy 'nginx-proxy') und published 80/443?
docker_reverse_proxy_active() {
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
      | grep -Eq '0\.0\.0\.0:(80|443)->'; then
      return 0
    fi
  fi
  ss -ltnp 2>/dev/null | grep -E ':80 |:443 ' | grep -q docker-proxy
  return $?
}

setup_nginx() {
  # Docker-basierter Reverse-Proxy hat Vorrang: Dort kann das Skript keine
  # Konfiguration ablegen – Snippet und Hinweise für das manuelle Setup ausgeben.
  if docker_reverse_proxy_active; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[nginx] [dry-run] Docker-Reverse-Proxy erkannt – würde nur Anleitung ausgeben."
    fi
    warn "[nginx] Docker-Reverse-Proxy belegt Ports 80/443 – schreibe keine native nginx-Konfiguration."
    warn "[nginx] Im Container-Ziel muss der Upstream die Host-Adresse statt 127.0.0.1 verwenden"
    warn "[nginx] (z. B. 172.17.0.1:$APP_PORT oder via extra_hosts: host.docker.internal:host-gateway)."
    warn "[nginx] Für nginx-proxy (VIRTUAL_HOST) oder einen gemounteten Include folgenden Block einrichten:"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT"
    return 0
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    warn "[nginx] nginx ist nicht installiert – überspringe Vhost-Setup (Alternative: Modul 'caddy')."
    return 0
  fi

  # Debian nutzt sites-available/sites-enabled, ansonsten Fallback conf.d.
  local conf_file link=""
  if [ -d "$NGINX_SITES_ENABLED" ]; then
    conf_file="$NGINX_SITES_AVAILABLE/$NGINX_SITE"
    link="$NGINX_SITES_ENABLED/$NGINX_SITE"
  else
    conf_file="$NGINX_CONF_D/$NGINX_SITE.conf"
  fi

  if [ -f "$conf_file" ]; then
    warn "[nginx] Vhost existiert bereits ($conf_file) – lasse ihn unangetastet. Benötigter Block:"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
    return 0
  fi

  if [ "$DRY_RUN" = 1 ]; then
    log "[nginx] [dry-run] Würde Vhost schreiben: $conf_file"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT"
    return 0
  fi

  log "[nginx] Schreibe Vhost: $conf_file ..."
  mkdir -p "$(dirname "$conf_file")"
  nginx_vhost_snippet "$DOMAIN" "$APP_PORT" > "$conf_file"
  [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT" >> "$conf_file"
  [ -n "$link" ] && ln -s "$conf_file" "$link"

  if ! nginx -t 2>&1; then
    warn "[nginx] 'nginx -t' fehlgeschlagen – Vhost liegt unter $conf_file, Konfiguration manuell prüfen."
    return 0
  fi

  # Reload nur, wenn kein fremder Prozess (Caddy, docker-proxy) auf 80/443 lauscht.
  local foreign
  foreign="$(ss -ltnp 2>/dev/null | grep -E ':80 |:443 ' | grep -v '"nginx"' || true)"
  if [ -n "$foreign" ]; then
    warn "[nginx] Ports 80/443 werden von einem anderen Prozess belegt – Vhost wurde geschrieben,"
    warn "[nginx] aber nginx nicht neu geladen. Konflikt zuerst auflösen:"
    printf '   %s\n' "$foreign"
    return 0
  fi

  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
    log "[nginx] Vhost aktiviert, nginx neu geladen (TLS z. B. per certbot ergänzen)."
  else
    systemctl start nginx
    log "[nginx] Vhost aktiviert, nginx gestartet (TLS z. B. per certbot ergänzen)."
  fi
}

# --- Module ausführen ---------------------------------------------------------------
has_module user    && setup_user
has_module dirs    && setup_dirs
has_module systemd && setup_systemd
has_module env     && setup_env
has_module release && setup_release
has_module caddy   && setup_caddy
has_module nginx   && setup_nginx

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
