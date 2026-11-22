# Issue 37: Automatisierungsbaukasten-System mit UI (Event- & Trigger-Regelwerk)

## Übersicht

RELAY besitzt bereits rudimentäre zeitbasierte Scheduler-Funktionen (`data/schedules.json`) und Webhook-Alerts. Für den professionellen 24/7-Dauerbetrieb und eine automatisierte Regie fehlt jedoch ein flexibles, modulares **Automatisierungsbaukasten-System** (Workflow-/Rule-Engine) mit visueller UI im Dashboard.

Ziel ist es, ein flexibles **Trigger → Bedingung (Condition) → Aktion (Action)**-System bereitzustellen, mit dem Regisseure ohne Programmierung komplexe Abläufe definieren können (z. B. *"Wenn Streamer offline geht und kein Backup online ist, spiele Playlist X und schicke Discord-Alert"*, *"Wenn Chat-Rate > 50/min, wechsle auf Hype-Overlay-Szene"*, *"Wenn Host-Speicher < 10%, stoppe Aufnahme und triggere Telegram-Warnung"*).

---

## Kern-Konzept: Trigger, Bedingungen, Aktionen

### 1. Trigger (Auslöser)
- **Status & State Machine:**
  - `stream_state_changed` (z. B. geht auf `live`, `paused`, `reconnecting`, `idle`, `error`)
  - `streamer_status_changed` (Streamer X geht online/offline)
  - `reconnect_failed` (nach N fehlgeschlagenen Reconnect-Versuchen)
- **Metriken & Vitalwerte:**
  - `source_bitrate_drop` (Bitrate unter Schwellenwert für N Sekunden)
  - `sink_dts_spike` (mehr als X DTS-Fehler)
  - `sink_silence_detected` (Stille länger als X Sekunden)
  - `disk_space_low` (freier Speicher < X GB / X %)
- **Live-Interaktion & Community:**
  - `chat_rate_exceeded` (Nachrichtenrate steigt über X/min)
  - `chat_keyword` (bestimmtes Wort oder Befehl im TikTok/YouTube-Chat erkannt)
  - `gift_received` (Geschenk/Coins überschreiten Betrag X)
- **Zeit & Schedule:**
  - `cron_or_time` (Wochentag, Uhrzeit, Intervall)
  - `uptime_exceeded` (Stream läuft länger als X Stunden)

### 2. Bedingungen (Filter & Guards)
- Logische Verknüpfungen: `AND`, `OR`, `NOT`
- Prüfung auf aktuellen Zustand (z. B. *Nur wenn YouTube-Sink aktiv*, *Nur zwischen 20:00 und 02:00 Uhr*, *Nur wenn Streamer Y nicht live ist*)
- Cooldown-Guards (z. B. *Maximal einmal alle 15 Minuten ausführen*)

### 3. Aktionen (Workflow-Steps)
- **Regie & Stream-Steuerung:**
  - Streamer starten / wechseln (`switch_streamer`)
  - Playlist starten (`start_playlist`)
  - Regie-Queue-Eintrag abspielen oder `queue_now` injizieren
  - Pausenscreen oder Startbildschirm einblenden (`start_screen`)
  - Stream stoppen (`stop_stream`)
  - Sink neu starten (`restart_sink`)
- **Overlays & Optik:**
  - Overlay-Szene aktivieren (`activate_scene`)
  - Text-Overlay oder Banner temporär anpassen / einblenden
  - Chat-Testnachricht oder Announcement ins Overlay senden
- **Benachrichtigungen & Externe Integrationen:**
  - Webhook abschicken (Discord, Slack, Custom JSON mit dynamischen Variablen wie `{{streamer.name}}`, `{{bitrate}}`)
  - Telegram-Nachricht an Regie-Gruppe senden
  - Shell-Kommando oder Hook ausführen (optional/gesichert)

---

## Detaillierte Anforderungen

### 1. Backend-Engine (`src/core/automation/`)
- **Rule-Engine (`AutomationEngine`):**
  - Event-Bus-Listener, der auf System-Events, Metriken und Chat-Events reagiert.
  - Auswertung von Regeln mit Cooldown, Retry-Logik und Fehlertoleranz.
  - Vollständiges Audit-Logging jeder ausgelösten Regel (`audit: automation_rule_triggered`).
- **Persistenz:**
  - Speicherung in `data/automations.json` (Modus `0600`, atomar geschrieben).
  - Jede Automatisierungsregel besitzt:
    - `id`: string (UUID oder Slug)
    - `name`: string
    - `enabled`: boolean
    - `cooldown_seconds`: number (Standard: 60)
    - `trigger`: TriggerDefinition
    - `conditions`: ConditionDefinition[]
    - `actions`: ActionDefinition[]
    - `last_triggered_at`: ISO timestamp | null
    - `trigger_count`: number

### 2. REST- & Realtime-API (`src/api/routes/automations.ts`)
- `GET /api/automations` – Liste aller Regeln inklusive Statistiken
- `POST /api/automations` – Neue Regel anlegen
- `PUT /api/automations/:id` – Regel bearbeiten
- `DELETE /api/automations/:id` – Regel löschen
- `POST /api/automations/:id/toggle` – Aktivieren / Deaktivieren
- `POST /api/automations/:id/test` – Regel manuell testweise triggern (Dry-Run oder Live)
- SSE-Event `automation_event` bei Regelausführung

### 3. Baukasten-UI im Dashboard (`AutomationsView.vue` & Builder-Komponenten)
- Neuer Haupt-Tab im Dashboard: **Automatisierung** (`/automations`).
- **Visueller Regel-Baukasten (Card-basierter Flow-Editor):**
  - Übersichtliche Liste mit Status-Toggles, letzter Ausführung und Schnellauslöser.
  - Regel-Editor mit drei klaren Stufen:
    1. **Wenn... (Trigger auswählen & konfigurieren)**
    2. **Und nur wenn... (Optionale Filter & Cooldowns)**
    3. **Dann tue folgendes... (Kette von Aktionen mit Parametern)**
  - Dropdown-Auswahl für bekannte Entitäten (Streamer-Liste, Szenen-Liste, Playlists, Webhooks).
  - Vorlagen-Bibliothek (Presets) für Standard-Szenarien:
    - *Auto-Failover zu Playlist bei Stream-Abbruch*
    - *Hype-Szene bei Gift-Spike*
    - *Nachtschaltung / Auto-Stopp um 03:00 Uhr*
    - *Speicherplatz-Warnung via Telegram*

---

## Akzeptanzkriterien
1. Regeln können über die UI ohne Neuladen erstellt, bearbeitet und sofort aktiviert werden.
2. Trigger werden zuverlässig und entkoppelt im Hintergrund ausgewertet, ohne den Relay-Stream oder Fastify-Request-Loop zu blockieren.
3. Cooldowns verhindern Regelschleifen (Flapping).
4. Jede Regelausführung erscheint im Audit-Log und in den Prometheus-Metriken (`relay_automation_executions_total`).
5. Volle Testabdeckung für die Rule-Engine und alle Trigger-Typen.
