# AGENTS.md

Hinweise für AI-Agenten und Entwickler, die an RELAY arbeiten.

## Projekt

RELAY ist ein Node.js/TypeScript-Restreamer: TikTok-Live → interner MPEG-TS-Relay
→ ffmpeg-Sink → YouTube. Dazu gehört ein Vue-3-Dashboard im TokTracker-Stil.

Die produktive Instanz läuft unter **https://relay.positronium.dev**.

- Aktuelle Version: **0.12.0**
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
- `src/core/overlays/` – Canvas-Chat, drawtext, PauseScreen, Studio-Preview
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
- Bei Quellenausfall startet nach `pause.grace_seconds` (Default 2 s) der
  Pausenscreen. Reconnect läuft weiter; bei Erfolg wird der Pausenscreen
  gestoppt.
- `pause.max_minutes` begrenzt die Pause (0 = unbegrenzt).
- Manuelle Screens (`/api/screens/:type/start`, `/api/screens/stop`) können
  Startbildschirm oder Pausenscreen jederzeit einspielen und unbegrenzt halten,
  auch ohne aktiven Streamer (Idle-Zustand). Dann wird der Stream-Key des
  bevorzugten/ersten aktivierten Streamers genutzt, sonst `YOUTUBE_STREAM_KEY`;
  `pause.max_minutes` gilt nur für automatische Offline-Pausen.
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
- Bei aktivem DelayBuffer wird der YouTube-Sink erst nach dem Prefill gestartet
  (`startSinkOrPrefillLocked`, `sinkStarting`), damit YouTube beim Kaltstart
  sofort Medien statt Stille erhält.
- Overlay-Änderungen am aktiven Stream bauen Sink/Chat-Engine bewusst neu auf.
  Das ist ein kurzer, kontrollierter Reconnect.
- Das globale Video-Layout (`video.layout`) skaliert und positioniert das
  Relay-Bild im Sink per `scale`/`crop`/`pad`. 100 % ist das eingepasste Bild,
  über 100 % wird gezoomt und beschnitten. Es gilt global für Live-Quelle,
  Pause-/Startbildschirm und lokale Videos; Änderungen starten den Sink neu.
  Das Overlay-Studio zeigt dafür ein schematisches Quellformat (9:16/16:9/1:1).

## Konfiguration und Persistenz

Priorität:

```
Defaults → streamers.yml (settings) → settings.yml → .env (nur fehlende Keys) → CLI
```

- Dashboard-Werte in `config/settings.yml` gewinnen standardmäßig gegen `.env`.
- `SETTINGS_ENV_OVERRIDES=true` stellt die alte Priorität wieder her: `.env`
  überschreibt `settings.yml` bei jedem Start.
- `config/settings.yml` wird atomar mit Modus `0600` geschrieben.
- Secrets werden in API-Antworten durch `api_key_set` ersetzt.
- Overlays (`chat`, `clock`, `text`) sind **global** in `settings.yml`.
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
  `DELETE /api/queue`, `POST /api/queue/play|next|stop|now|seek`.
- Dashboard-Karte `RegieQueue.vue`; das SSE-Event `queue` hält den Stand aktuell.

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
  Let's-Encrypt-TLS. Der Dienst bindet nur `127.0.0.1:3000`; Caddy routet
  `relay.positronium.dev` → `127.0.0.1:3000` und `web.positronium.dev` →
  `127.0.0.1:3001`. Änderungen an der Caddyfile: `systemctl restart caddy`.
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

## Frontend-Konventionen

- `src/web/src/style.css` ist die Basis.
- `src/web/src/toktracker.css` wird **danach** geladen und überschreibt das
  Design. Responsive Fixes deshalb in `toktracker.css` ergänzen, sonst können
  sie von dessen Desktop-Regeln überschrieben werden.
- Mobile: Drawer-Navigation, Tabellen werden zu Karten, Touch-Ziele ≥ 38 px,
  Eingaben 16 px gegen iOS-Zoom, Safe-Area-Insets.
- Drawer: Fokus-Falle, `Escape`, Fokus-Rückgabe an den Menü-Button; Skip-Link
  fokussiert `<main>` ohne Hash-Routenwechsel. Details in
  `docs/ACCESSIBILITY.md`.
- TokTracker-Stil: harte Kanten (Radius max. 2 px), 1-px-Rahmen, Mono-Labels,
  Grün als Akzent, Inter/JetBrains Mono lokal aus `src/web/public/fonts`.
- Studio-Preview: `POST /api/overlays/studio.png` mit ungespeicherten Overlays,
  clientseitig 220 ms Debounce + `AbortController`. Drag/Resize ändert
  `offset_x`/`offset_y` bzw. `font_size`; Presets sind JSON-Export/-Import.
  Ohne Beispielmodus liefert der Server die letzten echten Chat-Nachrichten.

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
- Bei UI-Änderungen zusätzlich `npm run test:e2e` (320-px-Overflow, Drawer-Fokus,
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

Drei Stellen:

1. `package.json`
2. `package-lock.json` (Root-Paket)
3. `src/version.ts`

Am einfachsten:

```bash
npm version 0.2.0 --no-git-tag-version
# danach src/version.ts anpassen
```

## Bekannte offene Punkte

- Telegram-Bot: weitere Komfortbefehle (z. B. Titel/Einnahmen)
- ASR/Vosk-Wort-Tracker
- Per-Streamer-Log-Ansicht mit Seitenblättern
- Bevorzugter Streamer: Rückkehr zur vorherigen Playlist/Quelle
- Versions-Overlay und Chat-interne Einnahmenkarte
