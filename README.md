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
- **Auto-Reconnect** mit exponentiellem Backoff
- **Auto-Refresh** der TikTok-URL (Standard alle 20 Minuten)
- **Pausenscreen** bei Offline-Quelle, ohne die RTMP-Verbindung zu trennen
- **Overlays**: Uhrzeit, freier Text (inkl. Laufschrift), Chat (Textdatei +
  `drawtext`, ohne Encoder-Neustart)
- **Playlists** mit Auto-Advance, Wrap und Endzeit
- **Online-Status** über eine konfigurierbare JSON-API (z. B. TokTracker)
- **Web-Dashboard** (Vue 3) mit Live-Updates per SSE
- **Auth**: Passwort-Session-Cookie, Basic Auth und API-Token
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
│   ├── overlays/         drawtext-Filter, Chat, Pausenscreen
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
Umgebungsvariablen → CLI**.

Wichtige Umgebungsvariablen (vollständig in `.env.example`):

| Variable | Bedeutung | Default |
|---|---|---|
| `SERVER_HOST` / `SERVER_PORT` | HTTP-Server | `0.0.0.0` / `3000` |
| `DASHBOARD_PASSWORD` | Dashboard-Passwort (leer = kein Login) | – |
| `API_TOKEN` | Bearer-Token für Skripte/SSE | – |
| `SESSION_SECRET` | Cookie-Signatur | aus Passwort abgeleitet |
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
online:
  enabled: false
  source_url: ""
  api_key: ""
  interval: 60
chat:
  api_url: ""
  api_key: ""
```

---

## REST-API

Alle `/api`-Routen sind – sofern ein Passwort oder API-Token gesetzt ist –
geschützt. Login per `POST /api/auth/login` setzt ein signiertes HttpOnly-Cookie;
für Skripte eignet sich `Authorization: Bearer <API_TOKEN>` oder Basic Auth.

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| `POST` | `/api/auth/login` | `{ password }` → Session-Cookie |
| `POST` | `/api/auth/logout` | Session beenden |
| `GET` | `/api/auth/me` | Auth-Status |
| `GET` | `/api/streamers` | Streamer inkl. Status (ohne Keys) |
| `POST` | `/api/streamers` | Streamer anlegen |
| `PUT` | `/api/streamers/:id` | Streamer aktualisieren |
| `DELETE` | `/api/streamers/:id` | Streamer löschen |
| `POST` | `/api/streamers/:id/start` | Stream starten |
| `POST` | `/api/streamers/:id/stop` | Stream stoppen |
| `POST` | `/api/streamers/:id/switch` | Zu Streamer wechseln |
| `POST` | `/api/quickstart` | Handle + Key anlegen und starten |
| `GET` | `/api/status` | Vollständiger Systemstatus |
| `GET` | `/api/settings` | Einstellungen (Secrets redigiert) |
| `PUT` | `/api/settings` | Einstellungen speichern |
| `GET` | `/api/playlists` | Playlists |
| `POST` | `/api/playlists/:id/play` | Playlist starten |
| `POST` | `/api/playlists/next` | Nächster Eintrag |
| `POST` | `/api/playlists/stop` | Playlist stoppen |
| `POST` | `/api/pause/start` / `stop` | Pausenscreen an/aus |
| `GET` | `/api/logs?limit=200&level=warn&q=...` | Log-Ringpuffer |
| `DELETE` | `/api/logs` | Log-Ringpuffer leeren |
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

Overlays werden als `drawtext`-Filter in den Encoder gehängt. Chat und Text
liegen in Textdateien, die ffmpeg mit `reload=1` neu einliest – neue
Chat-Nachrichten erscheinen daher ohne Neustart der RTMP-Verbindung. Im
Docker-Image sind DejaVu Sans und Noto Emoji enthalten; Emoji werden je nach
Font als monochrome Glyphen dargestellt.

**Chat-API:** Es wird ein JSON-Endpunkt erwartet, der Nachrichten als Array
liefert (unter `messages`, `comments`, `chat`, `items`, `data` oder direkt).
Unterstützte Felder: `username`/`user`/`uniqueId`/`nickname` und
`comment`/`text`/`message`/`content`. `{handle}` in der URL wird durch den
TikTok-Handle ersetzt. Ein API-Key wird als `X-API-Key` und
`Authorization: Bearer` gesendet. Die genaue API hängt vom Anbieter ab; der
Parser ist bewusst tolerant. `delay = 0` bedeutet: Chat wird automatisch um die
Delay-Buffer-Größe verzögert, damit er zum leicht versetzten Videobild passt.

---

## Online-Monitor (TokTracker)

Der Live-Status kommt aus der TokTracker-Public-API:

```dotenv
ONLINE_CHECK_ENABLED=true
ONLINE_SOURCE_URL=https://positronium.dev/track/api/public/overview
ONLINE_SOURCE_API_KEY=dein-toktracker-key
ONLINE_CHECK_INTERVAL_SECONDS=60
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

---

## Playlists

Playlists referenzieren Streamer-IDs oder TikTok-Handles. Fehlt ein Streamer in
der Konfiguration, wird ein temporärer Eintrag mit den Standard-Overlays
erzeugt. `auto_advance` wechselt bei Offline-Quelle nach
`advance_delay_seconds`; `wrap` springt am Ende zum Anfang. Ein gemeinsamer
`youtube_key`/`youtube_key_env` auf Playlist-Ebene hält die YouTube-Verbindung
beim Wechsel offen. `end_after_minutes` beendet die Playlist nach der
angegebenen Zeit.

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
- **drawtext statt Canvas für Chat:** Keine native Canvas-Abhängigkeit, Updates
  ohne Encoder-Neustart. Emoji-Farbe ist dafür eingeschränkt; ein optionaler
  Canvas-/PNG-Pipeline-Modus ist als Erweiterung vorgesehen.
- **Aktuelle Major-Versionen:** Fastify 5, Zod 4, Vue 3.5, Vite 7, Node 22 LTS.
- **Sink immer neu kodiert:** CBR mit Filler-Frames und monotonen Timestamps ist
  für YouTube robuster als `-c copy`, insbesondere nach Reconnects.
- **Playlist-Unterstützung und Auth** sind bereits enthalten, obwohl sie im
  Plan erst später vorgesehen waren.

## Lizenz

MIT – siehe [LICENSE](./LICENSE).
