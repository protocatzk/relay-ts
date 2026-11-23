#!/usr/bin/env bash
#
# RELAY – modulares Bootstrap des systemd-Deploy-Pfads
#
# Richtet einen frischen Host ein, Station für Station (Module):
#   user     – Systemuser 'relay' anlegen
#   deps     – ffmpeg, yt-dlp und Overlay-Schriften prüfen/installieren
#   dirs     – /srv/relay/{releases,config,data,logs} anlegen (relay:relay)
#   systemd  – relay.service installieren, daemon-reload, enable (ohne Start)
#   env      – /etc/relay.env aus Vorlage (0600, absolute Pfade)
#   release  – erstes Release via deploy.sh inkl. Health-Check
#   caddy    – minimale Caddyfile (benötigt --domain, optional --web-domain)
#   nginx    – Vhost für nativen nginx; Docker-Reverse-Proxy (nginx-proxy)
#              wird erkannt und nur mit Anleitung bedient (benötigt --domain)
#   docker-nginx – eigener nginx-Container mit gemountetem Vhost
#              (--network host, Upstream 127.0.0.1); ein laufender Legacy-
#              Proxy oder fremder nginx-Container wird nur angeleitet.
#              Mit --nginx-container <name> wird der Vhost stattdessen in
#              einen bestehenden Container injiziert: bind-Mount nach
#              /etc/nginx/conf.d bevorzugt, sonst docker cp; Upstream je
#              nach Netzwerk-Modus; Abschluss mit nginx -t und Reload.
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
#   sudo scripts/bootstrap.sh --domain stream.example.com --docker-nginx
#   sudo scripts/bootstrap.sh --domain stream.example.com --docker-nginx \
#          --nginx-container web-proxy   # Vhost in bestehenden Container
#   sudo scripts/bootstrap.sh --dry-run                      # Vorschau, auch ohne root
#   sudo scripts/bootstrap.sh --force                        # vorhandene /etc/relay.env ersetzen
#   sudo scripts/bootstrap.sh --distro ubuntu                # Ubuntu-Pfad statt CentOS
#
# Distro-Pfade (--distro, Default: centos): Das Skript läuft auf systemd-Hosts
# von Natur aus weitgehend identisch; der Pfad steuert nur die Unterschiede:
#   centos  – nginx-Vhost in /etc/nginx/conf.d, SELinux-/firewalld-Hinweise
#   ubuntu  – nginx-Vhost in sites-available/sites-enabled, ufw-Hinweise
# Ohne --distro wird der Host über /etc/os-release erkannt; passt das Ergebnis
# zum gewählten Pfad, gibt es eine Warnung (Detection ID 'ubuntu' ↔ Pfad
# 'ubuntu' bzw. rhel-Familie ↔ 'centos', Unbekannt → centos).
#
# Voraussetzungen: root (außer --dry-run), systemd-Host (CentOS/RHEL-Familie
# oder Ubuntu/Debian), Node unter /opt/node22 (siehe systemd/relay.service
# und deploy.sh PATH).
set -euo pipefail

# sbin-Verzeichnisse explizit mitführen: useradd, nginx, getenforce usw.
# liegen dort; ohne sie scheitert das Skript z. B. unter root@ubuntu.
export PATH=/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

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
NGINX_DOCKER_IMAGE="nginx:stable"
NGINX_DOCKER_NAME="relay-nginx"
NGINX_DOCKER_CONF_DIR=/etc/relay-nginx/conf.d
ALL_MODULES="user,deps,dirs,systemd,env,release,caddy,nginx,docker-nginx"
DEFAULT_MODULES="user,deps,dirs,systemd,env,release"

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
DISTRO=""
NGINX_CONTAINER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --caddy) case ",$MODULES," in *,caddy,*) ;; *) MODULES="$MODULES,caddy" ;; esac ;;
    --nginx) case ",$MODULES," in *,nginx,*) ;; *) MODULES="$MODULES,nginx" ;; esac ;;
    --docker-nginx) case ",$MODULES," in *,docker-nginx,*) ;; *) MODULES="$MODULES,docker-nginx" ;; esac ;;
    --nginx-container) shift; [ $# -gt 0 ] || fail "--nginx-container braucht einen Wert"; NGINX_CONTAINER="$1"
      case ",$MODULES," in *,docker-nginx,*) ;; *) MODULES="$MODULES,docker-nginx" ;; esac ;;
    --domain) shift; [ $# -gt 0 ] || fail "--domain braucht einen Wert"; DOMAIN="$1" ;;
    --web-domain) shift; [ $# -gt 0 ] || fail "--web-domain braucht einen Wert"; WEB_DOMAIN="$1" ;;
    --modules) shift; [ $# -gt 0 ] || fail "--modules braucht eine Liste"; MODULES="$1" ;;
    --distro) shift; [ $# -gt 0 ] || fail "--distro braucht einen Wert (centos|ubuntu)"; DISTRO="$1" ;;
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
if has_module caddy || has_module nginx || has_module docker-nginx; then
  [ -n "$DOMAIN" ] || fail "Module 'caddy', 'nginx' und 'docker-nginx' benötigen --domain <domain>."
fi

[ "$DRY_RUN" = 1 ] && warn "Dry-Run: nur Ausgabe, keine Änderungen."
if [ ! "$(id -u)" = 0 ] && [ "$DRY_RUN" != 1 ]; then
  fail "Als root ausführen: sudo $0 $*"
fi

command -v systemctl >/dev/null 2>&1 || fail "systemctl nicht gefunden – dieses Skript ist für den nativen systemd-Betrieb."
[ -x /opt/node22/bin/node ] || warn "Hinweis: /opt/node22/bin/node fehlt – deploy.sh und die Unit benötigen Node dort."

# --- Distro-Pfad -----------------------------------------------------------------
# Erkennt die Distro-Familie über /etc/os-release (aufrufende Subshell
# verhindert, dass os-release-Variablen das Skript verschmutzen).
detect_distro() {
  local id id_like
  if [ -r /etc/os-release ]; then
    id="$(sh -c '. /etc/os-release; printf "%s" "${ID:-}"')"
    id_like="$(sh -c '. /etc/os-release; printf "%s" "${ID_LIKE:-}"')"
  else
    id=""; id_like=""
  fi
  case "$id $id_like" in
    *ubuntu*|*debian*) echo "ubuntu" ;;
    *centos*|*rhel*|*rocky*|*almalinux*|*fedora*|*ol*) echo "centos" ;;
    *) echo "unknown" ;;
  esac
}

CURRENT_DISTRO="$(detect_distro)"
if [ -z "$DISTRO" ]; then
  DISTRO="$CURRENT_DISTRO"
  [ "$DISTRO" = "unknown" ] && DISTRO="centos"
  log "Distro-Pfad: $DISTRO (erkannt über /etc/os-release)."
else
  case "$DISTRO" in
    centos|ubuntu) ;;
    *) fail "Unbekannter Distro-Pfad: $DISTRO (verfügbar: centos, ubuntu)" ;;
  esac
  if [ "$CURRENT_DISTRO" != "unknown" ] && [ "$CURRENT_DISTRO" != "$DISTRO" ]; then
    warn "Host scheint Distro-Familie '$CURRENT_DISTRO' zu sein – Skript läuft im '$DISTRO'-Pfad."
    warn "Falls die Erkennung richtig liegt: --distro $CURRENT_DISTRO verwenden."
  else
    log "Distro-Pfad: $DISTRO (--distro gesetzt, matched Erkennung)."
  fi
fi

# --- Modul: user ---------------------------------------------------------------
setup_user() {
  if id -r "$SERVICE_USER" >/dev/null 2>&1; then
    log "[user] Systemuser '$SERVICE_USER' existiert bereits."
  else
    log "[user] Lege Systemuser '$SERVICE_USER' an ..."
    run useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

# --- Modul: deps ---------------------------------------------------------------
# RELAY benötigt zwingend ffmpeg (Quelle/Sink/Pause-Screens) und yt-dlp
# (TikTok-Auflösung). Ohne sie startet der Dienst zwar, kann aber nicht
# streamen. Für die Overlays kommen Noto Sans/Color Emoji/CJK und Symbola
# dazu, sonst bleiben Emoji und fremde Schriftsysteme im Chat leer.
# Installiert wird nur, was fehlt.
have_bin() {
  command -v "$1" >/dev/null 2>&1
}

setup_deps() {
  local missing=() pkg_install=() pm="" bin="" ver=""
  local fonts_missing=0 font_pkgs=()

  for bin in ffmpeg yt-dlp; do
    if have_bin "$bin"; then
      # ffmpeg nutzt '-version', yt-dlp '--version'. Kein '| head -n1': das
      # schließt die Pipe früh und 'pipefail' würde die Version als
      # SIGPIPE-Fehler verschlucken.
      ver="$("$bin" --version 2>/dev/null || "$bin" -version 2>/dev/null || true)"
      ver="${ver%%$'\n'*}"
      log "[deps] $bin vorhanden: ${ver:-Version unbekannt}"
    else
      missing+=("$bin")
    fi
  done

  # Stream-Overlays (Chat, Emoji, CJK) brauchen Schriften im System: der
  # Canvas-Renderer lädt sie über fontconfig, drawtext über feste Pfade.
  if command -v fc-list >/dev/null 2>&1 \
    && fc-list ':charset=1F600' family 2>/dev/null | grep -q 'Noto Color Emoji'; then
    log "[deps] Overlay-Schriften vorhanden (Noto Color Emoji, CJK)."
  else
    fonts_missing=1
  fi

  if [ ${#missing[@]} -eq 0 ] && [ "$fonts_missing" = 0 ]; then
    return 0
  fi

  if [ "$DISTRO" = "ubuntu" ]; then
    pm="apt-get"
    pkg_install=(apt-get install -y)
    font_pkgs=(fonts-dejavu-core fonts-noto-color-emoji fonts-noto-core fonts-noto-cjk fonts-symbola)
  else
    pm="dnf"
    command -v dnf >/dev/null 2>&1 || pm="yum"
    pkg_install=("$pm" install -y)
    font_pkgs=(dejavu-sans-fonts google-noto-color-emoji-fonts google-noto-sans-fonts google-noto-sans-cjk-fonts)
  fi

  if ! command -v "$pm" >/dev/null 2>&1; then
    warn "[deps] $pm nicht gefunden – ffmpeg/yt-dlp/Schriften bitte manuell installieren: ${missing[*]:-keine Binaries}"
    return 0
  fi

  # apt braucht vor der Erstinstallation aktualisierte Paketlisten; ein
  # vollständiges 'upgrade' wird bewusst nicht ausgeführt.
  if [ "$pm" = "apt-get" ]; then
    run apt-get update -qq || warn "[deps] 'apt-get update' fehlgeschlagen – versuche Installation trotzdem."
  fi

  # yt-dlp steckt in EPEL (CentOS) bzw. den Universe-Quellen (Ubuntu); fehlt
  # das Paket, bleibt ffmpeg trotzdem installierbar. Getrennt installieren,
  # damit ein fehlendes yt-dlp-Paket den ffmpeg-Schritt nicht abbricht.
  for bin in "${missing[@]}"; do
    if [ "$DRY_RUN" = 1 ]; then
      log "[dry-run] ${pkg_install[*]} $bin"
      continue
    fi
    if "${pkg_install[@]}" "$bin" >/dev/null 2>&1; then
      log "[deps] $bin installiert."
    else
      case "$bin" in
        yt-dlp)
          warn "[deps] yt-dlp konnte nicht per $pm installiert werden. Alternativen:"
          warn "[deps]   pipx install yt-dlp        (oder)  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp"
          ;;
        *)
          warn "[deps] $bin konnte nicht per $pm installiert werden – Streaming wird fehlschlagen."
          ;;
      esac
    fi
  done

  if [ "$fonts_missing" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[dry-run] ${pkg_install[*]} ${font_pkgs[*]}"
    elif "${pkg_install[@]}" "${font_pkgs[@]}" >/dev/null 2>&1; then
      log "[deps] Schriften installiert (${font_pkgs[*]})."
    else
      warn "[deps] Schriften konnten nicht vollständig per $pm installiert werden."
      warn "[deps] Ohne Noto Color Emoji erscheinen Emoji im Chat-Overlay monochrom/leer."
    fi
  fi

  if [ "$DRY_RUN" != 1 ]; then
    for bin in "${missing[@]}"; do
      have_bin "$bin" || warn "[deps] $bin ist weiterhin nicht im PATH verfügbar."
    done
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
SERVER_HOST=127.0.0.1
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
SERVER_HOST=127.0.0.1
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
    # Häufigster Stolperstein: Der Block liegt nur als Kommentar vor. Caddy
    # kennt die Domain dann nicht, der TLS-Handshake bricht mit
    # "tlsv1 alert internal error" ab und es wird kein Zertifikat ausgestellt.
    if ! grep -Eq "^[[:space:]]*${DOMAIN//./\\.}[[:space:]]*\{" "$CADDYFILE"; then
      warn "[caddy] Kein aktiver Site-Block für '$DOMAIN' gefunden (evtl. auskommentiert)."
      warn "[caddy] Dann ist die Domain per HTTPS nicht erreichbar, obwohl der Dienst läuft."
      warn "[caddy] Vorlage: docs/Caddyfile.example – Block aktivieren, dann 'systemctl reload caddy'."
    else
      log "[caddy] Aktiver Site-Block für '$DOMAIN' vorhanden."
    fi
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
# deckt Asset-Uploads (max. 50 MB) ab. Optionaler dritter Parameter: Upstream-
# Host (Default 127.0.0.1, z. B. Docker-Bridge-Gateway für Container ohne
# Host-Netzwerk).
nginx_vhost_snippet() {
  printf 'server {\n'
  printf '    listen 80;\n'
  printf '    server_name %s;\n\n' "$1"
  printf '    location / {\n'
  printf '        proxy_pass http://%s:%s;\n' "${3:-127.0.0.1}" "$2"
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
    warn "[nginx] Alternativ: Modul 'docker-nginx' startet einen eigenen nginx-Container (--docker-nginx)."
    return 0
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    warn "[nginx] nginx ist nicht installiert – überspringe Vhost-Setup (Alternative: Modul 'caddy')."
    return 0
  fi

  # Distro-Pfade: Ubuntu nutzt sites-available/sites-enabled, CentOS conf.d.
  local conf_file link=""
  if [ "$DISTRO" = "ubuntu" ]; then
    if [ ! -d "$NGINX_SITES_ENABLED" ]; then
      warn "[nginx] Ubuntu-Pfad, aber $NGINX_SITES_ENABLED fehlt – Fallback $NGINX_CONF_D."
      conf_file="$NGINX_CONF_D/$NGINX_SITE.conf"
    else
      conf_file="$NGINX_SITES_AVAILABLE/$NGINX_SITE"
      link="$NGINX_SITES_ENABLED/$NGINX_SITE"
    fi
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

  # CentOS/RHEL: SELinux blockiert standardmäßig den Proxy auf lokale Ports.
  if [ "$DISTRO" = "centos" ] && command -v getenforce >/dev/null 2>&1 \
      && [ "$(getenforce 2>/dev/null || true)" = "Enforcing" ]; then
    warn "[nginx] SELinux ist Enforcing – Proxy zum Upstream ggf. erlauben:"
    warn "[nginx]   sudo setsebool -P httpd_can_network_connect 1"
  fi
}

# -------------------------------------------------------------------------------------------------------------
# Injektion des RELAY-Vhosts in einen benannten, bestehenden nginx-Container
# (--nginx-container). Wählt den Ablageort automatisch:
# bind-Mount nach /etc/nginx/conf.d wenn vorhanden, sonst docker cp (flüchtig
# bei Neuerstellung des Containers). Upstream: Host-Netzwerk -> 127.0.0.1,
# sonst Container-Gateway (Host-Seite der Docker-Bridge). Abschließend
# nginx -t und Reload im Container.
setup_docker_nginx_add() {
  local name="$NGINX_CONTAINER" state network upstream mount_info conf_dir="" target wrote=0
  if ! docker inspect "$name" >/dev/null 2>&1; then
    warn "[docker-nginx] Ziel-Container '$name' nicht gefunden – übersprungen (Namen: docker ps -a)."
    return 0
  fi
  state="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
  if [ "$state" != "running" ]; then
    warn "[docker-nginx] Ziel-Container '$name' läuft nicht (Status: ${state:-unbekannt}) – übersprungen."
    warn "[docker-nginx]   docker start $name  und Modul erneut ausführen."
    return 0
  fi

  network="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$name" 2>/dev/null || true)"
  if [ "$network" = "host" ]; then
    upstream="127.0.0.1"
    log "[docker-nginx] Ziel '$name' läuft im Host-Netzwerk – Upstream $upstream:$APP_PORT."
  else
    upstream="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$name" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$upstream" ] || upstream="172.17.0.1"
    warn "[docker-nginx] Ziel '$name' läuft im Bridge-Netzwerk – Upstream $upstream:$APP_PORT (Host-Seite)."
    warn "[docker-nginx] RELAY muss dafür auf allen Interfaces lauschen (SERVER_HOST=0.0.0.0, env prüfen)."
  fi

  # Ablageort: bind-Mount nach /etc/nginx/conf.d, sonst docker cp.
  mount_info="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d"}}{{.Type}}:{{.Source}}{{end}}{{end}}' "$name" 2>/dev/null || true)"
  case "$mount_info" in
    bind:*)
      conf_dir="${mount_info#bind:}"
      log "[docker-nginx] Ziel mountet /etc/nginx/conf.d von Host: $conf_dir"
      ;;
    volume:*)
      warn "[docker-nginx] /etc/nginx/conf.d im Ziel ist ein Docker-Volume – nutze docker cp (flüchtig bei Neuerstellung)."
      ;;
    *)
      warn "[docker-nginx] Ziel mountet kein /etc/nginx/conf.d – nutze docker cp (flüchtig bei Neuerstellung;"
      warn "[docker-nginx] die nginx.conf des Containers muss conf.d/*.conf einbinden)."
      ;;
  esac

  if [ -n "$conf_dir" ]; then
    target="$conf_dir/relay.conf"
  else
    target="$NGINX_DOCKER_CONF_DIR/relay.conf"
  fi

  if [ -f "$target" ]; then
    warn "[docker-nginx] Vhost existiert bereits ($target) – lasse ihn unangetastet."
  elif [ "$DRY_RUN" = 1 ]; then
    log "[docker-nginx] [dry-run] Würde Vhost schreiben: $target (Upstream $upstream)"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT" "$upstream"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT" "$upstream"
  else
    log "[docker-nginx] Schreibe Vhost: $target (Upstream $upstream) ..."
    mkdir -p "$(dirname "$target")"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT" "$upstream" > "$target"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT" "$upstream" >> "$target"
    wrote=1
  fi

  if [ -z "$conf_dir" ] && [ "$wrote" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[docker-nginx] [dry-run] Würde kopieren: docker cp $target $name:/etc/nginx/conf.d/relay.conf"
    elif ! docker cp "$target" "$name:/etc/nginx/conf.d/relay.conf"; then
      warn "[docker-nginx] docker cp fehlgeschlagen – Datei liegt unter $target, manuell kopieren."
      return 0
    fi
  fi

  if [ "$DRY_RUN" = 1 ]; then
    log "[docker-nginx] [dry-run] Würde prüfen/laden: docker exec $name nginx -t && docker exec $name nginx -s reload"
    return 0
  fi

  if docker exec "$name" nginx -t; then
    docker exec "$name" nginx -s reload
    log "[docker-nginx] Vhost in Container '$name' aktiviert, nginx neu geladen."
  else
    warn "[docker-nginx] 'nginx -t' in '$name' fehlgeschlagen – Konfiguration prüfen:"
    warn "[docker-nginx]   docker exec $name nginx -t"
  fi
}

# --- Modul: docker-nginx -----------------------------------------------------------
# Eigener nginx-Container für RELAY. Läuft mit --network host, sodass der
# Upstream 127.0.0.1:<APP_PORT> unabhängig von SERVER_HOST funktioniert und
# keine Port-Weiterleitung (docker-proxy) nötig ist. Die Vhost-Datei liegt auf
# dem Host und wird read-only in den Container gemountet.
setup_docker_nginx() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "[docker-nginx] Docker ist nicht installiert – Modul übersprungen."
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    warn "[docker-nginx] Docker-Daemon nicht erreichbar – Modul übersprungen."
    return 0
  fi

  # Laufende nginx-Container sichten: Legacy-Proxy hat Vorrang, danach fremde.
  local line name image ports legacy="" foreign=""
  while IFS='|' read -r name image ports; do
    [ -n "${name:-}" ] || continue
    case "$image" in
      *nginxproxy/nginx-proxy*|*jwilder/nginx-proxy*)
        legacy="$name" ;;
      *relay-nginx*|*nginx*)
        [ "$name" = "$NGINX_DOCKER_NAME" ] || foreign="$name" ;;
    esac
  done < <(docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' 2>/dev/null)

  # Legacy nginx-proxy konfiguriert sich über Container-Env (VIRTUAL_HOST) und
  # kann native Host-Dienste nicht automatisch routen – nur anleiten.
  if [ -n "$legacy" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[docker-nginx] [dry-run] Legacy-Proxy '$legacy' erkannt – würde nur Anleitung ausgeben."
    fi
    warn "[docker-nginx] Legacy-Reverse-Proxy '$legacy' läuft – automatisches Setup nicht möglich."
    warn "[docker-nginx] Eigene Container-Instanz erst möglich, nachdem der Legacy-Proxy gestoppt ist:"
    warn "[docker-nginx]   docker stop $legacy && docker rm $legacy  (anschließend Modul erneut ausführen)"
    warn "[docker-nginx] Alternativ Include im manuell gepflegten Proxy (Upstream = Host-Adresse):"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT"
    return 0
  fi

  # Explizit benannter, bestehender Container: Vhost dorthin injizieren.
  if [ -n "$NGINX_CONTAINER" ] && [ "$NGINX_CONTAINER" != "$NGINX_DOCKER_NAME" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[docker-nginx] [dry-run] Ziel-Container '$NGINX_CONTAINER' angegeben – Injektion-Modus."
    fi
    setup_docker_nginx_add
    return 0
  fi

  # Fremder nginx-Container: Konfiguration gehört dem Betreiber – nur anleiten.
  if [ -n "$foreign" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "[docker-nginx] [dry-run] Fremder nginx-Container '$foreign' – würde nur Anleitung ausgeben."
    fi
    warn "[docker-nginx] Fremder nginx-Container '$foreign' läuft – schreibe keine Konfiguration."
    warn "[docker-nginx] Folgenden Block im Container ergänzen (Mount nach /etc/nginx/conf.d,"
    warn "[docker-nginx] ohne --network host muss der Upstream die Host-Adresse sein, z. B. 172.17.0.1:$APP_PORT):"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT"
    warn "[docker-nginx] Danach neu laden: docker exec $foreign nginx -t && docker exec $foreign nginx -s reload"
    warn "[docker-nginx] Automatisch möglich mit: --nginx-container $foreign"
    return 0
  fi

  # Vhost-Datei (wie alle Module: bestehende Dateien niemals überschreiben).
  local wrote=0
  if [ -f "$NGINX_DOCKER_CONF_DIR/relay.conf" ]; then
    warn "[docker-nginx] Vhost existiert bereits ($NGINX_DOCKER_CONF_DIR/relay.conf) – lasse ihn unangetastet."
  elif [ "$DRY_RUN" = 1 ]; then
    log "[docker-nginx] [dry-run] Würde Vhost schreiben: $NGINX_DOCKER_CONF_DIR/relay.conf"
  else
    log "[docker-nginx] Schreibe Vhost: $NGINX_DOCKER_CONF_DIR/relay.conf ..."
    mkdir -p "$NGINX_DOCKER_CONF_DIR"
    nginx_vhost_snippet "$DOMAIN" "$APP_PORT" > "$NGINX_DOCKER_CONF_DIR/relay.conf"
    [ -n "$WEB_DOMAIN" ] && nginx_vhost_snippet "$WEB_DOMAIN" "$WEB_PORT" >> "$NGINX_DOCKER_CONF_DIR/relay.conf"
    wrote=1
  fi

  # Container-Zustand ermitteln (auch gestoppte Instanzen mit docker inspect sichtbar).
  local ours_state
  ours_state="$(docker inspect -f '{{.State.Status}}' "$NGINX_DOCKER_NAME" 2>/dev/null || true)"

  case "${ours_state:-missing}" in
    running)
      log "[docker-nginx] Container '$NGINX_DOCKER_NAME' läuft bereits."
      if [ "$wrote" = 1 ]; then
        if docker exec "$NGINX_DOCKER_NAME" nginx -t >/dev/null 2>&1; then
          docker exec "$NGINX_DOCKER_NAME" nginx -s reload
          log "[docker-nginx] Vhost aktiviert, nginx im Container neu geladen."
        else
          warn "[docker-nginx] 'nginx -t' im Container fehlgeschlagen – Konfiguration prüfen:"
          warn "[docker-nginx]   docker exec $NGINX_DOCKER_NAME nginx -t"
        fi
      fi
      ;;
    exited|created)
      warn "[docker-nginx] Container '$NGINX_DOCKER_NAME' existiert gestoppt ('$ours_state')."
      if [ "$DRY_RUN" = 1 ]; then
        log "[docker-nginx] [dry-run] Würde starten: docker start $NGINX_DOCKER_NAME"
        return 0
      fi
      docker start "$NGINX_DOCKER_NAME"
      log "[docker-nginx] Container gestartet."
      ;;
    missing)
      # Mit --network host belegt der Container direkt Host-Port 80 –
      # Konflikt vorher erkennen, statt den Container crashen zu lassen.
      local occupant
      occupant="$(ss -ltnp 2>/dev/null | grep -E ':80 ' || true)"
      if [ -n "$occupant" ]; then
        warn "[docker-nginx] Port 80 ist bereits belegt – Container-Start übersprungen:"
        printf '   %s\n' "$occupant"
        warn "[docker-nginx] Konflikt auflösen (z. B. caddy/legacy-Proxy stoppen) und Modul erneut ausführen."
        return 0
      fi
      if [ "$DRY_RUN" = 1 ]; then
        log "[docker-nginx] [dry-run] Würde starten:"
        log "[docker-nginx] [dry-run]   docker run -d --name $NGINX_DOCKER_NAME --restart unless-stopped \\"
        log "[docker-nginx] [dry-run]     --network host -v $NGINX_DOCKER_CONF_DIR:/etc/nginx/conf.d:ro $NGINX_DOCKER_IMAGE"
        nginx_vhost_snippet "$DOMAIN" "$APP_PORT"
        return 0
      fi
      log "[docker-nginx] Starte Container '$NGINX_DOCKER_NAME' (--network host) ..."
      if ! docker run -d --name "$NGINX_DOCKER_NAME" --restart unless-stopped \
          --network host \
          -v "$NGINX_DOCKER_CONF_DIR:/etc/nginx/conf.d:ro" \
          "$NGINX_DOCKER_IMAGE" >/dev/null; then
        warn "[docker-nginx] Container-Start fehlgeschlagen – prüfen: docker logs $NGINX_DOCKER_NAME"
        return 0
      fi
      log "[docker-nginx] Container läuft (HTTP auf Port 80; TLS z. B. per Zertifikats-Mount ergänzen)."
      ;;
  esac
}

# --- Module ausführen ---------------------------------------------------------------
has_module user    && setup_user
has_module deps    && setup_deps
has_module dirs    && setup_dirs
has_module systemd && setup_systemd
has_module env     && setup_env
has_module release && setup_release
has_module caddy   && setup_caddy
has_module nginx   && setup_nginx
has_module docker-nginx && setup_docker_nginx

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
if has_module caddy || has_module nginx || has_module docker-nginx; then
  if [ "$DISTRO" = "ubuntu" ]; then
    warn "Firewall prüfen (ufw): sudo ufw allow 80,443/tcp && sudo ufw status"
  else
    warn "Firewall prüfen (firewalld): sudo firewall-cmd --permanent --add-service={http,https} && sudo firewall-cmd --reload"
  fi
fi
if [ -n "$DOMAIN" ]; then
  if has_module caddy; then
    log "Bootstrap abgeschlossen. Health-Check: https://$DOMAIN/health (TLS zieht Caddy beim ersten Abruf)"
  elif has_module nginx; then
    log "Bootstrap abgeschlossen. Health-Check: http://$DOMAIN/health – TLS danach: sudo certbot --nginx -d $DOMAIN"
  elif has_module docker-nginx; then
    log "Bootstrap abgeschlossen. Health-Check: http://$DOMAIN/health – TLS per Zertifikats-Mount ergänzen"
  else
    log "Bootstrap abgeschlossen. Health-Check: http://$DOMAIN/health – Reverse-Proxy-Modul nicht ausgeführt"
  fi
else
  log "Bootstrap abgeschlossen. Health-Check: http://127.0.0.1:$APP_PORT/health"
fi
