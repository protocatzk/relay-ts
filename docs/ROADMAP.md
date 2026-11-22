# RELAY Roadmap

Stand: **2026-11-19** · Version **0.7.0**

Dieser Plan bündelt die nächsten Verbesserungen nach der Feature-Parität. Die
Reihenfolge ist bewusst nach Risiko und Nutzen sortiert. Jeder Punkt hat einen
eigenen Issue-Entwurf unter [`docs/issues`](./issues) und kann mit
`scripts/create-issues.sh` in GitHub-Issues übertragen werden.

## Leitlinien

1. **Stabilität vor Features:** Der Stream darf bei Quellenwechseln, Pausen und
   Reconnects nicht abbrechen.
2. **Sicherheit standardmäßig:** Keine Tokens in URLs, CSRF-Schutz für
   Cookie-Auth, echte Client-IPs hinter dem Proxy.
3. **Nachvollziehbarkeit:** Jede Änderung bekommt Tests, Logs und sichtbare
   Statusinformationen.
4. **Weniger Sondercode:** Per-Streamer-Overlays, doppelte Pfade und tote
   Konfiguration entfernen.
5. **Mobile und Accessibility sind kein Nachgedanke.**

## Meilensteine

### v0.3.0 – Hardening & Pause-Studio

Ziel: Sicherheitslücken schließen, Pausen-Assets komfortabel verwalten und die
wichtigsten Stabilitätsfälle automatisiert testen.

**Status: abgeschlossen in 0.3.0.** Der Supervisor-Split wurde als erster
Schritt umgesetzt (State-Machine, Reconnect-Policy, PlaylistController); die
verbleibende Aufteilung in StreamSession/PauseController/OverlayRuntime läuft
als Folge-Issue außerhalb von v0.3.0.

| Issue | Priorität | Bereich |
|---|---|---|
| Sicherheits-Hardening: CSRF, Token-URLs, Proxy-IPs | P0 | Security |
| Serverseitige, widerrufbare Auth-Sessions | P0 | Security |
| Supervisor aufteilen und Zustandsmaschine explizit machen | P1 | Reliability |
| Integrationstests für Pause/Reconnect mit Fake-ffmpeg | P1 | Reliability |
| Pause-Asset-Upload, Validierung und Vorschau | P2 | Pause |
| Startbildschirm-Video vor dem Live-Stream | P2 | Pause |
| Overlay-Studio: Drag/Resize, Live-Nachrichten, Presets | P2 | Overlay |
| Observability: Metriken, Health-Details, Backup/Rotation | P2 | Ops |

### v0.4.0 – Einnahmen & Telegram

| Issue | Priorität | Bereich | Status |
|---|---|---|---|
| Einnahmen-Verlauf, Charts und Zeitraum-Schnellwahl | P3 | Earnings | abgeschlossen |
| Telegram-Steuerung, Benachrichtigungen und Session-Liste | P3 | Telegram | abgeschlossen |
| Mobile Accessibility und E2E-Tests | P3 | Mobile | abgeschlossen |

### v0.5.0 – Aufräumen & Developer Experience

**Status: veröffentlicht in 0.5.0.** YouTube-Verwaltung, lokale Videos,
Telegram-Parität, Overlay-Vereinheitlichung und die Entfernung der
Per-Streamer-Overlays sind enthalten; OpenAPI bleibt als Folge-Issue offen.

| Issue | Priorität | Bereich |
|---|---|---|
| Video Playback im Dashboard ermöglichen | P3 | Streaming/UI |
| Lokale Videodateien in Playlists abspielen | P3 | Playlists/Media |
| Einnahmen im Overlay Studio vereinheitlichen | P3 | Overlay/Earnings |
| YouTube-Streams erstellen, planen und verwalten | P3 | YouTube/API |
| Telegram-Bot: Featureparität mit der Webapp ausbauen | P3 | Telegram |
| Per-Streamer-Overlays entfernen und Migration abschließen | P4 | Tech Debt |
| OpenAPI aus Zod/Fastify generieren und Client typisieren | P4 | Tech Debt |

### v0.6.0 – Dashboard & Stream-Layout

**Status: veröffentlicht in 0.6.0.**

- Live-Menü im Header für Stream-Auswahl und manuelles Beenden.
- Mehrzeilige Einnahmen-Templates inklusive Vorschau und Stream-Ausgabe.
- Globales Video-Layout mit Größe (50–400 %), Zoom/Beschnitt und Position.

### v0.6.1 – Refactoring

**Status: veröffentlicht in 0.6.1.** Keine bewussten Verhaltensänderungen.

- Supervisor in `StatusBuilder`, `OverlayRuntime`, `SinkController`,
  `PauseController` und `SourceSession` aufgeteilt.
- Charakterisierungstests für Status, Sink-Restart, Pause-Timer, Source-Refresh
  und Reconnect-State ergänzt.

### v0.7.0 – API & Developer Experience

**Status: veröffentlicht in 0.7.0.**

- OpenAPI-3.1-Spezifikation für alle API-Routen inklusive Auth- und
  Fehlerantworten.
- Auslieferung über `GET /api/openapi.json`, Generator und CI-Frischecheck.
- Route-Coverage-, Ref- und Typ-Paritätstests.

### v0.24.0 – Stream Protection, Mobile Audio, Säulen-Monitor & Hardware Specs

**Status: veröffentlicht in 0.24.0.**

- **#66 (iOS YouTube Audio):** Re-Encoding und Sink auf striktes AAC-LC (`-profile:a aac_low`), 48 kHz Stereo und `aresample:first_pts=0` umgestellt, um Stuttering/Silence in der iOS YouTube-App zu beheben.
- **#64 (System-Spezifikationen & Empfehlungen):** Diagnose erfasst CPU-Modell, Cores, Load-Average, RAM (Total/Used/Free), Swap und Disk. Regelbasierte Empfehlungen für Hardware-Encoder, RAM, Disk-Space und CPU-Last im TokTracker-Stil in `DiagnosticsView.vue`.
- **#68 (Säulen-Monitor Layout):** Optionales Layout-Modell (`layout_mode: 'pillar_monitor'`) mit Top-Banner (Status, Uptime, Streamer, Stats, Coins, EUR und Zielbalken) und vertikalem Chat-Monitor in der linken ungenutzten Säule bei 9:16-Quellen (0 % Verdeckung des Videos, minimaler Overhead über dieselbe Canvas-Pipe).
- **Stream-Umschalt-Fix (Blink/Vanish):** Streamer verschwinden beim Live-Schalten im Dashboard nicht mehr kurzzeitig aus dem Live-Menü oder der Übersicht, da `startingStreamerId` den Status nahtlos aktiv und online hält.

| Issue | Priorität | Bereich | Status |
|---|---|---|---|
| Bug: YouTube-Audio-Encoding für iOS prüfen und stabilisieren (#66) | P1 | Reliability/YouTube | abgeschlossen |
| Systemspecs prüfen und Optimierungsempfehlungen ausgeben (#64) | P3 | Ops/Diagnostics | abgeschlossen |
| Overlay: Optionaler Säulen-Monitor (Top-Banner für Stats/Ziel + Chat-Monitor links) (#68) | P2 | Overlay/Chat | abgeschlossen |
| Overlay: Starship-Cockpit Canvas (CPU-schonendes Sci-Fi HUD für Stream & Regie) (#71) | P2 | Overlay/Performance | abgeschlossen |
| Stream absichern: Endlosbild bei Verbindungsverlust (Disconnect Protection) (#62) | P1 | Reliability/Ops | geplant |
| YouTube: Thumbnails über Cockpit einfügen (#63) | P2 | YouTube/UI | geplant |
| Stream: Discovery für neue Streamer einbauen (#65) | P2 | Playlists/Queue | geplant |
| UI: Desktop-Navigation als vertikale Pille an der Seite statt am Boden (#72) | P3 | UI/Accessibility | geplant |

## Definition of Done

Ein Issue gilt als erledigt, wenn:

- die Akzeptanzkriterien im Issue erfüllt sind,
- `npm run check` grün ist,
- relevante neue Logik Tests hat,
- Doku (`README.md`, `AGENTS.md` oder Issue) aktualisiert ist,
- bei Deployment-relevanten Änderungen der Container neu gebaut und
  `/health` geprüft wurde.

## Nicht in diesem Plan

- Weitere TikTok-Extraktions-Hacks: zuerst Stabilität und Beobachtbarkeit.
- Komplette Neuentwicklung des Dashboards.
- Multi-Tenant-Betrieb oder mehrere gleichzeitige Ziele.
