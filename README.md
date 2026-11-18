# Restreamer TS

TikTok-Live → YouTube-Restreaming-Service in **Node.js/TypeScript** mit
Delay-Puffer, MPEG-TS-Relay, Watchdog, Auto-Refresh, Overlays, Playlists und
Web-Dashboard. Die Implementierung orientiert sich am Konzept von
[protocatzk/restreamer](https://github.com/protocatzk/restreamer), ist aber
eigenständig umgesetzt.

> **Rechtlicher Hinweis:** Das Weiterleiten fremder Inhalte kann gegen die
> Nutzungsbedingungen von TikTok/YouTube und gegen Urheberrechte verstoßen.
> Nutze das Projekt nur für Inhalte, für die du die erforderlichen Rechte hast.

---

## Funktionen

- **TikTok → YouTube** über `yt-dlp` (URL-Auflösung) und `ffmpeg`
- **Delay-Puffer** (Standard 30 s) mit Bitraten-Pacing gegen Netzwerk-Bursts
- **MPEG-TS-Relay** über localhost – der YouTube-Encoder bleibt bei
  Quellenwechseln/Reconnects bestehen
- **Watchdog** für Quellen-Stall, Sink-Absturz und Encoder-Stall
- **Quell-Ratenüberwachung**: startet die Quelle neu, wenn TikTok dauerhaft
  weniger als die konfigurierte Mindestrate liefert
- **Auto-Reconnect** mit exponentiellem Backoff
- **Auto-Refresh** der TikTok-URL (Standard alle 20 Minuten)
- **Pausenscreen** bei Offline-Quelle, ohne die RTMP-Verbindung zu trennen,
  inklusive optionaler maximaler Pausendauer
- **Overlays**: Canvas-Chat-Engine mit Bubbles, Panel/Minimal-Stil, Namen,
  Timestamps, Emoji, Tier-Badges, Chat-Statistik und Live-Vorschau (drawtext
  als Fallback), Uhrzeit, freier Text und optionale Einnahmen-Anzeige
- **Overlay-Studio**: vollständige Bühnenvorschau aus ungespeicherten Drafts,
  Positions-Klick, globale Persistenz und Live-Anwendung für alle Streamer
- **Playlists** mit Auto-Advance, Wrap, Endzeit, Vor-/Zurück-Springen und
  direktem Ansteuern einzelner Kanäle
- **Online-Status** über eine konfigurierbare JSON-API (z. B. TokTracker),
  inklusive optionalem automatischem Wechsel zum bevorzugten Streamer
- **Eigene YouTube-Streams** pro Streamer (`own_stream`) und lokale
  YouTube-Titel-Vorschau per Template
- **Einnahmen-Monitor** (TokTracker-kompatibel) für Dashboard und Overlay
- **Web-Dashboard** (Vue 3) im TokTracker-Design mit Live-Updates per SSE
- **Auth**: Passwort-Session-Cookie, Basic Auth und API-Token
- **Telegram-Login**: Freigabe per Bot-Chat, optional parallel zum Passwort
- **Reverse-Proxy-ready**: nginx-proxy/Let's-Encrypt-Override für öffentliche Domains
- **Docker**-Image mit ffmpeg, yt-dlp und Fonts

---

## Architektur

```
TikTok Live
    │  yt-dlp (URL, Format, Cookies)
    ▼
ffmpeg Quelle ──MPEG-TS──► Relay-Port 12345
                              │
                              ▼
                       DelayBuffer (30 s, Pacing)
                              │
                              ▼
                    Playback-Port 12346
                              │
                              ▼
ffmpeg Sink (720x1280, CBR, AAC) ──RTMP──► YouTube
```

Der DelayBuffer ist eine verlustfreie TCP-Verzögerungsleitung. Die Quelle
schreibt kontinuierlich MPEG-TS, der Puffer hält Pakete für die konfigurierte
Dauer zurück und gibt sie mit der gemessenen Quell-Bitrate getaktet aus. Der
Encoder erhält dadurch einen gleichmäßigen Strom statt TikTok-Bursts. Bei einem
Quellenwechsel wird nur die Quelle neu gestartet; der Sink und damit die
YouTube-Verbindung bleiben bestehen. Damit die MPEG-TS-Zeitstempel beim
Reconnect nicht rückwärts springen, erhält jede neue Quelle einen kumulativen
`-output_ts_offset`.

### Projektstruktur

```
src/
├── api/                  Fastify-Server, Auth, REST-Routen, SSE
├── core/
│   ├── config/           Zod-Schema, YAML-/ENV-Loader
│   ├── earnings/         Einnahmen-Monitor (TokTracker-kompatibel)
│   ├── overlays/         Canvas-Chat-Engine, drawtext, Chat, Pausenscreen
│   ├── online/           Online-Status-Monitor
│   ├── relay/            DelayBuffer, MPEG-TS-Relay
│   ├── sink/             YouTube-Sink (ffmpeg)
│   ├── source/           TikTok-Resolver, Quelle, ffmpeg-Builder
│   ├── store/            YAML-Store, Settings-Service
│   └── supervisor/       Supervisor, Watchdog, Auto-Refresh
├── utils/                Logger, Prozesse, Dateien
└── web/                  Vue-3-Dashboard (Vite)
tests/                    Vitest Unit-/Integrationstests
config/                   streamers.yml, settings.yml
docker/                   Entrypoint
```

---

## Schnellstart mit Docker

```bash
cp .env.example .env
cp config/streamers.example.yml config/streamers.yml

# .env anpassen: DASHBOARD_PASSWORD, ggf. TIKTOK_SESSION_ID
# config/streamers.yml: Streamer und youtube_key_env eintragen

docker compose up -d --build
```

Dashboard: <http://127.0.0.1:3000>
Öffentlich (mit nginx-proxy): <https://relay.positronium.dev>

Die Ports sind bewusst an `127.0.0.1` gebunden. Für öffentlichen Zugriff einen
Reverse-Proxy (Caddy/nginx) davor setzen und `DASHBOARD_PASSWORD` verwenden.

### Stream-Key hinterlegen

Empfohlen: Key nur in `.env` und in `streamers.yml` auf die Variable verweisen.

```yaml
streamers:
  - id: mein_streamer
    name: Mein Streamer
    tiktok: mein_handle
    youtube_key_env: YOUTUBE_STREAM_KEY_MEIN
```

```dotenv
YOUTUBE_STREAM_KEY_MEIN=xxxx-xxxx-xxxx-xxxx-xxxx
```

Alternativ kann im Dashboard ein Key eingegeben werden; er wird dann in
`config/streamers.yml` gespeichert (Datei wird mit Modus `0600` geschrieben).

### Telegram-Login

Der Telegram-Bot dient als Login-Freigabe für das Dashboard. Er nutzt
Long-Polling und braucht keinen offenen Port. In `.env` eintragen:

```dotenv
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_ALLOWED_USER_IDS=123456789
SECURE_COOKIES=true
```

Die eigene numerische ID liefert der Bot auf `/id`. Ohne Token oder ohne
Allow-List bleibt der Telegram-Login deaktiviert (fail-closed). Der Ablauf:

1. Dashboard öffnen und **Mit Telegram anmelden** wählen.
2. Der Bot öffnet sich mit einem einmaligen Login-Token (10 Minuten gültig).
3. Im Bot **✅ ANMELDEN FREIGEBEN** drücken.
4. Der Browser erhält ein signiertes HttpOnly-Session-Cookie (30 Tage).

Nur private Chats von IDs aus `TELEGRAM_ALLOWED_USER_IDS` werden akzeptiert.
Ein zusätzlich gesetztes `DASHBOARD_PASSWORD` funktioniert parallel.

### Öffentliche Domain (nginx-proxy)

Für TLS + Let's Encrypt liegt eine Override-Vorlage bereit:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# VIRTUAL_HOST, LETSENCRYPT_HOST und E-Mail anpassen
docker compose up -d --build
```

Die Vorlage geht davon aus, dass `nginx-proxy` und `acme-companion` laufen und
das externe Netz `toktrackerapp_toktracker_net` vorhanden ist. Die
produktive Konfiguration zeigt auf `relay.positronium.dev`. Bei HTTPS muss
`SECURE_COOKIES=true` gesetzt sein.

---

## Lokale Entwicklung

Voraussetzungen:

- Node.js **20.19+** (empfohlen: 22 LTS)
- `ffmpeg` und `yt-dlp` im `PATH` (oder `FFMPEG_BIN`/`YTDLP_BIN` setzen)

```bash
npm ci
cp .env.example .env
npm run dev          # Backend auf :3000
npm run dev:web      # Vite auf :5173, proxied /api -> :3000
```

Produktionsbuild:

```bash
npm run build        # tsc + vite
node dist/main.js
```

Qualitätschecks:

```bash
npm run typecheck
npm run lint
npm test
npm run check        # alles zusammen
```

---

## Konfiguration

Priorität: **Defaults → `streamers.yml` (settings) → `settings.yml` →
Umgebungsvariablen (nur fehlende Werte) → CLI**. Mit
`SETTINGS_ENV_OVERRIDES=true` überschreiben Umgebungsvariablen die
`settings.yml` bei jedem Start; standardmäßig gewinnen die im Dashboard
gespeicherten Werte.

Wichtige Umgebungsvariablen (vollständig in `.env.example`):

| Variable | Bedeutung | Default |
|---|---|---|
| `SERVER_HOST` / `SERVER_PORT` | HTTP-Server | `0.0.0.0` / `3000` |
| `DASHBOARD_PASSWORD` | Dashboard-Passwort (leer = kein Login) | – |
| `API_TOKEN` | Bearer-Token für Skripte/SSE | – |
| `SESSION_SECRET` | Cookie-Signatur | aus Passwort abgeleitet |
| `SECURE_COOKIES` | Cookies nur über HTTPS | `false` |
| `TELEGRAM_BOT_TOKEN` | Bot für Login-Freigaben | – |
| `TELEGRAM_ALLOWED_USER_IDS` | Erlaubte numerische IDs (kommagetrennt) | – |
| `TIKTOK_SESSION_ID` | TikTok-`sessionid`-Cookie | – |
| `STREAMERS_FILE` | Pfad zur Streamer-YAML | `config/streamers.yml` |
| `SETTINGS_FILE` | Pfad zu Settings-YAML | `config/settings.yml` |
| `RELAY_PORT` | Ingest-Port (Playback = Port+1) | `12345` |
| `RELAY_DELAY_SECONDS` | Delay in Sekunden (`0` = aus) | `30` |
| `OUTPUT_RESOLUTION` | `720x1280`, `1280x720`, `1080x1920`, `1920x1080`, `1600x900` | `720x1280` |
| `OUTPUT_FPS` | Bildrate | `25` |
| `VIDEO_BITRATE` / `AUDIO_BITRATE` | kbit/s | `4000` / `128` |
| `X264_PRESET` | `ultrafast` … `medium` | `veryfast` |
| `STALL_TIMEOUT` | Stall-Erkennung (s) | `30` |
| `MIN_BITRATE` | Mindestbitrate (kbit/s) | `500` |
| `AUTO_REFRESH_MINUTES` | URL-Refresh-Intervall | `20` |
| `PAUSE_ON_OFFLINE` | Pausenscreen statt Trennung | `true` |
| `ONLINE_SOURCE_URL` | JSON-API für Live-Status | – |
| `CHAT_API_URL` | Chat-API, `{handle}` wird ersetzt | – |
| `FFMPEG_BIN` / `YTDLP_BIN` | Binary-Pfade | `ffmpeg` / `yt-dlp` |

### Einstellungen (`config/settings.yml`)

Das Dashboard schreibt die Einstellungen nach `config/settings.yml`. Die Datei
kann auch manuell bearbeitet werden; der Service lädt sie beim Start und
erkennt Änderungen an `streamers.yml` zur Laufzeit.

```yaml
delay_buffer:
  enabled: true
  size: 30          # Sekunden
  max_bytes: 32     # MiB (Mindestgröße; wird bei größerem Delay automatisch angehoben)
video:
  resolution: 720x1280
  fps: 25
  video_bitrate: 4000
  audio_bitrate: 128
  preset: veryfast
watchdog:
  stall_timeout: 30
  min_bitrate: 500
  min_source_rate_percent: 85
  interval: 5
  auto_reconnect: true
  max_reconnect_delay: 60
auto_refresh:
  enabled: true
  interval: 20
pause:
  enabled: true
  text: "Stream pausiert"
  subtext: "Gleich geht es weiter"
  max_minutes: 15
  grace_seconds: 2
online:
  enabled: false
  source_url: ""
  api_key: ""
  interval: 60
  auto_switch_preferred: false
chat:
  api_url: ""
  api_key: ""
overlays:
  chat: { enabled: true, engine: canvas, position: bottom-left, style: bubbles }
  clock: { enabled: false, position: top-right, format: "%H:%M:%S" }
  text: { enabled: false, position: top-left, text: "" }
streaming:
  title_template: "{name} – LIVE"
earnings:
  enabled: false
  source_url: ""
  api_key: ""
  interval: 300
  view: standard
  overlay_enabled: false
  overlay_position: top-left
  overlay_template: "{net} € · {coins} Coins"
  overlay_font_size: 22
```

Änderungen werden sofort nach `config/settings.yml` geschrieben (atomar, Modus
`0600`) und vom laufenden Prozess übernommen. Secrets bleiben bei Teil-Updates
erhalten, solange kein neuer `api_key` gesendet wird. Overlay-Einstellungen
gelten global für alle Streamer und werden ebenfalls in `config/settings.yml`
persistiert (`PUT /api/overlays` bzw. Overlay-Studio).

### Offline- und Pause-Verhalten

Wenn die TikTok-Quelle endet, pausiert oder vorübergehend nicht auflösbar ist,
bleibt der YouTube-Sink aktiv. Der Supervisor wartet standardmäßig
`pause.grace_seconds` (2 s) auf eine schnelle Wiederverbindung und startet dann
den Pausenscreen als Ersatzquelle im Relay. Die RTMP-Verbindung zu YouTube wird
dabei nicht neu aufgebaut. Sobald die Quelle wieder live ist, wird der
Pausenscreen gestoppt und die neue Quelle übernimmt nahtlos. `max_minutes`
begrenzt, wie lange der Pausenscreen laufen darf; `0` bedeutet unbegrenzt.
`PAUSE_GRACE_SECONDS=0` schaltet den Pausenscreen ohne Verzögerung ein.

---

## REST-API

Alle `/api`-Routen sind – sofern ein Passwort oder API-Token gesetzt ist –
geschützt. Login per `POST /api/auth/login` setzt ein signiertes HttpOnly-Cookie;
für Skripte eignet sich `Authorization: Bearer <API_TOKEN>` oder Basic Auth.

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| `POST` | `/api/auth/login` | `{ password }` → Session-Cookie |
| `GET` | `/api/auth/methods` | Verfügbare Login-Methoden |
| `POST` | `/api/auth/telegram/request` | Telegram-Login-Token + Deep-Link |
| `POST` | `/api/auth/telegram/check` | Freigabe-Status; setzt bei Erfolg das Cookie |
| `POST` | `/api/auth/logout` | Session beenden |
| `GET` | `/api/auth/me` | Auth-Status |
| `GET` | `/api/streamers` | Streamer inkl. Status (ohne Keys) |
| `POST` | `/api/streamers` | Streamer anlegen |
| `PUT` | `/api/streamers/:id` | Streamer aktualisieren |
| `DELETE` | `/api/streamers/:id` | Streamer löschen |
| `POST` | `/api/streamers/:id/start` | Stream starten |
| `POST` | `/api/streamers/:id/stop` | Stream stoppen |
| `POST` | `/api/streamers/:id/switch` | Zu Streamer wechseln |
| `GET` | `/api/streamers/:id/title` | YouTube-Titel-Vorschau aus Template |
| `POST` | `/api/quickstart` | Handle + Key anlegen und starten |
| `GET` | `/api/status` | Vollständiger Systemstatus |
| `GET` | `/api/settings` | Einstellungen (Secrets redigiert) |
| `PUT` | `/api/settings` | Einstellungen speichern |
| `GET` | `/api/playlists` | Playlists |
| `POST` | `/api/playlists/:id/play` | Playlist starten |
| `POST` | `/api/playlists/next` | Nächster Eintrag |
| `POST` | `/api/playlists/previous` | Vorheriger Eintrag |
| `POST` | `/api/playlists/:id/tune/:channel` | Kanal direkt ansteuern |
| `POST` | `/api/playlists/stop` | Playlist stoppen |
| `POST` | `/api/reload` | `streamers.yml` neu laden |
| `POST` | `/api/online/check` | Online-Status sofort prüfen |
| `POST` | `/api/pause/start` / `stop` | Pausenscreen an/aus |
| `GET` | `/api/logs?limit=200&level=warn&q=...` | Log-Ringpuffer |
| `DELETE` | `/api/logs` | Log-Ringpuffer leeren |
| `GET` | `/api/overlays/preview.png?sample=1` | Live-Chat-Overlay als PNG |
| `POST` | `/api/overlays/studio.png` | Studio-Vorschau aus ungespeicherten Overlays |
| `PUT` | `/api/overlays` | Globale Overlays speichern und live anwenden |
| `POST` | `/api/chat/test` | Testnachricht ins Overlay einspeisen |
| `GET` | `/api/events` | SSE: `status`, `streamers`, `log` |
| `POST` | `/api/system/restart-sink` | Encoder neu starten |
| `POST` | `/api/system/refresh` | Quell-URL sofort erneuern |
| `GET` | `/health` | Healthcheck (öffentlich) |

Beispiel:

```bash
curl -u user:password http://127.0.0.1:3000/api/status
curl -H "Authorization: Bearer $API_TOKEN" \
     -X POST http://127.0.0.1:3000/api/streamers/alpha/start
```

---

## Overlays

Es gibt zwei Chat-Engines:

- **Canvas (Standard):** `@napi-rs/canvas` rendert nur den Chat-Bereich als
  transparente RGBA-Frames. Diese gehen als zweiter ffmpeg-Input (`pipe:3`) in
  den Encoder und werden per `overlay`-Filter eingeblendet. Bubbles, farbige
  Namen, Textumbruch, Timestamps, Badges und farbige Emoji funktionieren damit
  ohne Neustart der RTMP-Verbindung.
- **drawtext (Fallback):** Der Chat wird in eine Textdatei geschrieben, die
  ffmpeg mit `reload=1` neu einliest. Leichtgewichtig, aber ohne farbige Emoji.

Uhrzeit und freier Text bleiben `drawtext`-Filter. Im Docker-Image sind DejaVu
Sans und Noto Color Emoji enthalten. Die Vorschau und Testnachrichten gibt es
im Dashboard unter **Overlays** (`/overlays`); die API liefert
`/api/overlays/preview.png`, `/api/overlays/studio.png` und `/api/chat/test`.

Das Overlay-Studio rendert die komplette Bühne (Chat, Uhr, Text und Einnahmen)
serverseitig mit `@napi-rs/canvas` aus den **ungespeicherten** Editierwerten.
Die Vorschau wird clientseitig entprellt und mit `AbortController` abgebrochen,
wenn eine neuere Anfrage eintrifft. Ein Klick auf eine Bildecke setzt die
Position des aktiven Overlays. **Speichern** schreibt die Overlays global nach
`config/settings.yml`; läuft ein Streamer, werden Chat-Engine und Sink einmal
sauber neu aufgebaut. Die Einstellungen gelten damit für alle Streamer und
Playlists.

Zusätzliche Chat-Optionen gegenüber der ersten Version: Panel-Stil,
Nachrichtenpuffer (`max_messages`), maximales Nachrichtenalter
(`max_age_seconds`), feste Panelhöhe, Namensfarben, Tier-Badges und eine
Chat-Statistikzeile. Uhr und Text haben nun eigene Ränder sowie optional
abschaltbare Hintergrundboxen. Die Einnahmen-Schriftgröße ist konfigurierbar.

Beim ersten Start nach dem Update werden vorhandene Streamer-Overlays einmalig
als globaler Default in `settings.yml` übernommen. Danach ist das Studio die
einzige Quelle für Overlay-Änderungen; per-Streamer-Overlays in
`streamers.yml` bleiben nur aus Kompatibilitätsgründen erhalten und werden
nicht mehr angewendet.

Ein Streamer kann pro Overlay-Editor zwischen Canvas und drawtext wechseln.
`delay = 0` bedeutet: Chat wird automatisch um die Delay-Buffer-Größe verzögert,
damit er zum leicht versetzten Videobild passt.

**Chat-API:** Es wird ein JSON-Endpunkt erwartet, der Nachrichten als Array
liefert (unter `messages`, `comments`, `chat`, `items`, `data`, `results` oder
direkt). Unterstützte Felder: `username`/`user`/`uniqueId`/`nickname` und
`comment`/`text`/`message`/`content`. `{handle}` in der URL wird durch den
TikTok-Handle ersetzt. Ein API-Key wird als `X-API-Key` und
`Authorization: Bearer` gesendet. Die genaue API hängt vom Anbieter ab; der
Parser ist bewusst tolerant.

---

## Online-Monitor (TokTracker)

Der Live-Status kommt aus der TokTracker-Public-API:

```dotenv
ONLINE_CHECK_ENABLED=true
ONLINE_SOURCE_URL=https://positronium.dev/track/api/public/overview
ONLINE_SOURCE_API_KEY=dein-toktracker-key
ONLINE_CHECK_INTERVAL_SECONDS=60
ONLINE_AUTO_SWITCH_PREFERRED=false
```

Der Key wird als `X-API-Key` gesendet. Ausgewertet wird ausschließlich das
Feld `is_live` der Einträge im `streamers`-Array:

```json
{
  "streamers": [
    { "username": "creator", "is_live": true },
    { "username": "other", "is_live": false }
  ]
}
```

Der Status ist eine Anzeige-/Planungshilfe. Beim tatsächlichen Start entscheidet
weiterhin `yt-dlp`, ob der Stream wirklich live ist. Die OpenAPI-Doku unter
`positronium.dev/track/...` ist aktuell durch den Admin-Login geschützt; der
Public-Overview-Endpunkt funktioniert mit dem API-Key.

Mit `auto_switch_preferred` wechselt der Supervisor automatisch zu einem als
bevorzugt markierten Streamer, sobald dieser online geht.

---

## Playlists

Playlists referenzieren Streamer-IDs oder TikTok-Handles. Sie lassen sich im
Dashboard unter **Playlists** anlegen, bearbeiten und löschen. Fehlt ein
Streamer in der Konfiguration, wird ein temporärer Eintrag mit den
Standard-Overlays erzeugt. `auto_advance` wechselt bei Offline-Quelle nach
`advance_delay_seconds`; `wrap` springt am Ende zum Anfang. Ein gemeinsamer
`youtube_key`/`youtube_key_env` auf Playlist-Ebene hält die YouTube-Verbindung
beim Wechsel offen. `end_after_minutes` beendet die Playlist nach der
angegebenen Dauer; alternativ beendet `end_time: "23:00"` sie täglich zur
festen Uhrzeit (Container-Zeitzone). Beide Optionen schließen sich aus, wobei
`end_time` Vorrang hat. Im Dashboard lassen sich der vorherige/nächste Eintrag
ansteuern und einzelne Kanäle direkt übernehmen. Streamer mit `own_stream: true`
behalten ihren eigenen YouTube-Key auch innerhalb einer Playlist.

---

## Einnahmen (optional)

Der Einnahmen-Monitor liest eine TokTracker-kompatible JSON-Quelle und zeigt
Werte im Dashboard sowie optional als Text-Overlay im Stream:

```dotenv
EARNINGS_ENABLED=true
EARNINGS_SOURCE_URL=https://positronium.dev/track/api/public/overview
EARNINGS_SOURCE_API_KEY=dein-toktracker-key
EARNINGS_REFRESH_SECONDS=300
EARNINGS_VIEW=standard
EARNINGS_OVERLAY_ENABLED=true
EARNINGS_OVERLAY_TEMPLATE={net} € · {coins} Coins
```

Unterstützte Platzhalter: `{net}`, `{gross}`, `{coins}`, `{viewers}`,
`{top_gift}` und `{currency}`. Der Parser erkennt `eur_net`/`usd_net`,
`total_coins`, `current_viewers` und `top_gift`; fehlende Werte werden als `–`
angezeigt.

---

## Umstieg von der Python-Version

Die YAML-Struktur (`streamers`, `playlists`, `channels`, `youtube_key`,
`video_mode`, `own_stream`) wird weitgehend gelesen. Für einen Parallelbetrieb:

1. Konfiguration kopieren, nicht gemeinsam beschreiben:
   `cp /pfad/restreamer/config/streamers.yml ./config/streamers.yml`
2. Unterschiedliche Ports verwenden. Die Python-Version nutzt standardmäßig
   `RELAY_PORT=19350`; dieses Projekt `12345`. Nur ein Dienst darf denselben
   YouTube-Key gleichzeitig mit unterschiedlichen Inhalten bespielen.
3. `TIKTOK_SESSION_ID` und ggf. die bestehende `cookies.txt` übernehmen
   (`COOKIES_FILE=...`).
4. Erst den alten Dienst stoppen, dann den neuen starten und die Logs prüfen.

---

## Betrieb und Troubleshooting

- **EADDRINUSE:** Ein anderer Prozess nutzt `RELAY_PORT`/`RELAY_PORT+1` oder
  `SERVER_PORT`. Beim Umstieg von der Python-Version den alten Container
  stoppen (dort ist der Relay-Port standardmäßig `19350`).
- **yt-dlp 403/„not live“:** TikTok-Session-Cookie erneuern
  (`TIKTOK_SESSION_ID`), Handle prüfen. `yt-dlp -U` bzw. aktuelles Image nutzen.
- **„not live“, obwohl der Streamer live ist:** Einige TikTok-Lives sind
  login-/zugriffsgeschützt; yt-dlp erhält dann `status_code 4003110`. Der Service
  fällt automatisch auf die TikTok-Mobile-Live-API mit den Cookies aus
  `data/cookies.txt` zurück. Wenn auch das keine URL liefert: `TIKTOK_SESSION_ID`
  mit einer frischen Session eines Accounts setzen, der den Stream tatsächlich
  sehen darf (Follower/Sub/Age-Gate).
- **Kein Dashboard:** `npm run build:web` ausführen; im Docker-Build passiert das
  automatisch.
- **Hohe CPU:** `video_mode: copy` verwenden, Auflösung/FPS senken, andernfalls
  `preset: ultrafast`.
- **Kein Bild:** `GET /api/status` prüfen (`source.connected`, `relay.output_connected`,
  `sink.running`). ffmpeg-Logs im Dashboard unter „Logs“.
- **Overlays fehlen:** Im Docker-Image sind Fonts enthalten. Lokal
  `font-dejavu` installieren oder `OVERLAY_FONT=/pfad/zur/schrift.ttf` setzen.
- **Relay-Ports:** `12345` (Ingest) und `12346` (Playback) sind nur lokal
  gebunden und werden im Docker-Setup nicht nach außen veröffentlicht.
- **Logrotation:** Die Anwendung schreibt nach `logs/restreamer.log`. Für
  Dauerbetrieb `logrotate` (oder Docker-Log-Rotation) konfigurieren.

### Sicherheits-Checkliste

1. `DASHBOARD_PASSWORD` setzen, wenn der Port nicht nur lokal erreichbar ist.
2. Stream-Keys über Environment-Variablen, nicht ins Repository. Im Dashboard
   eingegebene Keys liegen in `config/streamers.yml` (Modus `0600`); für
   maximale Sicherheit ausschließlich `youtube_key_env` verwenden.
3. Reverse Proxy mit TLS; `SECURE_COOKIES=true` und `CORS_ORIGIN` nur bei Bedarf.
4. Relay-Ports nicht öffentlich exponieren.
5. Logs enthalten keine Keys (Redaction für Prozessausgaben und Pino-Felder).
6. Container läuft nach dem Entrypoint als UID/GID 1001, `no-new-privileges`.

---

## Abweichungen vom ursprünglichen Plan

Bewusste Entscheidungen, die den Betrieb vereinfachen:

- **YAML statt LowDB:** Streamer/Settings liegen in menschenlesbaren YAML-Dateien
  mit atomarem Schreiben. Eine zusätzliche File-DB hätte keinen Mehrwert und
  würde Konfiguration und Laufzeitzustand vermischen.
- **Canvas + drawtext:** Der Chat nutzt standardmäßig eine native
  Canvas-Engine mit transparentem `pipe:3`-Overlay; drawtext bleibt als
  leichtgewichtiger Fallback verfügbar. Uhr und Text bleiben drawtext-Filter.
- **Aktuelle Major-Versionen:** Fastify 5, Zod 4, Vue 3.5, Vite 7, Node 22 LTS.
- **Sink immer neu kodiert:** CBR mit Filler-Frames und monotonen Timestamps ist
  für YouTube robuster als `-c copy`, insbesondere nach Reconnects.
- **Playlist-Unterstützung und Auth** sind bereits enthalten, obwohl sie im
  Plan erst später vorgesehen waren.

## Lizenz

MIT – siehe [LICENSE](./LICENSE).
