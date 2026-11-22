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

### v0.26.0 – Telegram Bot Modernisierung & Web App

**Status: veröffentlicht in 0.26.0.**

- **#73 (Telegram Bot Modernisierung):**
  - Vollständige Ausschöpfung der Telegram Bot API (Mini App / Web App Menü-Button `setChatMenuButton` für direktes Öffnen des RELAY Cockpits, Web App Inline-Buttons).
  - Live-Stream Vorschau (`/preview`) mit Multipart-Form-Data `sendPhoto`, `sendChatAction('upload_photo')` und In-Place Refresh (`act:preview:refresh`).
  - Interaktive Regie-Queue Steuerung (`/queue`) mit Steuerungs-Buttons (▶️ Play, ⏹ Stop, ⏮ -30s, ⏭ +30s, ⏭ Nächster, 🗑 Löschen) über `TelegramControl`.
  - Actionable Stream Alerts bei Ausfällen (Offline, Stall, Sink-Fehler) mit direkten Aktionsbuttons (`[⏸ Pause halten]`, `[⏭ Nächster Sender]`, `[🔄 Reconnect]`, `[⏹ Stream stoppen]`, `[🔄 Sink neustarten]`).
  - Pinned Live Status-Karte (`/pin` & `/unpin`) mit dynamischen Updates über `editMessageText` bei Status-Events.
  - Modulare Architektur in `src/core/telegram/` (`types.ts`, `api.ts`, `keyboards.ts`, `views.ts`).

### v0.27.0 – v0.27.2 – Stream Discovery & Provider Fallback

**Status: veröffentlicht in 0.27.2.**

- **#65 / #69 / #70 / #75 (Stream Discovery & Webcast-Suche):**
  - **DiscoveryService & Provider-Kette (#69, #75):** 3-stufige Adapter-Kette (`live_page` via parallelem Webcast-Live-Feed `channel_id=87/89/1222001` + SSR-Fallback, `room_info` via User-Room API mit `sourceType=54`, `search_api` via Webcast-SEO-Raumsuche `pc_web_seo_query_room` / `channel_id=86` + User-Suggest-Fallback) mit Provider-Status-Tracking (`online`, `offline`, `rate_limited`).
  - **Protobuf-Parser & Disambiguierung (#75):** Korrekte Auswertung von `age_restricted: {}`-Objekten (`isAgeRestrictedValue`), `owner.display_id`, `avatar_large.url_list` sowie Trennung zwischen Freitext-Schlagwortsuche (`gaming`, `musik`, `talk`) und expliziter `@handle`-Suche.
  - **Add-Flow- & Queue-Live-Guards:** Neu entdeckte Streamer werden strikt mit `enabled: false, priority: 999, source: 'discovery'` angelegt; Queuing/Switching prüft vorab den echten Live-Status (409 Conflict bei Offline-Streams). Hard 18+-Filter vor Cache und API.
  - **DiscoveryView (#70, #75):** Neuer Sub-Tab unter *Inhalte* im TokTracker-Design mit Provider-Status-Leiste, Trending/Suche-Umschalter, Themen-Schnellwahl-Chips (`Deutsch`, `Gaming`, `Musik`, `Talk`, `Fortnite`, `Lifestyle`), Live-Filter, Streamer-Karten und Quick-Actions (*Speichern* + *Aktivieren*, *In Queue*, *Umschalten*) inkl. `document.hidden`-Pausierung.
  - End-to-End API- und Parser-Tests sowie Audit-Log-Integration für alle Discovery-Aktionen.

### v0.28.0 – TikTok Live-Zapper, Globaler YouTube-Stream-Key & Broadcast-Persistenz

**Status: veröffentlicht in 0.28.0.**

- **#76 (TikTok Live-Zapper):**
  - Interaktiver Live-Feed-Player in `DiscoveryView.vue` mit Rechts-Pfeil-Navigation (`▲` / `▼`), Tastatur-Shortcuts (`ArrowUp` / `ArrowDown`), Infinite-Feed-Nachladen (`page`) und Regie-Quick-Actions direkt im Zapper.
  - Zero-CPU HTTP-FLV-Stream-Passthrough (`GET /api/discovery/preview/:handle`) mit TikTok-CDN-Host-Allowlist (`isAllowedTikTokStreamUrl`, SSRF-Schutz) und sofortigem `AbortController`-Cleanup beim Weiterzappen.
- **Globaler YouTube-Stream-Key mit Override-Schalter (`settings.streaming`):**
  - `global_youtube_key` und `global_key_enabled` direkt auf dem YouTube-Tab (`YouTubeView.vue`) sowie in den Einstellungen (`SettingsTitleCard.vue`) konfigurierbar.
  - Überschreibt bei aktivem Schalter alle individuellen Streamer-Keys (`source: 'global'`) und schaltet aktive Sinks im laufenden Betrieb um; bei deaktiviertem Schalter dient er als Fallback für Streamer ohne eigenen Key.
- **YouTube-Broadcast- & Live-Switch-Persistenz:**
  - `YouTubeAuthService` hält kürzlich angelegte oder umgeschaltete Broadcasts (`recentBroadcasts`, `recentTransitions`) über die Eventual-Consistency-Lücke der YouTube-`mine=true`-API hinweg stabil sichtbar, sodass live geschaltete Broadcasts auf dem YouTube-Tab nicht mehr verschwinden.
  - `DiscoveryService.switchToStreamer` und `queueNow` aktivieren neu entdeckte Streamer automatisch (`enabled: true`) und benachrichtigen den Supervisor.

| Issue | Priorität | Bereich | Status |
|---|---|---|---|
| Bug: YouTube-Audio-Encoding für iOS prüfen und stabilisieren (#66) | P1 | Reliability/YouTube | abgeschlossen |
| Systemspecs prüfen und Optimierungsempfehlungen ausgeben (#64) | P3 | Ops/Diagnostics | abgeschlossen |
| Overlay: Optionaler Säulen-Monitor (Top-Banner für Stats/Ziel + Chat-Monitor links) (#68) | P2 | Overlay/Chat | abgeschlossen |
| Overlay: Starship-Cockpit Canvas (CPU-schonendes Sci-Fi HUD für Stream & Regie) (#71) | P2 | Overlay/Performance | abgeschlossen |
| Stream absichern: Endlosbild bei Verbindungsverlust (Disconnect Protection) (#62) | P1 | Reliability/Ops | geplant |
| YouTube: Thumbnails über Cockpit einfügen (#63) | P2 | YouTube/UI | geplant |
| Stream: Discovery für neue Streamer einbauen (#65) | P2 | Playlists/Queue | abgeschlossen |
| UI: Desktop-Navigation als vertikale Pille an der Seite statt am Boden (#72) | P3 | UI/Accessibility | abgeschlossen |
| Telegram: Bot-Modernisierung und vollständige Ausschöpfung der Telegram Bot API (#73) | P2 | Telegram/Ops | abgeschlossen |
| Discovery: Trending-Feed reparieren und Freitext-/Keyword-Suche ermöglichen (#75) | P1 | Discovery/Stream | abgeschlossen |
| Discovery: TikTok Live-Zapper (Feed-Player mit Pfeil-Navigation & HTTP-FLV-Preview) (#76) | P2 | Discovery/UI | abgeschlossen |
| Agenten-Steuerung: Intern (Regie-Agent) und extern per MCP (#77) | P2 | Agent/MCP/API | geplant |
| Streamer: Gruppenverwaltung und automatische Discovery-Gruppe (#78) | P2 | Playlists/Streaming | abgeschlossen |
| Live-Room Webcast (Chat & Einnahmen), Säulenmonitor-Polish, Discovery Following-Tab & TikTok Account-Switcher (#79) | P2 | Chat/Overlay/Discovery | abgeschlossen |

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
