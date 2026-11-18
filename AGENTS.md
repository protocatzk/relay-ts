# AGENTS.md

Hinweise für AI-Agenten und Entwickler, die an RELAY arbeiten.

## Projekt

RELAY ist ein Node.js/TypeScript-Restreamer: TikTok-Live → interner MPEG-TS-Relay
→ ffmpeg-Sink → YouTube. Dazu gehört ein Vue-3-Dashboard im TokTracker-Stil.

Die produktive Instanz läuft unter **https://relay.positronium.dev**.

- Aktuelle Version: **0.2.0**
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
  Pause, Playlist, Reconnect, Settings-Anwendung
- `src/core/source/` – TikTok-Auflösung und Quell-ffmpeg
- `src/core/sink/` – YouTube-Sink
- `src/core/relay/` – MPEG-TS-Relay und DelayBuffer
- `src/core/overlays/` – Canvas-Chat, drawtext, PauseScreen, Studio-Preview
- `src/core/earnings/` – TokTracker-kompatibler Einnahmen-Monitor
- `src/core/telegram/` – Login-Bot und Token-Store
- `src/api/` – Fastify-Routen, Auth, SSE
- `src/web/src/` – Vue-Dashboard

## Laufzeit-Invarianten

- Der YouTube-Sink bleibt bei Quellenwechseln und Pausen bestehen. Quellen
  werden nur am Relay ausgetauscht.
- Bei Quellenausfall startet nach `pause.grace_seconds` (Default 2 s) der
  Pausenscreen. Reconnect läuft weiter; bei Erfolg wird der Pausenscreen
  gestoppt.
- `pause.max_minutes` begrenzt die Pause (0 = unbegrenzt).
- Der Pausenscreen kann ein eigenes Hintergrundbild/-video und einen eigenen Font
  nutzen. Statische SVGs werden mit Skia zu PNG gerastert; animierte SVGs werden
  nur als statisches Bild dargestellt (für Animation WebM/GIF/MP4 verwenden).
- Der Quell-Raten-Watchdog benötigt 30 s Warmup, ein 10-s-Fenster und drei
  aufeinanderfolgende schlechte Messungen. Das verhindert Fehlstarts kurz nach
  dem Verbindungsaufbau.
- DelayBuffer-Timestamps müssen monoton bleiben; `nextProducerOffset()` beachten.
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
  Per-Streamer-Overlays bleiben nur zur YAML-Kompatibilität erhalten.
- Fehlt `settings.overlays`, werden beim ersten Start die Overlays des ersten
  Streamers mit aktivem Overlay übernommen und persistiert.
- Overlay-Studio speichert über `PUT /api/overlays`; Einnahmen und restliche
  Einstellungen über `PUT /api/settings`.

## Einnahmen

- Quelle ist TokTracker-kompatibles JSON (Übersicht, Detail oder Liste).
- Unterstützt Zeiträume `today`, `24h`, `7d`, `30d`, `all`.
- Ansichten: `compact`, `standard`, `detailed`.
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
- Bei HTTPS zwingend `SECURE_COOKIES=true`.
- Bot-Token niemals loggen oder committen.
- Derselbe Bot-Token darf nicht parallel in alter Python-App und RELAY laufen
  (`getUpdates`-Konflikt).

## Deployment

- `docker-compose.override.yml` setzt `VIRTUAL_HOST=relay.positronium.dev` und
  verbindet den Container mit `toktrackerapp_toktracker_net`.
- `nginx-proxy` + `acme-companion` übernehmen TLS/Let's Encrypt.
- Ports bleiben lokal auf `127.0.0.1:3000` gebunden; der Proxy erreicht den
  Container intern über Port 3000.
- `SECURE_COOKIES=true` ist für die produktive Domain gesetzt.

## Frontend-Konventionen

- `src/web/src/style.css` ist die Basis.
- `src/web/src/toktracker.css` wird **danach** geladen und überschreibt das
  Design. Responsive Fixes deshalb in `toktracker.css` ergänzen, sonst können
  sie von dessen Desktop-Regeln überschrieben werden.
- Mobile: Drawer-Navigation, Tabellen werden zu Karten, Touch-Ziele ≥ 38 px,
  Eingaben 16 px gegen iOS-Zoom, Safe-Area-Insets.
- TokTracker-Stil: harte Kanten (Radius max. 2 px), 1-px-Rahmen, Mono-Labels,
  Grün als Akzent, Inter/JetBrains Mono lokal aus `src/web/public/fonts`.
- Studio-Preview: `POST /api/overlays/studio.png` mit ungespeicherten Overlays,
  clientseitig 220 ms Debounce + `AbortController`.

## Qualitätsregeln

- Vor jedem Commit: `npm run check` und bei UI/Serveränderungen `npm run build`.
- Neue Backend-Felder immer in Schema, API-Typen, Frontend-Typen und Tests
  ergänzen.
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

- Telegram-Bot-Steuerung und Benachrichtigungen (aktuell nur Login-Freigabe)
- ASR/Vosk-Wort-Tracker
- Per-Streamer-Log-Ansicht mit Seitenblättern
- Bevorzugter Streamer: Rückkehr zur vorherigen Playlist/Quelle
- Versions-Overlay und Chat-interne Einnahmenkarte
