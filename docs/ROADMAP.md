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
| Agenten-Steuerung: Intern (Regie-Agent) und extern per MCP (#77) | P2 | Agent/MCP/API | abgeschlossen |
| Streamer: Gruppenverwaltung und automatische Discovery-Gruppe (#78) | P2 | Playlists/Streaming | abgeschlossen |
| Live-Room Webcast (Chat & Einnahmen), Säulenmonitor-Polish, Discovery Following-Tab & TikTok Account-Switcher (#79) | P2 | Chat/Overlay/Discovery | abgeschlossen |
| Automatisierungsbaukasten-System mit visueller UI (Trigger, Conditions & Actions) (#80) | P2 | Automation/UI/API | geplant |
| API-Zugang konfigurieren und Keys erzeugen und managen (#82) | P2 | Security/API | geplant |
| Dashboard-Redesign: Anwenderfreundlichkeit, Geschwindigkeit und App-Gefühl (#88) | P1 | UI/UX | abgeschlossen |
| Navigation straffen: Discovery in Live integrieren, 5 → 4 Bereiche (#88) | P3 | UI/UX | abgeschlossen |
| Discovery: Handlichkeit und Einbau ins Cockpit (#92) | P2 | UI/UX | abgeschlossen |
| Queue als zentrale Abspielsteuerung der App (#94) | P2 | Streaming/UI | geplant |

### v0.32.0 – Cockpit (#88)

**Status: veröffentlicht in 0.32.0.**

- **Design-System:** `tokens.css` mit drei Elevation-Ebenen (`--elev-1/2/3`),
  Radius 12/8/999 px, Motion-Tokens inklusive `prefers-reduced-motion`.
  Elf Altlasten mit 2-px-Radius entfernt; JetBrains Mono nur noch für Zahlen,
  IDs und Timestamps.
- **Basis-Komponenten:** `components/ui/` mit `AppButton`, `AppCard`,
  `AppBadge`, `AppField`, `AppSkeleton`, `AppListItem` als Varianten-API über
  den bestehenden `.btn`/`.card`/`.badge`-Klassen.
- **Cockpit:** Statuszeile sticky (Ziel, Uptime, Zuschauer, Bitrate),
  Action-Zeile, drei Spalten (Vorschau · Regie-Queue · Kennzahlen),
  Vitals-Leiste, darunter Streamer-Liste und Einnahmen. Wartung & Chat sowie
  Schnellstart sind eingeklappt und bleiben erreichbar.
- **Action-Registry:** `actions.ts` + DOM-freie Guards in `actions/guards.ts`
  speisen Cockpit-Zeile, Queue-Menü und Command Palette (inkl. „gesperrt“-Grund
  und Tastatur-Navigation über deaktivierte Einträge).
- **Optimistic UI:** `status-patch.ts` hält den lokalen Guess samt
  Rollback-Snapshot; Patches überleben Server-Snapshots 2 s lang.
  `runOptimistic()` kapselt das Muster für Screens, Queue und Zeitplan.
- **Speed/Mobile:** Route-Prefetch für die vier Hauptziele, Skeletons statt
  Spinner in der Queue, Signaling-Dot in der Bottom-Nav, Swipe-Aktionen
  (links löschen, rechts sofort spielen) auf Queue-Einträgen.
- **Neues Statusfeld:** `status.chat.viewers` (Zahl oder `null`) aus dem
  Webcast-Client; die Kennzahl wird bei `null` ausgeblendet.
- **Offen (später):** verbleibende Migration der Einzelansichten auf die
  Basis-Komponenten.

### v0.33.0 – Navigation & Testsuite

**Status: veröffentlicht in 0.33.0.**

- **Navigation 5 → 4:** Discovery ist kein eigener Bereich mehr, sondern ein
  Untertab von `Live` (`Cockpit` · `Discovery`). `/discovery` bleibt als
  Deep Link erhalten; Bottom-Nav, Section-Tabs und `navigation.test.ts` sind
  angepasst.
- **Responsive Fixes:** Die Einstellungs-Sprungliste und die RTMP-Ingest-Box
  sprengten 320-px-Viewports (lange Ingest-URLs, Scroll-Container ohne
  `min-width: 0`), Discovery-Karten erzwangen 320-px-Tracks, die Automation-
  Ansicht blutete über den Content-Rand. Alle Dashboard-Routen liegen jetzt
  bei 320 px ohne horizontalen Overflow.
- **Dialog-Stacking:** Der „Ungespeicherte Änderungen“-Prompt liegt über
  Ansichts-Modals (`ModalDialog elevate`), damit „Bleiben“ nicht vom
  darunterliegenden Dialog verdeckt wird.
- **Formular-Race:** Ein laufender Settings-Load überschreibt keine Eingaben
  mehr, die während des Requests gemacht wurden (`loadSettings(…, keepEdits)`).
- **PWA:** Eine blockierte Service-Worker-Registrierung wird toleriert
  (keine Endlos-Fehler mehr, Reload-Fallback ohne Worker).
- **E2E-Suite repariert:** 36/36 Tests grün (vorher 13 Fehler auf `main`):
  Theme-Toggle im Mobile-Menü, Studio-Tabs inkl. Version-Tab, Settings-Payload
  (`watchdog` + `sink`), Studio-IDs (`studio-video-pos-x/y`), Accordion-Gruppen
  auf Mobilgeräten, Service Worker in Tests blockiert.

### v0.34.0 – Discovery im Cockpit (#92)

**Status: veröffentlicht in 0.34.0.**

- **Panel statt Tab:** Discovery erscheint als schwebendes Panel über dem
  Cockpit. Ab 1280 px schiebt es das Grid (Widgets wandern unter die Queue),
  960–1279 px überlagert es die Widgets-Spalte, auf dem Handy wird es ein
  Bottom-Sheet mit Scrim. Breite per Griff ziehbar (320–560 px, gemerkt).
- **Einstiege:** Shortcut `D`, echtes Suchfeld im Header (≥ 1100 px),
  Action-Registry (`discovery.open`, `discovery.zapper`), Cockpit-Karte
  „Discovery" mit Live-Zähler und den zwei stärksten Räumen, Palette.
- **Workspace getrennt von der Hülle:** `DiscoveryWorkspace.vue` enthält Suche,
  Filter, Liste und Zapper; ein späteres frei schwebendes Fenster kann denselben
  Workspace hosten.
- **Handlichkeit:** Filter (live, Region, Mindestzuschauer, Sortierung),
  Trefferzähler, Suchverlauf (8 Einträge), Skeletons, Fehlerbanner mit Retry,
  „aktualisiert vor X", Status-Badge statt „Speichern" für bekannte Streamer.
- **Zapper:** Tastatur `←/→`, `Space`, `S`, `Q`, `A`, `F`, `?` inkl.
  Hilfe-Overlay, Vorwärmen der nächsten zwei Räume (nur Metadaten), klarer
  Fehlerzustand mit „Nächster Streamer".
- **API:** `GET /api/discovery/suggest` (5-s-Cache, ≤ 8 Treffer),
  `GET /api/discovery/status` (Batch, ≤ 20 Handles, 30-s-Cache,
  `unknown` statt „offline"), `preview?fallback=1` → `204`.

### v0.35.0 – Queue als zentrale Abspielsteuerung (Teil 1)

**Status: veröffentlicht in 0.35.0.**

- **Ein Modell (#94 Phase A):** `PlaybackService` leitet einen einheitlichen
  Zustand aus Queue, Playlist, Einzelquelle und Screens ab; `GET /api/playback`
  und das SSE-Event `playback` liefern ihn. Transport über
  `POST /api/playback/*` (play, pause, resume, stop, next, previous, seek, loop,
  queue-now) mit den bestehenden Controllern als Ausführungsschicht; die
  Alt-Routen bleiben Aliase.
- **Transport im Cockpit (#94 Phase B):** Eine Leiste zeigt „läuft“ und „als
  Nächstes“ und steuert Wiedergabe, Vor/Zurück, Stopp, Seek und Queue-Loop.
  Die Action-Zeile behält nur noch nicht-transportbezogene Regie-Aufgaben
  (Umschalten, Discovery, Sink). Queue-Karte hat jetzt „Zurück“.
- **Teil 2 (#94):** Loop-Modi `off`/`all`/`one` (Persistenz-Migration vom
  Boolean, `one` wiederholt den laufenden Eintrag), einheitliches Einreihen mit
  `now`/`next`/`end`, Playlist→Queue als Kopie (ersetzen/anhängen), Discovery
  kann ans Ende einreihen, Stream-Deck hat Weiter/Zurück/Play-Pause, MCP bietet
  `relay_playback_state`, `relay_playback_control` und `relay_queue_enqueue`.
- **Teil 3 (#94):** Historie der letzten 20 Einträge (`GET /api/queue/history`,
  „Zuletzt gespielt“ in der Queue-Karte mit „+“ zum Wiedereinreihen), „Hold“
  friert die Wiedergabe ein und stoppt Auto-Advance ohne den Eintrag zu
  verlieren, Telegram `/queue` mit Zurück/Hold, Scheduler-Aktion `playback`
  mit Ziel (`queue`, `playlist:<id>`, `streamer:<id>`, `screen:<typ>`).

### v0.35.1 – Queue als App-Spielfläche (#94)

**Status: veröffentlicht in 0.35.1.**

- Regie-Queue steht im Cockpit direkt unter der Action-Zeile über die volle
  Breite; darunter folgen Vorschau und Kennzahlen. Transport-Aktionen gibt es
  nur noch einmal (in `PlaybackTransport.vue`), die Karte behält Liste,
  Hinzufügen, Reihenfolge und „Zuletzt gespielt".
- Queue-Zeilen zeigen ihren Streamer-Status (`deaktiviert`, `kein Key`,
  `unbekannt`). Beim Abspielen wird ein deaktivierter Streamer automatisch
  aktiviert; fehlt der Key, erscheint ein Fehler statt eines stillen
  Überspringens. Der Transport-Play startet ohne aktive Quelle die Queue.
- Diagnose: Empfehlungszeilen brechen auf schmalen Viewports um (320-px-
  Overflow behoben), E2E meldet bei Overflows jetzt die Verursacher.

### v0.35.2 – Streamer direkt in die Queue

**Status: veröffentlicht in 0.35.2.**

- Jede Zeile der Cockpit-Streamerliste hat „+ Queue“ und hängt den Streamer ans
  Ende der Regie-Queue; der zurückgegebene Snapshot wird direkt übernommen und
  per Toast bestätigt.

### v0.35.3 – Queue-Listenfenster und gestylte Spoiler (#94)

**Status: veröffentlicht in 0.35.3.**

- Die Queue-Karte nutzt die volle Breite und hält die Liste in einem eigenen
  Fenster (max. 62 vh, eigener Scroll, ausblendender unterer Rand solange
  Einträge darunter liegen); kurze Queues bleiben kompakt, lange scrollen.
- „Eintrag hinzufügen“ und „Zuletzt gespielt“ sind gestylte Accordions; die
  Hinzufügen-Controls liegen in beschrifteten Gruppen (Video, Streamer,
  Playlist, Screen) und werden nicht mehr abgeschnitten.
- Zeilen sind einzeilig (Griff, Nummer, Art, Label, Dauer, Symbol-Aktionen),
  der laufende Eintrag trägt eine Akzentkante. Mobil stapeln die Controls, die
  Karte wächst mit dem Inhalt, Verschieben läuft über Griff und Swipe.

### v0.36.0 – TikTok-Session pro Streamer (#95)

**Status: veröffentlicht in 0.36.0.**

- `streamer.tiktok_account` pinnt eine Session aus den TikTok-Konten; leer =
  aktives Konto. Sessions bleiben in `data/tiktok-accounts.json`, pro Konto
  entsteht lazy `data/cookies/<id>.txt` (Modus `0600`).
- Resolver, Chat-Webcast und die `tiktok`-Online-Checks lösen die Session pro
  Streamer auf; ein gelöschtes Konto fällt mit einmaliger Warnung auf das
  aktive Konto zurück. Discovery/Following bleibt am aktiven Konto.
- UI: Konto-Auswahl im Streamer-Editor und in der Sammel-Anlage, Badge in der
  Streamer-Liste, „zugeordnet“-Spalte in den Einstellungen und ein Löschguard
  (`409`, `?reassign=active` zum Auflösen der Zuordnungen).
- **Einnahmen-Overlay:** `{queue}` zeigt die Regie-Queue für Zuschauer
  (laufender Eintrag mit `▶`, bis zu fünf Einträge, Rest „… +N“, leer = `–`)
  und aktualisiert sich bei Queue-Änderungen ohne neuen Einnahmen-Poll.

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
