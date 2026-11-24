# AGENTS.md

Hinweise für AI-Agenten und Entwickler, die an RELAY arbeiten.

## Projekt

RELAY ist ein Node.js/TypeScript-Restreamer: TikTok-Live → interner MPEG-TS-Relay
→ ffmpeg-Sink → YouTube. Dazu gehört ein Vue-3-Dashboard im Cockpit-Stil (Elevation,
Radius 12/8/999, Cyan-Akzent).

Die produktive Instanz läuft unter **https://relay.positronium.dev**.

- Aktuelle Version: **0.35.1**
- Node.js **20.19+** (Docker nutzt Node 22 Alpine)
- Paketmanager: npm
- Sprache im Code: Englisch; UI-Texte und README: Deutsch

## Wichtige Befehle

```bash
npm ci
npm run dev            # Backend auf :3000
npm run dev:web        # Vite auf :5173
npm run check          # Typecheck + Vue-Typecheck + ESLint + Tests
npm run build          # Server + Web
npm test               # nur Vitest
npm run build:web      # nur Dashboard
```

Deployment (nativ/systemd):

```bash
git fetch --tags
sudo scripts/deploy.sh 0.8.0         # Release bauen, Symlink wechseln, Health-Check
sudo scripts/deploy.sh --rollback    # zurück auf die vorherige Version
sudo systemctl restart caddy         # nur bei Änderungen an der Caddyfile
curl -fsS https://relay.positronium.dev/health
journalctl -u relay -n 50 --no-pager
```

> **Release-Regel:** Sobald ein Git-Tag gepusht wurde, wird er niemals überschrieben oder per Force-Push verschoben. Jeder nachfolgende Fix wird immer als neuer Patch-Release (`x.x.1`, `x.x.2` etc.) gebumpt und neu getaggt.

## Architektur

```
TikTok → yt-dlp → TikTokSource (ffmpeg) → Relay/DelayBuffer
                                            ↓
                     PauseScreen oder Quelle → YouTubeSink (ffmpeg) → RTMP
```

Wichtige Pfade:

- `src/core/supervisor/supervisor.ts` – zentrale Zustandsmaschine, Start/Stop,
  Pause, Reconnect, Settings-Anwendung
- `src/core/supervisor/state-machine.ts` – explizite Zustandsübergänge
- `src/core/supervisor/playlist-controller.ts` – Playlist-Zustand, Timer,
  Kanalwahl und Auto-Advance
- `src/core/supervisor/queue-controller.ts` – persistente Regie-Queue
  (`data/queue.json`), synthetische Playlist `__regie__`
- `src/core/supervisor/reconnect-policy.ts` – Backoff-Berechnung
- `src/core/supervisor/pause-limit.ts` – Begrenzung automatischer Offline-Pausen
- `src/core/source/` – TikTok-Auflösung und Quell-ffmpeg
- `src/core/sink/` – YouTube-Sink
- `src/core/relay/` – MPEG-TS-Relay und DelayBuffer
- `src/core/media/` – lokale Playlist-Videos (`data/media/`) und ffprobe-Metadaten
- `src/api/routes/preview.ts` – MPEG-TS-Tap für die Live-Vorschau
- `src/core/overlays/` – Canvas-Chat, Logo-Engine, drawtext, PauseScreen,
  Studio-Preview, Overlay-Szenen (`data/scenes.json`)
- `src/core/scheduler/` – Zeitplan-Scheduler (`data/schedules.json`)
- `src/core/notifications/` – Alerting-Webhooks (`settings.webhooks`)
- `src/core/earnings/` – TokTracker-kompatibler Einnahmen-Monitor
- `src/core/telegram/` – Login-Bot und Token-Store
- `src/core/youtube/` – Google-OAuth, Token-Store und YouTube-API-Client
- `src/api/` – Fastify-Routen, Auth, SSE
- `src/web/src/` – Vue-Dashboard
- `assets/` – keine persönlichen Pause-/Stream-Assets im Repository
- `data/pause/` – lokale Pause-/Start-Assets (gitignored)
- `docs/ROADMAP.md` – priorisierter Plan und Issue-Übersicht
- `docs/issues/` – Issue-Texte + `scripts/create-issues.sh`
- `.github/workflows/create-roadmap-issues.yml` – legt Issues per Actions-Token an

## Laufzeit-Invarianten

- Der YouTube-Sink bleibt bei Quellenwechseln und Pausen bestehen. Quellen
  werden nur am Relay ausgetauscht.
- `video.encoder` (`auto`/`libx264`/`h264_qsv`/`h264_nvenc`/`h264_amf`, Default
  `auto`) gilt für Sink, Quellen-Re-Encoding und Pause-/Startbildschirm. Beim
  Start wird die ffmpeg-Encoder-Liste gelesen und jeder Hardware-Encoder mit
  einem kurzen Testencode inklusive der echten Laufzeit-Argumente geprüft
  (Treiber, Gerät, Optionssupport). `auto` wählt NVENC → QSV → AMF; ein nicht
  verfügbarer Encoder fällt auf `libx264` zurück (Warnung im Log). Presets
  werden auf die jeweilige Encoder-Skala abgebildet, Bitrate/GOP bleiben gleich.
- `video.tune` (`zerolatency`/`film`/`animation`/`off`, Default `zerolatency`)
  steuert den H.264-Tune des Sink-Encoders. `off` schaltet den Tune ab und erlaubt
  Lookahead und B-Frames für bessere Kompressionseffizienz bei gleicher Bitrate.
- `source.reencode` (`off`/`always`/`on_reconnect`, Default `on_reconnect`)
  steuert, ob die TikTok-Quelle re-encodiert statt `-c copy` läuft. Re-Encoding
  erzeugt bei jedem Verbindungsstart einen IDR-Keyframe, sodass der Sink keinen
  Mid-GOP-`decode_slice_header error` bekommt und YouTube nicht buffert.
  `on_reconnect` re-encodiert erst nach dem ersten Reconnect (CPU-schonend).
- Bei Quellenausfall startet nach `pause.grace_seconds` (Default 2 s) der
  Pausenscreen. Reconnect läuft weiter; bei Erfolg wird der Pausenscreen
  gestoppt.
- `pause.max_minutes` begrenzt die Pause (0 = unbegrenzt).
- Manuelle Screens (`/api/screens/:type/start`, `/api/screens/stop`) können
  Startbildschirm oder Pausenscreen jederzeit einspielen und unbegrenzt halten,
  auch ohne aktiven Streamer (Idle-Zustand). Dann wird der Stream-Key des
  bevorzugten/ersten aktivierten Streamers genutzt, sonst `YOUTUBE_STREAM_KEY`;
  `pause.max_minutes` gilt nur für automatische Offline-Pausen.
- Bevorzugte Streamer (`preferred`) und Auto-Start-Kandidaten werden über
  `priority` geordnet (kleinere Zahl gewinnt). Ein automatischer Wechsel zum
  bevorzugten Streamer merkt sich den vorherigen Streamer bzw. die Playlist
  inklusive Index; endet der bevorzugte Stream, wird das vorherige Ziel
  wiederhergestellt. Solange der Streamer weiter live ist, laufen normale
  Reconnects weiter.
- Online-Monitor (`settings.online.provider`): `external` pollt `source_url`
  (z. B. TokTracker-Overview), `tiktok` prüft alle aktivierten Streamer direkt
  über `api-live/user/room` (Cookies aus `data/cookies.txt`, max. 4 parallel,
  8-s-Timeout, Prüfintervall ≥ 10 s). `settings.online.account_id` wählt das
  TikTok-Konto, dessen Session-Cookie für die Checks dient (leer = aktives
  Konto/`data/cookies.txt`; unbekannte ID fällt auf die Cookie-Datei zurück).
  Fehlgeschlagene Checks behalten den letzten Status; unbekannte/umbenannte
  Handles gelten als „unbekannt“ (kein Offline).
- Der Startbildschirm (`startup`) läuft nur beim Start aus dem Idle-Zustand für
  `startup.duration_seconds`; danach übernimmt die Quelle ohne RTMP-Neuaufbau.
  Er nutzt dieselben Asset-Formate und Uploads wie der Pausenscreen.
- Der Pausenscreen kann ein eigenes Hintergrundbild/-video und einen eigenen Font
  nutzen. Statische SVGs werden mit Skia zu PNG gerastert; animierte SVGs werden
  nur als statisches Bild dargestellt (für Animation WebM/GIF/MP4 verwenden).
  `pause.fit=stretch` füllt die Ausgabeauflösung ohne Beschnitt.
  Uploads laufen über `POST /api/pause/assets` (max. 50 MB, Magic-Byte-Prüfung).
- Der Quell-Raten-Watchdog benötigt 30 s Warmup, ein 10-s-Fenster und drei
  aufeinanderfolgende schlechte Messungen. Das verhindert Fehlstarts kurz nach
  dem Verbindungsaufbau.
- Eine niedrige Quell-Bitrate ist nur eine Warnung (max. einmal pro Minute) und
  startet die Quelle nicht neu. Ein Neustart erfolgt erst bei echtem
  Daten-Stall; so entstehen keine Pausen-/Reconnect-Schleifen bei kleinen
  Streams.
- Playlist-Einträge mit `file:` verweisen auf `data/media/`; lokale Videos werden
  einmalig mit `-re` abgespielt und schalten am Dateiende weiter. Der Sink bleibt
  bestehen; echte Streamer-Einträge funktionieren unverändert.
- Die Regie-Queue (`data/queue.json`, 0600) ist eine persistente, live
  editierbare Warteschlange aus `file:`-Videos, Streamer-IDs und
  `screen:pause`/`screen:startup`. Sie nutzt denselben `PlaylistController`
  über die synthetische Playlist `__regie__`; Videos verwenden den aktuellen
  Sink-Key. Live-Änderungen halten den laufenden Eintrag fest; wird er
  entfernt, stoppt die Wiedergabe. Nach einem Neustart bleibt nur der Inhalt
  erhalten, nicht die Wiedergabe.
- Lokale Videos zeigen im Sink einen drawtext-Countdown („Noch MM:SS", ab
  einer Stunde H:MM:SS) aus der ffprobe-Dauer (`remainingTimeFilter`). Er wird
  nur im `startFileLocked`-Pfad angehängt, also nie bei Streamern oder
  Screens; fehlt die Dauer oder ein Font, entfällt der Countdown.
- Die Live-Vorschau (`GET /api/preview.ts`) ist ein Read-only-Tap am Relay und
  darf den Sink nicht beeinflussen; pro Client wird bei Rückstau getrennt.
- DelayBuffer-Timestamps müssen monoton bleiben; `nextProducerOffset()` beachten.
- Der `DelayBuffer` glättet Bursts auf ~150 ms, aggregiert Durchsatzmessungen auf
  1-Sekunden-Buckets in O(60) statt per-Entry-Iteration und baut überschüssige Puffer-Latenz
  (ab >0,5 s über Ziel-Delay bzw. >0,25 s bei `delay=0`) mit `delay_buffer.catchup_rate`
  (Default `1.01`, Env `DELAY_CATCHUP_RATE`) ab; Chat-Canvas läuft mit +5 % Taktreserve.
  Das Logo-Overlay (`settings.overlays.logo`) schreibt seine statischen Frames einmalig
  und schließt die Pipe, da ffmpeg `eof_action=repeat:repeatlast=1` nutzt und keine dauerhaften
  Pipe-Writes erfordert.
- Status-Snapshot-Optimierung: Der 2-s-Status-Timer baut und emittiert Snapshots nur,
  wenn mindestens ein Dashboard verbunden ist (`bus.hasObservers()`); bei Verbindungsaufbau
  sendet die Route sofort einen initialen Snapshot.
- Tab-Pausierung & Preview-Caching: Dashboard-Timer (Preview, Chat-Analytics, Media, Diagnose)
  pausieren bei `document.hidden` und aktualisieren sofort bei Rückkehr (`visibilitychange`).
  `/api/overlays/preview.png` liefert `ETag` und antwortet bei unverändertem Stand mit `304 Not Modified`.
- Haupt-Logfile-Rotation: Das primäre Logfile (`logs/relay.log`) wird im Code per
  `RotatingFileStream` bei Überschreitung von `settings.logging.log_file_mb` (Default 20 MB,
  Env `LOG_FILE_MB`) zu `relay-<n>.log` rotiert (begrenzt auf `settings.logging.log_files`,
  Default 5, Env `LOG_FILES`). Re-Open wird zusätzlich per `SIGUSR1` unterstützt.
  `readLogFileEntries` liest bei Bedarf über Rotationsgrenzen hinweg.
- Request-Pfad & Async-I/O: Recordings-API (`listRecordingsAsync`, `stat`, `unlink`) und
  Audit-Log laufen vollständig asynchron über Promises; Audit-Log garantiert strikte
  FIFO-Reihenfolge. Im Canvas-Modus entfällt das Schreiben von `chat.txt`. Disk-Checks
  (`statfs`) werden 15 s gecacht.
- YouTube-Sink-Stabilisierung: striktes CFR (`-fps_mode cfr`), 2-s-IDR-Keyframes
  (`-force_key_frames "expr:gte(t,n_forced*2)"`, NVENC `-forced-idr`/`-strict_gop`,
  x264 `nal-hrd=cbr:filler=1:force-cfr=1:aud=1`), weiches Audio-Resampling
  (`aresample=async=1000:min_comp=0.01:min_hard_comp=0.2`),
  `-avoid_negative_ts make_zero`, `-max_interleave_delta 0` (ohne
  Interleaving-Puffer; bei Live-MPEG-TS mit leicht versetztem Audio bricht der
  FLV-Muxer in ffmpeg 8 sonst mit „failed to avoid negative timestamp“ ab)
  und RTMP-Ausgabe mit
  `-tcp_nodelay 1 -rw_timeout 15000000`; gehäufte DTS-Fehler (≥ 10 in 15 s) triggern
  einen kontrollierten Sink-Neustart.
- Bei aktivem DelayBuffer wird der YouTube-Sink erst nach dem Prefill gestartet
  (`startSinkOrPrefillLocked`, `sinkStarting`), damit YouTube beim Kaltstart
  sofort Medien statt Stille erhält.
- Overlay-Änderungen am aktiven Stream bauen Sink/Chat-Engine bewusst neu auf.
  Das ist ein kurzer, kontrollierter Reconnect.
- Zuschauerzahl: Das Chat-Overlay startet den `WebcastLiveRoomClient`.
  `roomUser.total` ist der aktuelle Stand (`totalUser` ist kumuliert, `viewerCount`
  fehlt in tiktok-live-connector 2.5). Der Wert liegt als `status.chat.viewers`
  (Zahl oder `null`) im Status-Snapshot und speist die Cockpit-Kennzahl.
  Der 15-s-Poll von
  `api-live/user/room` muss die Cookies aus `data/cookies.txt` mitsenden, sonst
  antwortet TikTok mit einem Stub (`userCount: 0`, leerer Titel) und überschreibt
  die echten Werte; bei frischen WebSocket-Events hat der Socket Vorrang.
- Das globale Video-Layout (`video.layout`) skaliert und positioniert das
  Relay-Bild im Sink per `scale`/`crop`/`pad`. 100 % ist das eingepasste Bild,
  über 100 % wird gezoomt und beschnitten. Es gilt global für Live-Quelle,
  Pause-/Startbildschirm und lokale Videos; Änderungen starten den Sink neu.
  Das Overlay-Studio zeigt dafür ein schematisches Quellformat (9:16/16:9/1:1).
- Audio-Verarbeitung im Sink (`settings.audio`): `normalize` (`off`/
  `dynaudnorm`/`loudnorm`), `gain_db` und optional `silencedetect`
  (`silence_detect`, Schwelle/Dauer). Bei `loudnorm` verhindert ein
  vorgeschaltetes `dcshift=0.00001` samt nachgelagertem `aresample` AAC-NaN-
  Fehler auf digitaler Stille; bei aktivem `silence_detect` hebt `buildSinkCommand`
  `-loglevel` auf `info`, damit `[silencedetect]`-Events geloggt und gezählt
  werden (`sink_silence_events_total`).
- Overlay-Szenen (`data/scenes.json`, Modus `0600`) speichern komplette
  `overlays`- und `video.layout`-Snapshots unter einem Namen (ohne
  `overlays.chat.api_key`). Aktivierung (`/api/scenes/:id/activate` oder
  Telegram `/scene`) übernimmt Overlays + Layout atomar; direkte Änderungen an
  Overlays oder Video-Layout lösen `active_scene_id` auf.
- Der Zeitplan-Scheduler (`data/schedules.json`, Modus `0600`) wertet aktive
  Regeln (`days`, `HH:MM`, IANA-Zeitzone wie `Europe/Berlin`) minütlich einmalig
  aus (`start_streamer`, `start_playlist`, `start_queue`, `start_screen`, `stop`).
- `GET /api/metrics?format=prometheus` (oder `Accept: text/plain`) liefert alle
  Zähler plus Live-Status im Prometheus-/OpenMetrics-Textformat.
- Alerting-Webhooks (`settings.webhooks`, `POST /api/webhooks/test`) versenden
  Discord-, Slack- oder Generic-JSON-Payloads mit 5-s-Timeout, optionaler
  HMAC-Signatur (`x-relay-signature`) und Event-Cooldown völlig fehlerisoliert
  (`webhook_errors_total`).

## Konfiguration und Persistenz

Priorität:

```
Defaults → streamers.yml (settings) → settings.yml → .env (nur fehlende Keys) → CLI
```

- Dashboard-Werte in `config/settings.yml` gewinnen standardmäßig gegen `.env`.
- `SETTINGS_ENV_OVERRIDES=true` stellt die alte Priorität wieder her: `.env`
  überschreibt `settings.yml` bei jedem Start.
- `config/settings.yml` wird atomar mit Modus `0600` geschrieben.
- Secrets werden in API-Antworten durch `api_key_set` (bzw. `global_youtube_key_set`, `stream_key_set`) ersetzt.
- `settings.streaming.global_youtube_key` und `settings.streaming.global_key_enabled`
  ermöglichen einen zentralen YouTube-Stream-Key: Ist `global_key_enabled=true` und
  ein Key hinterlegt, überschreibt `resolveStreamKey` alle individuellen
  Streamer-Keys (`source: 'global'`); ist der Schalter aus, dient ein gesetzter
  globaler Key als Fallback für Streamer ohne eigenen Key (vor `YOUTUBE_STREAM_KEY`).
  Editierbar sowohl auf dem YouTube-Tab (`YouTubeView.vue`) als auch in den
  Einstellungen (`SettingsTitleCard.vue`).
- Overlays (`chat`, `clock`, `text`, `logo`) sind **global** in `settings.yml`.
- Das Logo-Overlay (`settings.overlays.logo`) läuft als eigener Canvas-Stream
  (zweite rawvideo-Pipe, fd 4) durch den Sink; Position/Breite/Deckkraft werden
  im Overlay-Studio gesetzt. Das Asset ist `web/dist/logo.png` (aus
  `src/web/public`); Änderungen starten den Sink neu.
- Die Sink-Pipes sind fest verdrahtet: fd 3 für den Chat, fd 4 für das Logo.
  Auch wenn nur eines der Overlays aktiv ist, bleiben beide Deskriptoren
  stabil; sonst liest ffmpeg das Logo von fd 3, während die Engine auf fd 4
  schreibt, und der Sink stallt.
- Fehlt `settings.overlays`, werden beim ersten Start die Overlays des ersten
  Streamers mit aktivem Overlay übernommen und persistiert.
- Per-Streamer-Overlays aus Alt-YAMLs werden beim Laden ignoriert und aus der
  Streamer-Datei entfernt; es gilt ausschließlich `settings.overlays`.
- Overlay-Studio speichert über `PUT /api/overlays`; Einnahmen und restliche
  Einstellungen über `PUT /api/settings`.

## Einnahmen

- Quelle ist TokTracker-kompatibles JSON (Übersicht, Detail oder Liste).
- Unterstützt Zeiträume `today`, `24h`, `7d`, `30d`, `all`.
- Ansichten: `compact`, `standard`, `detailed`.
- Verlauf liegt in `data/earnings-history.json` (nur Aggregate, 90 Tage,
  max. 4000 Punkte); Dashboard zeigt Chart, Delta und Veraltet-Hinweis.
- Einnahmen-Overlay wird im Overlay-Studio bearbeitet (mehrzeiliges Template,
  Position, Offsets, Farben, Margin, Box); Einstellungen enthalten nur
  Quelle/Zeitraum/View.
- Zeitraum-Schnellwahl im Dashboard nutzt `POST /api/earnings/period`.
- Fehlende Geldwerte werden aus `total_coins` und `rates` berechnet.
- Bei temporären Fehlern bleiben letzte Werte sichtbar; fehlende Streamer
  liefern `status: "missing"`.
- API: `GET /api/earnings`, `POST /api/earnings/refresh`.

## Regie-Queue

- Persistenz: `data/queue.json` (0600, atomar); der Inhalt überlebt Neustarts,
  die Wiedergabe wird nicht automatisch fortgesetzt.
- Einträge: `file:<datei>` (muss in `data/media/` existieren), Streamer-ID
  (muss existieren) oder `screen:pause` / `screen:startup`.
- Live bearbeitbar: Hinzufügen/Entfernen/Verschieben während der Wiedergabe;
  der laufende Eintrag bleibt per ID gepinnt. Wird der laufende Eintrag
  entfernt, stoppt die Wiedergabe.
- `POST /api/queue/now` schiebt einen Eintrag direkt hinter den laufenden und
  springt dorthin („Sofort abspielen"); ohne aktive Queue wird er vorne
  eingefügt und abgespielt.
- Seek: `POST /api/queue/seek { seconds }` startet das laufende lokale Video
  an der Position neu (`-ss` vor dem Input; der Sink wird dabei neu aufgebaut).
  Der Countdown berücksichtigt den Seek-Offset.
- Resume: Die Position des aktiven Queue-Videos wird alle 10 s sowie bei
  Start/Seek/Shutdown in `data/queue.json` (`playback`) gespeichert. Nach einem
  Neustart setzt der Supervisor das Video nach ~2,5 s an dieser Stelle fort,
  sofern die App noch idle ist, die Datei existiert und das Video nicht bereits
  beendet war. Ein manueller Stopp löscht den Stand.
- API: `GET /api/queue`, `POST /api/queue/entries`,
  `DELETE /api/queue/entries/:id`, `POST /api/queue/move`,
  `DELETE /api/queue`, `POST /api/queue/play|previous|next|stop|now|seek`.
- **Zentrale Abspielsteuerung (#94):** `PlaybackService` (read-only) leitet aus
  Queue, Playlist, Einzelquelle und Screens **einen** Zustand ab
  (`source`, `current`, `next`, `paused`, `position`, `loop`) und wird als
  `GET /api/playback` plus SSE-Event `playback` ausgeliefert. Der Transport
  läuft über `POST /api/playback/{play,pause,resume,stop,next,previous}`,
  `/seek`, `/loop` und `/queue-now`; er delegiert an die bestehenden Controller,
  `/api/queue/*` und `/api/playlists/*` bleiben als Aliase. „Pause“ zeigt den
  Pausenscreen, behält aber den aktiven Queue-/Playlist-Eintrag als `current`
  (Transport setzt dort fort). Der Cockpit-Transport (`PlaybackTransport.vue`)
  ist die einzige Weiter/Zurück-Steuerung im UI.
- **Hold & Historie (#94):** `POST /api/playback/hold` friert die Wiedergabe
  ein (Pausenscreen, `PlaylistController.hold()` stoppt Auto-Advance, Eintrag
  bleibt), `/release` bzw. `/resume` setzt fort. Die letzten 20 gestarteten
  Queue-Einträge liegen in `data/queue.json` (`history`, neueste zuerst,
  Duplikate in Folge werden zusammengefasst) und sind über
  `GET /api/queue/history` bzw. „Zuletzt gespielt“ in der Queue-Karte
  erreichbar. Telegram `/queue` hat Zurück und Hold, der Scheduler kennt die
  Aktion `playback` mit Ziel (`queue`, `playlist:<id>`, `streamer:<id>`,
  `screen:<pause|startup>`).
- **Queue als App-Spielfläche (#94):** Die Regie-Queue steht im Cockpit direkt
  unter Transport/Action-Zeile und läuft über die volle Breite; darunter folgen
  Vorschau und Kennzahlen. Transport-Aktionen (Play/Pause, Vor/Zurück, Stopp,
  Loop, Hold) liegen ausschließlich in `PlaybackTransport.vue`, die Karte hat
  nur noch Liste, Hinzufügen, Reihenfolge, „Zuletzt gespielt" und Leeren.
  Queue-Zeilen zeigen `deaktiviert`/`kein Key`/`unbekannt`; beim Abspielen wird
  ein deaktivierter Streamer automatisch aktiviert, ein fehlender YouTube-Key
  bricht mit Fehlermeldung ab statt still zu überspringen.
- **Loop & Einreihen (#94):** `data/queue.json` speichert `loop_mode`
  (`off`/`all`/`one`, Version 3; alte `loop`-Booleans werden beim Laden
  migriert). `one` startet den laufenden Eintrag neu (`repeatCurrent` im
  PlaylistController). Einreihen läuft über `POST /api/playback/enqueue`
  (`mode: now|next|end`); `POST /api/playback/queue-from-playlist` kopiert eine
  Playlist in die Queue (`replace|append`).
- Dashboard-Karte `RegieQueue.vue`; das SSE-Event `queue` hält den Stand aktuell.

## Stream Discovery (Eigene Webcast-Implementierung)

- Eigene, aus dem TikTok-Web-Bundle (`webapp-live-discover`) analysierte
  Implementierung unter `src/core/source/discovery/` ohne externe Scraper-Dependencies:
  - **Trending (`LivePageProvider`):** Da `https://www.tiktok.com/live` im
    Initial-HTML (SSR `__UNIVERSAL_DATA_FOR_REHYDRATION__`) keine Live-Räume mehr
    ausliefert, fragt `LivePageProvider` parallel die internen Webcast-Feeds
    `https://webcast.tiktok.com/webcast/feed/` über die Channels
    `Recommend` (`channel_id=87`, `req_from=live_mt_pc_web_rec_tab_refresh`),
    `Gaming` (`channel_id=89`, `req_from=pc_web_game_feed_refresh`) und
    `Vertical/Chatting` (`channel_id=1222001`, `req_from=webapp_taxonomy_drawer_enter_feed`,
    `related_live_tag=chatting`) inklusive vollständiger Web-Client-Parameter
    (`buildWebcastFeedUrl`) ab. SSR-HTML bleibt als Fallback erhalten.
  - **Keyword- & Freitext-Suche (`SearchProvider`):** Nutzt den Webcast-SEO-Feed
    (`https://webcast.tiktok.com/webcast/feed/` mit `channel_id=86`,
    `req_from=pc_web_seo_query_room`, `search_keywords=<q>`, `need_room_count`,
    `last_page=0`) für echte Live-Raum-Suchen nach beliebigen Begriffen
    (z. B. `gaming`, `musik`, `talk`, `deutsch`, `fortnite`, `kochen`) sowie
    `/api/comment/search/sug/user/` als Profil-Fallback.
  - **Handle- vs. Begriff-Disambiguierung (`DiscoveryService`, `RoomInfoProvider`):**
    Einzelwörter ohne `@` werden primär als Schlagwortsuche behandelt; ein
    direkter Raum-Check (`api-live/user/room` mit `aid=1988&sourceType=54`)
    wird bei Suchbegriffen ohne `@` nur vorangestellt, wenn der Account
    tatsächlich **live** ist (verhindert, dass inaktive Offline-Accounts wie
    `@gaming` die Schlagwortsuche überdecken). Mit explizitem `@handle` wird das
    Nutzerprofil auch im Offline-Zustand an Position 1 geliefert.
  - **Protobuf-/Webcast-Besonderheiten (`extractHitFromRoomRecord`):**
    - `age_restricted` ist im Webcast-JSON ein Objekt (`{}` bei normalen Streams,
      `{ restricted: true, age_interval: 4 }` bei 18+); `isAgeRestrictedValue`
      prüft gezielt die Flags statt `Boolean({})`.
    - Handles liegen unter `owner.display_id` (bzw. `uniqueId`/`unique_id`),
      Avatare unter `owner.avatar_large.url_list[0]`.
    - Bei `0` Zuschauern lässt Protobuf `user_count` weg; existiert `room.stats`
      bei `status === 2`, wird `viewers: 0` gesetzt.
  - **Guards:** `addStreamer` legt entdeckte Kanäle immer deaktiviert an
    (`enabled: false, priority: 999, source: 'discovery'`). `queueNow` und
    `switchToStreamer` erzwingen einen frischen Live-Check (`409 Conflict` bei Offline).
  - **TikTok Live-Zapper (`GET /api/discovery/preview/:handle`, `DiscoveryView.vue`):**
    Aus den Webcast-Antworten (`stream_url.flv_pull_url` bzw. `live_core_sdk_data`)
    werden signierte HTTP-FLV-URLs extrahiert, gegen TikTok-CDN-Domains
    (`isAllowedTikTokStreamUrl`, SSRF-Schutz) geprüft und über
    `GET /api/discovery/preview/:handle` ohne Re-Encoding (0 % CPU, reiner
    Bytestream-Passthrough mit sofortigem `AbortController`-Cleanup beim
    Umschalten) an `mpegts.js` (`type: 'flv'`) im Dashboard-Zapper gestreamt.
    Mit den Pfeil-Buttons rechts (`▲` / `▼`) oder Pfeiltasten (`ArrowUp` / `Down`,
    zusätzlich `←` / `→`) wird durch die Live-Räume gezappt; am Listenende lädt
    `page` automatisch weitere Räume nach (Infinite Feed).
  - **Discovery-Panel (#92):** Discovery liegt als schwebendes Panel über dem
    Cockpit (`components/discovery/DiscoveryPanel.vue`): ab 1280 px schiebt es
    das Grid (Widgets wandern unter die Queue), 960–1279 px überlagert es die
    Widgets-Spalte, darunter wird es ein Bottom-Sheet. Inhalt und Hülle sind
    getrennt (`DiscoveryWorkspace.vue` vs. Panel), damit später ein frei
    schwebendes Fenster denselben Workspace hosten kann. Öffnen über `D`,
    Header-Suche, Action-Registry (`discovery.open`, `discovery.zapper`) und die
    Cockpit-Karte; `Esc` geht Zapper → Liste → zu. Zustand in
    `useDiscoveryFeed`/`useDiscoveryPanel` (Modul-Singletons), Filter und
    Sortierung in `utils/discovery-filter.ts`. Zapper-Shortcuts: `Space` Ton,
    `S` umschalten, `Q` Queue, `A` speichern, `F` Vollbild, `?` Hilfe.
  - **Discovery-API (#92):** `GET /api/discovery/suggest` (5-s-Cache) und
    `GET /api/discovery/status` (Batch, ≤ 20 Handles, 30-s-Cache); unbekannte
    Handles liefern `unknown`, nie `offline`. `preview?fallback=1` antwortet mit
    `204` statt `404`, damit der Zapper ohne Fehlerbild weiterzappt.

## YouTube-Verwaltung

- Ein Google-Konto pro Instanz; Token-Datei `data/youtube-auth.json` (Modus
  `0600`, Klartext), automatischer Refresh 60 s vor Ablauf.
- Broadcast-Listen werden 20 s gecacht; Ingest-Keys aus `liveStreams` werden
  nie ausgeliefert.
- OAuth nutzt State + PKCE (S256), State ist einmalig und 10 Minuten gültig.
- `GET /api/youtube/oauth/callback` ist der einzige unauthentifizierte
  API-Endpunkt; Schutz erfolgt über State/PKCE, nicht über das Cookie.
- Tokens und Client-Secret erscheinen nie in API-Antworten, Logs oder
  Fehlermeldungen; `GOOGLE_CLIENT_SECRET` ist im Redactor registriert.
- `invalid_grant` beim Refresh löscht die Verbindung und verlangt erneutes
  Verbinden (`youtube_reconnect_required`).
- Auto-Transition läuft über `SupervisorDeps.youtube` als best-effort Hook:
  Der Start erfolgt erst nach dem Sink-Start, nur für Broadcasts aus der
  RELAY-Registry (`data/youtube-broadcasts.json`) und nur ±30 Minuten um die
  geplante Zeit; ein vollständiger Stop beendet nur RELAY-Broadcasts.
  Studio-/Quick-Live-Broadcasts bleiben unberührt. Fehler dürfen den Stream
  nie beeinflussen.
- Die Automatik ist über `settings.youtube` (`auto_transition`, `auto_mode`,
  `auto_start`, `auto_stop`) und `YOUTUBE_*`-Env abschaltbar; `auto_mode`
  kennt `off`, `relay_only` (Default) und `all`. Request-Werte (`privacy`,
  `enable_dvr`) überschreiben nur den jeweiligen Broadcast. Auswahllogik in
  `src/core/youtube/automation.ts`, inklusive Override-Resolver pro Broadcast.
- `settings.youtube.rtmp_url` wählt den YouTube-Ingest-Endpoint des Sinks
  (Dropdown „RTMP-Endpoint" in „YouTube-Titel & Globaler Stream-Key"): leer =
  Env-Default (`YOUTUBE_RTMP_URL`, sonst `rtmp://a.rtmp.youtube.com/live2`),
  alternativ das Backup-Ingest oder eine eigene `rtmp(s)://`-URL. Ungültige
  Schemata lehnt das Schema ab; ein Wechsel startet den YouTube-Sink neu
  (`diffSettings.youtubeRtmpChanged`).
- Beim Anlegen mit Streamer wird der Ingest über den Stream-Key gesucht und
  gebunden; der Key wird nie an die API-Antwort oder ins Log gegeben.
- App muss für Dauerbetrieb in Google Cloud `In production` sein; `Testing`
  läuft nach 7 Tagen ab. Setup: `docs/YOUTUBE.md`.

## Auth und Sicherheit

- Passwort-/API-Token-Auth und Telegram-Login können parallel aktiv sein.
- Telegram-Bot nutzt Long-Polling, nur private Chats von numerischen IDs aus
  `TELEGRAM_ALLOWED_USER_IDS`.
- Login-Token sind einmalig und 10 Minuten gültig; Session-Cookie ist signiert,
  HttpOnly, `SameSite=Lax`, 30 Tage.
- Sessions liegen serverseitig in `data/sessions.json` (0600) und sind
  widerrufbar; `data/` bleibt aus Git ausgeschlossen.
- Bei HTTPS zwingend `SECURE_COOKIES=true`.
- Cookie-Auth benötigt bei schreibenden Requests einen passenden
  `Origin`/`Referer`; API-Token und Basic Auth sind ausgenommen. Tokens werden
  nicht als Query-Parameter akzeptiert.
- `TRUST_PROXY=true` nur hinter einem vertrauenswürdigen Reverse-Proxy setzen.
- Bot-Token niemals loggen oder committen.
- Der Bot steuert Status, Start/Stop, Senderwechsel, Playlist und Logs; die
  Benachrichtigungsschalter liegen in `data/telegram-notify.json`.
- Derselbe Bot-Token darf nicht parallel in alter Python-App und RELAY laufen
  (`getUpdates`-Konflikt).
- Destruktive Bot-Aktionen (`/stop`, Session-Widerruf, YouTube-Status) laufen
  über `ConfirmationStore`: Nonce 60 s gültig, einmalig, an Chat + User
  gebunden.
- Inline-Buttons tragen nie rohe lange IDs, sondern Refs aus `RefStore`
  (Telegram-Callback-Limit 64 Byte). Mehrstufige Eingaben laufen über
  `ConversationStore` (5 min, pro Chat/User, `abbrechen` bricht ab).

## Deployment

- RELAY läuft **nativ** als systemd-Dienst `relay.service` unter dem User `relay`
  (kein App-Container mehr). Die Unit-Quelle liegt im Repo unter
  `systemd/relay.service`; Installation per
  `sudo install systemd/relay.service /etc/systemd/system/relay.service`.
  Die Sandbox muss `AF_NETLINK` erlauben (`RestrictAddressFamilies`): glibc
  `getifaddrs()` – genutzt von `os.networkInterfaces()` und damit von Fastify
  beim Start – öffnet einen Netlink-Socket. Fehlt die Familie, bricht der Start
  mit `ERR_SYSTEM_ERROR: uv_interface_addresses … error 97` in einer
  Restart-Schleife ab.
  `RestrictSUIDSGID=true` darf **nicht** gesetzt werden: Der seccomp-Filter
  beantwortet `openat2` mit `ENOSYS`, woran GNU tar beim Entpacken von
  Backups scheitert (`Cannot open: Function not implemented`). Der Dienst
  läuft unprivilegiert mit `NoNewPrivileges=true` und leerem
  `CapabilityBoundingSet`, daher entfällt kein relevanter Schutz.
- **Erstinrichtung** auf einem frischen Host über `sudo scripts/bootstrap.sh`
  (generisch, keine Instanz-Defaults): Module `user,deps,dirs,systemd,env,release`
  per Default, `--modules a,b` zur Auswahl, `--caddy` zusätzlich mit zwingendem
  `--domain <domain>` (optional `--web-domain`). Das Skript ist idempotent und
  unterstützt `--dry-run` (Vorschau, auch ohne root). Es legt Systemuser,
  prüft/installiert `ffmpeg`, `yt-dlp` und die Overlay-Schriften
  (`fonts-noto-color-emoji`, `fonts-noto-core`, `fonts-noto-cjk`, `fonts-symbola`;
  apt bzw. dnf/EPEL; fehlende Pakete werden nur gewarnt, nicht abgebrochen), Layout, Unit, `/etc/relay.env` (0600, absolute Pfade; ohne `--force` wird eine
  vorhandene Datei nicht angetastet) und optional eine minimale Caddyfile an
  und deployt das erste Release via `deploy.sh` inkl. Health-Check.
  Alternativ zum Caddy-Modul gibt es `--nginx` (Modul `nginx`): Für nativen
  nginx wird ein Vhost (`sites-available` bzw. `conf.d`, mit `proxy_buffering
  off` für SSE, `client_max_body_size 64m` für Asset-Uploads) geschrieben und
  nginx neu geladen; läuft ein Docker-Reverse-Proxy auf 80/443 (erkennbar an
  `docker ps` bzw. `docker-proxy`), wird nichts geschrieben und stattdessen
  ein Vhost-Snippet samt Hinweis auf den Host-Upstream (172.17.0.1 bzw.
  host-gateway) ausgegeben. Für Docker-Betrieb gibt es `--docker-nginx`
  (Modul `docker-nginx`): Ein eigener `relay-nginx`-Container
  (`nginx:stable`, `--network host`, `--restart unless-stopped`) bekommt den
  Vhost von `/etc/relay-nginx/conf.d/relay.conf` (read-only Mount) und
  erreicht RELAY über `127.0.0.1:3000` unabhängig von `SERVER_HOST`; ein
  laufender Legacy-`nginx-proxy` oder fremder nginx-Container wird erkannt
  und nur angeleitet, ein gestoppter eigener Container wird gestartet, und
  bei belegtem Port 80 (z. B. Caddy) unterbleibt der Start mit Warnung.
  Mit `--nginx-container <name>` injiziert das Modul den Vhost stattdessen
  in einen bestehenden nginx-Container: Existiert ein bind-Mount nach
  `/etc/nginx/conf.d`, wird `relay.conf` direkt im Host-Verzeichnis des
  Mounts abgelegt, sonst per `docker cp` (flüchtig bei Neuerstellung; die
  Container-`nginx.conf` muss `conf.d/*.conf` einbinden). Der Upstream
  richtet sich nach dem Netzwerk-Modus des Ziels: `host` → `127.0.0.1`,
  Bridge → Gateway des Containers (Host-Seite, dann muss RELAY auf allen
  Interfaces lauschen). Abschluss immer mit `docker exec … nginx -t` und
  Reload; Legacy-`nginx-proxy` bleibt Anleitung-only, gestoppte oder
  fehlende Ziele werden übersprungen.
  Distro-Pfade via `--distro centos|ubuntu`: Ohne Flag wird die Familie über
  `/etc/os-release` erkannt (Ubuntu/Debian → `ubuntu`, RHEL-Familie →
  `centos`, unbekannt → `centos`); passt ein explizites Flag nicht zur
  Erkennung, gibt es eine Warnung. Der Pfad steuert das nginx-Vhost-Layout
  (Ubuntu: `sites-available`/`sites-enabled` mit Symlink, CentOS: `conf.d`),
  einen SELinux-Hinweis (`httpd_can_network_connect`) bei Enforcing auf
  CentOS sowie die Firewall-Hinweise am Ende (CentOS: firewalld, Ubuntu: ufw).
- **Layout:** Code in versionierten Release-Verzeichnissen
  `/srv/relay/releases/<version>/`, aktiv über Symlink `/srv/relay/current`.
  Laufzeit-Daten liegen getrennt in `/srv/relay/{config,data,logs}`
  (`relay:relay`), Secrets/Env in `/etc/relay.env` (0600).
  In `/etc/relay.env` müssen `CONFIG_DIR`, `DATA_DIR`, `LOGS_DIR`,
  `STREAMERS_FILE`, `SETTINGS_FILE` und `COOKIES_FILE` **absolut** gesetzt sein,
  sonst sucht die App sie relativ zu `current` (Fehler beim Start).
- **Deploy** über `sudo scripts/deploy.sh <version>`: baut aus einem Git-Tag
  (`git archive`) ein sauberes Release, wechselt den Symlink atomar, startet den
  Dienst neu und prüft `/health`; bei Fehlschlag wird automatisch zurückgerollt.
  `--rollback` wechselt auf die vorherige Version.
- **TLS/Reverse-Proxy:** Caddy auf dem Host (`/etc/caddy/Caddyfile`), automatisches
  Let's-Encrypt-TLS. Der Dienst bindet nur `127.0.0.1:3000` (`SERVER_HOST`); Caddy
  routet `relay.positronium.dev` → `127.0.0.1:3000` und `web.positronium.dev` →
  `127.0.0.1:3001`. Vorlage: `docs/Caddyfile.example`. Ein nur auskommentierter
  Site-Block macht die Domain unerreichbar (`tlsv1 alert internal error`, kein
  Zertifikat), obwohl der Dienst läuft. Änderungen prüfen und anwenden:
  `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.
- **Legacy-Rollback:** der alte Compose-Service `restreamer-ts` ist als
  `profiles: ["legacy"]` deaktiviert; `nginx-proxy`/`acme-companion` sind
  gestoppt. Rollback zum Container:
  `systemctl disable --now relay && docker compose --profile legacy up -d restreamer-ts`
  (und für TLS `systemctl disable --now caddy && docker start nginx-proxy acme-companion`).
- `SECURE_COOKIES=true` und `TRUST_PROXY=true` sind gesetzt.
- `GET /health` liefert Source-/Relay-/Sink-/Pause-Details; `GET /api/metrics`
  liefert JSON-Zähler (Auth erforderlich).
- `scripts/backup.sh` und `scripts/restore.sh` sichern `config/` und `data/`
  ohne `data/sessions.json` und Laufzeit-Overlays.
- Dashboard-Backup: `GET /api/system/backup` exportiert ein `.tar.gz` aus `config/`
  und `data/` (exklusive Sessions, Medien und Aufnahmen). `POST /api/system/restore`
  validiert Archive strikt (kein Traversal, keine Symlinks/Hardlinks, Whitelist),
  erstellt ein automatisches Rollback-Archiv unter `data/backups/rollback-*.tar.gz`,
  setzt `0600`-Rechte und lädt aktive Stores (`Settings`, `Streamers`, `Scenes`,
  `Scheduler`) atomar neu; die wiederhergestellten Settings werden zusätzlich per
  `applySettings` auf den laufenden Supervisor angewendet.
  Archiv-Wurzel (`tar -C`) ist das gemeinsame Elternverzeichnis von `config/` und
  `data/` (im nativen Layout `/srv/relay`), **nicht** `paths.root`/cwd: systemd
  startet im Release-Verzeichnis `/srv/relay/current`, das unter
  `ProtectSystem=strict` read-only ist. Ohne diese Ableitung enthielt das Backup
  `../config`-Einträge und der Restore scheiterte mit
  `Read-only file system`/`Cannot stat`.
- Aufnahmen (`data/recordings/`): Highlight-Marker (`data/recordings/<datei>.markers.json`,
  0600) können während aktiver Aufnahme (Dashboard, Telegram `/marker`, Stream-Deck)
  oder nachträglich erfasst werden. Remux-Clips (`POST /api/recordings/:file/clip`)
  schneiden per ffmpeg `-c copy` verlustfrei zu MP4 und können mit `to_media: true`
  direkt mit Thumbnail in `data/media/` übernommen werden. Beim Löschen einer Aufnahme
  wird die `.markers.json` mitgelöscht.

## Frontend-Konventionen

- Design-System in `src/web/src/styles/` (`tokens.css`, `base.css`, `layout.css`,
  `components.css`, `effects.css`) über `index.css`.
- Shape/Elevation (#88): Radius `--radius-card` 12 px, `--radius-control` 8 px,
  Chips 999 px; drei Flächen-Ebenen über `--elev-1/2/3`, Karten nutzen Elevation
  statt reiner 1-px-Hierarchie. Akzent bleibt Cyan (`--accent`), semantische
  Farben für live/ok/warn/danger; Inter/JetBrains Mono lokal aus
  `src/web/public/fonts`.
- Typografie: JetBrains Mono nur für Zahlen, IDs und Timestamps — Labels,
  Überschriften und Fließtext in Inter (`font-variant-numeric: tabular-nums`).
- Basis-Komponenten in `src/web/src/components/ui/` (`AppButton`, `AppCard`,
  `AppBadge`, `AppField`, `AppSkeleton`, `AppListItem`) wrappen die bestehenden
  `.btn`/`.card`/`.badge`/`.field`-Klassen und tragen die Varianten-API.
  Neue Views nutzen diese Primitives statt handgebauter Klassensätze.
- Motion: Übergänge laufen über `--motion-fast/base/slow` und
  `--motion-ease`; `prefers-reduced-motion` setzt sie auf 0 ms. Routenwechsel
  animiert `App.vue` mit `<Transition name="view">`.
- Mobile: Tab-Leiste unten, Tabellen werden zu Karten, Touch-Ziele ≥ 38 px,
  Eingaben 16 px gegen iOS-Zoom, Safe-Area-Insets.
- Hauptnavigation: vier Bereiche (`Live`, `Inhalte`, `Studio`, `System`) in
  `src/web/src/navigation.ts`. Routen bleiben flach und tragen `meta.section`;
  `SectionTabs.vue` rendert die zweite Ebene (Live: Cockpit/Discovery, Inhalte:
  Streamer/Playlists/Medien/Zeitplan/Automation, Studio: Overlays/YouTube/
  Ausgabe, System: Einstellungen/Logs/Diagnose). Discovery ist damit kein
  eigener Nav-Punkt mehr, `/discovery` bleibt als Deep Link bestehen. Die
  Bottom-Nav merkt sich den letzten Sub-Tab pro Bereich (`localStorage`).
- Skip-Link: fokussiert `<main>` ohne Hash-Routenwechsel; die Tab-Leiste trägt
  `aria-current="page"`, die Unterseiten-Tabs ein eigenes `aria-label`.
  Details in `docs/ACCESSIBILITY.md`.
- Regie-Aktionen: `src/web/src/actions.ts` ist die einzige Quelle für
  Cockpit-Aktionszeile, Queue-Kontextmenü und Command Palette. Guards liegen
  DOM-frei in `actions/guards.ts` (testbar ohne Browser); `useActions()` führt
  sie mit Busy-State, Toast und Status-Refresh aus.
- Optimistic UI: `status-patch.ts` hält einen lokalen Status-Guess inklusive
  Rollback-Snapshot (`patchStatus`/`rollbackStatus`/`confirmStatus` in
  `useStore`). Ein Guess überlebt Server-Snapshots nur `OPTIMISTIC_TTL_MS`
  (2 s), danach gewinnt der Server. `runOptimistic()` kapselt das Muster.
- Cockpit (`DashboardView.vue`): Statuszeile sticky, Action-Zeile, drei Spalten
  (Vorschau · Regie-Queue · Kennzahlen), Vitals-Leiste, darunter Streamer-Liste
  und Einnahmen. Zuschauerzahl kommt aus `status.chat.viewers` und wird bei
  `null` ausgeblendet, nie als 0 gezeigt.
- Studio-Preview: `POST /api/overlays/studio.png` mit ungespeicherten Overlays,
  clientseitig 220 ms Debounce + `AbortController`. Drag/Resize ändert
  `offset_x`/`offset_y` bzw. `font_size`; Presets sind JSON-Export/-Import.
  Ohne Beispielmodus liefert der Server die letzten echten Chat-Nachrichten.
- Overlay-Studio ≤ 1100 px: kompakter Editor. Auf dem Handy scrollt die
  Vorschau mit; eingeklappt (Chevron) klebt sie als flache, deckende Kopfzeile
  unter den Section-Tabs. Tablets bleiben zweispaltig mit sticky Vorschau.
  „Positionieren" zeigt sie bildschirmfüllend mit 40-px-Griffen und
  Ecken-Picker. Gespeichert wird über die feste Leiste über der Bottom-Nav,
  die Tabs scrollen horizontal, Formulargruppen sind Accordions.
  Über 1100 px bleibt das zweispaltige Layout.

## PWA und Updates

- Service Worker über `vite-plugin-pwa` (`registerType: 'prompt'`); Updates
  werden automatisch angewendet (`onNeedRefresh` → `skipWaiting` + Reload).
- Update-Prüfung: beim Registrieren, alle 60 s, bei `visibilitychange`
  (sichtbar), `focus` und `online` – sonst prüfen mobile Browser eine
  installierte PWA kaum auf neue Service Worker.
- `index.html`/SPA-Fallback und `sw.js` werden mit
  `Cache-Control: no-store` ausgeliefert; `/assets/*` bleibt immutable.
- Versions-Mismatch: Der Client bäckt `__APP_VERSION__` (package.json) ein und
  vergleicht ihn mit `status.version`. Ist der Server neuer, werden Service
  Worker + Caches gelöscht und neu geladen (einmal pro Zielversion).

## Qualitätsregeln

- Vor jedem Commit: `npm run check` und bei UI/Serveränderungen `npm run build`.
- Bei UI-Änderungen zusätzlich `npm run test:e2e` (320-px-Overflow, Navigation,
  Tabellen-Rollen, Formular-Labels, Theme-Wechsel).
- Neue Backend-Felder immer in Schema, API-Typen, Frontend-Typen und Tests
  ergänzen.
- Neue API-Routen zusätzlich in `src/api/openapi.ts` dokumentieren und
  `npm run openapi:generate` ausführen; `npm run openapi:check` prüft die
  eingecheckte `docs/openapi.json` und die Route-Coverage.
- `tests/supervisor-integration.test.ts` simuliert Quellenausfall → Pause →
  Reconnect, deaktivierten Auto-Reconnect und Playlist-Wechsel bei Offline mit
  Fake-ffmpeg/yt-dlp bzw. injiziertem Resolver.
- Keine Secrets, `.env`, `config/streamers.yml`, `config/settings.yml`, `data/`
  oder `logs/` committen.
- Commit-Nachrichten im Conventional-Format, z. B.
  `fix: keep dashboard settings across restarts`.
- Nach Deployment kurz `/health`, `/api/status` und betroffene API-Routen prüfen.

## Version bumpen

Am einfachsten über das Release-Skript:

```bash
./scripts/tag.sh 0.21.0 --push    # oder patch | minor | major
./scripts/tag.sh patch --dry-run  # Vorschau
```

Das Skript aktualisiert alle vier Stellen (`package.json`, `package-lock.json`,
`src/version.ts`, `docs/openapi.json`), führt `npm run check && npm run build`
aus, erstellt Commit + annotierten Tag `v<version>` und pusht mit `--push`.

Manuell (falls nötig):

1. `package.json`
2. `package-lock.json` (Root-Paket)
3. `src/version.ts`
4. `npm run openapi:generate` (`docs/openapi.json`)

## Bekannte offene Punkte

- Telegram-Bot: weitere Komfortbefehle (z. B. Titel/Einnahmen)
- ASR/Vosk-Wort-Tracker
- Per-Streamer-Log-Ansicht mit Seitenblättern
- Versions-Overlay und Chat-interne Einnahmenkarte
