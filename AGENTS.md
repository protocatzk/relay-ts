# AGENTS.md

Hinweise für AI-Agenten und Entwickler, die an RELAY arbeiten.

## Projekt

RELAY ist ein Node.js/TypeScript-Restreamer: TikTok-Live → interner MPEG-TS-Relay
→ ffmpeg-Sink → YouTube. Dazu gehört ein Vue-3-Dashboard im TokTracker-Stil.

Die produktive Instanz läuft unter **https://relay.positronium.dev**.

- Aktuelle Version: **0.4.2**
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

Deployment:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --since=2m
curl -fsS https://relay.positronium.dev/health
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
- Die Live-Vorschau (`GET /api/preview.ts`) ist ein Read-only-Tap am Relay und
  darf den Sink nicht beeinflussen; pro Client wird bei Rückstau getrennt.
- DelayBuffer-Timestamps müssen monoton bleiben; `nextProducerOffset()` beachten.
- Bei aktivem DelayBuffer wird der YouTube-Sink erst nach dem Prefill gestartet
  (`startSinkOrPrefillLocked`, `sinkStarting`), damit YouTube beim Kaltstart
  sofort Medien statt Stille erhält.
- Overlay-Änderungen am aktiven Stream bauen Sink/Chat-Engine bewusst neu auf.
  Das ist ein kurzer, kontrollierter Reconnect.

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
- Einnahmen-Overlay wird im Overlay-Studio bearbeitet (Template, Position,
  Offsets, Farben, Margin, Box); Einstellungen enthalten nur Quelle/Zeitraum/View.
- Zeitraum-Schnellwahl im Dashboard nutzt `POST /api/earnings/period`.
- Fehlende Geldwerte werden aus `total_coins` und `rates` berechnet.
- Bei temporären Fehlern bleiben letzte Werte sichtbar; fehlende Streamer
  liefern `status: "missing"`.
- API: `GET /api/earnings`, `POST /api/earnings/refresh`.

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

## Deployment

- `docker-compose.override.yml` setzt `VIRTUAL_HOST=relay.positronium.dev` und
  verbindet den Container mit `toktrackerapp_toktracker_net`.
- `nginx-proxy` + `acme-companion` übernehmen TLS/Let's Encrypt.
- Ports bleiben lokal auf `127.0.0.1:3000` gebunden; der Proxy erreicht den
  Container intern über Port 3000.
- `SECURE_COOKIES=true` ist für die produktive Domain gesetzt.
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

## Qualitätsregeln

- Vor jedem Commit: `npm run check` und bei UI/Serveränderungen `npm run build`.
- Bei UI-Änderungen zusätzlich `npm run test:e2e` (320-px-Overflow, Drawer-Fokus,
  Tabellen-Rollen, Formular-Labels, Theme-Wechsel).
- Neue Backend-Felder immer in Schema, API-Typen, Frontend-Typen und Tests
  ergänzen.
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
