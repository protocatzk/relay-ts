## Ziel

Eine vollständige **Agenten-Steuerung für RELAY** aufbauen – sowohl **extern über einen Model Context Protocol (MCP) Server** (für Claude Desktop, Cursor, Antigravity, OpenAI/Gemini-Agenten und Automatisierungs-Pipelines) als auch **intern als integrierter Regie-Agent / Autopilot** direkt im RELAY-Backend und Dashboard.

Damit können KI-Agenten RELAY sicher beobachten, Streamer entdecken, die Regie-Queue kuratieren, Overlays/Szenen wechseln, YouTube-Broadcasts steuern und bei Störungen autonom eingreifen.

---

## Architektur & Umfang

### 1. Externer & eingebetteter MCP-Server (`src/core/mcp/`)

RELAY stellt seine Fähigkeiten standardkonform über das **Model Context Protocol (MCP)** bereit – wahlweise über:
- **HTTP Streamable / SSE Transport** direkt am Fastify-Server (`/api/mcp`, authentifiziert über `API_TOKEN` oder dedizierte Scoped Agent-Tokens).
- **Stdio-CLI-Wrapper** (`npm run mcp` bzw. `dist/mcp-cli.js`), der lokal oder per SSH an eine RELAY-Instanz angebunden werden kann.

#### MCP Resources (Read-Only Kontext für Agenten)
- `relay://status` – Vollständiger Live-Status (`state`, aktiver Streamer, Bitrate, FPS, DelayBuffer, Sink-Health, Watchdog).
- `relay://streamers` & `relay://playlists` – Konfigurierte Streamer, Online-Status, Prioritäten und Playlists.
- `relay://queue` – Aktuelle Regie-Queue inkl. Laufzeit und Position.
- `relay://discovery/trending` – Aktuell live entdeckte TikTok-Streamer nach Region.
- `relay://earnings` – Aktuelle Einnahmen- und Gifter-Statistiken.
- `relay://logs/recent` & `relay://diagnostics` – Letzte Fehler/Warnungen, Hardware-Auslastung und Systemempfehlungen.

#### MCP Tools (Aktionen mit Zod-Schema & Audit-Logging)
- **Stream- & Regie-Steuerung:**
  - `relay_start_streamer`, `relay_switch_streamer`, `relay_stop_stream`
  - `relay_show_screen` (`startup` / `pause`), `relay_hide_screen`
  - `relay_restart_sink`, `relay_refresh_source`
- **Regie-Queue & Playlists:**
  - `relay_queue_list`, `relay_queue_add`, `relay_queue_play_now`, `relay_queue_next`, `relay_queue_remove`, `relay_queue_seek`
  - `relay_playlist_play`, `relay_playlist_next`, `relay_playlist_previous`
- **Discovery & Kuration:**
  - `relay_discovery_trending`, `relay_discovery_search`, `relay_discovery_room_info`
  - `relay_discovery_add_streamer`, `relay_discovery_switch_live`
- **Overlays, Szenen & Chat:**
  - `relay_activate_scene`, `relay_list_scenes`, `relay_set_overlay_text`, `relay_send_chat_message`
  - `relay_capture_preview` (liefert aktuelles Overlay-/Stream-Vorschaubild als Base64-Image-Content für multimodale Agenten)
- **YouTube & Aufnahmen:**
  - `relay_youtube_list_broadcasts`, `relay_youtube_create_broadcast`, `relay_youtube_transition_broadcast`
  - `relay_recording_add_marker`, `relay_recording_create_clip`

#### MCP Prompts (Vordefinierte Workflows)
- `regie-briefing`: Kompakte Zusammenfassung der aktuellen Sendung, Queue, Zuschauerzahlen und eventueller Störungen.
- `discover-and-queue`: Sucht nach Live-Streamern zu einem Thema/Land und schlägt eine kuratierte Regie-Queue vor.
- `incident-triage`: Analysiert Watchdog-/Sink-/DTS-Fehler aus den Logs und empfiehlt Gegenmaßnahmen.

---

### 2. Interne Agenten-Steuerung (`src/core/agent/`)

Ein optional zuschaltbarer **interner Regie-Agent** in RELAY, der dieselbe Tool-Schicht (`AgentToolRegistry`) wie der MCP-Server nutzt:
- **Chat- / Command-Konsole im Dashboard & Telegram (`/agent`):**
  - Natürlichsprachliche Regie-Befehle im Cockpit (z. B. *„Such mir die 3 größten deutschen Gaming-Streams und pack sie in die Queue"* oder *„Blende im Ticker für 10 Minuten den Hinweis auf das Finale ein"*).
- **Regel- & LLM-gestützter Regie-Autopilot (optional):**
  - Konfigurierbarer Provider (OpenAI-kompatibel / Gemini / Anthropic / lokales Ollama) oder deterministischer Policy-Modus.
  - Automatische Programmplanung (z. B. wenn Queue leer läuft, passende Live-Streamer aus Discovery nachladen).
  - Intelligente Störungsbehandlung und Highlight-Marker bei Chat-/Gift-Spikes.

---

### 3. Sicherheit, Berechtigungen & Nachvollziehbarkeit (Guardrails)

- **Rollen / Scopes für Agenten (`read_only`, `regie`, `admin`):**
  - Destruktive Aktionen (`stop_stream`, `youtube_transition: complete`, `delete_streamer`, `global_youtube_key`-Änderung) können per Policy für Agenten gesperrt oder als bestätigungspflichtig (`require_confirmation`) markiert werden.
- **Audit-Log-Integration:**
  - Jeder Tool-Aufruf (intern wie extern per MCP) wird im `AuditLogStore` mit `source: 'mcp' | 'agent'`, Tool-Name, Parametern und Ergebnis protokolliert.
- **Rate-Limiting & Secret-Isolation:**
  - Kein MCP-Tool oder Resource gibt jemals Stream-Keys, OAuth-Tokens oder API-Secrets im Klartext heraus.

---

## Akzeptanzkriterien

- [ ] Gemeinsame, streng mit Zod typisierte `AgentToolRegistry` für interne Agenten und externen MCP-Zugriff.
- [ ] MCP-Endpunkt (`/api/mcp` inkl. Auth & Scope-Prüfung) sowie CLI-Stdio-Modus für externe MCP-Clients (Claude, Cursor, Antigravity etc.).
- [ ] Interne Agenten-Steuerung im Dashboard (Konfiguration, Berechtigungs-Scopes, Live-Aktionsprotokoll und Regie-Prompt/Autopilot).
- [ ] Alle Agenten-Aktionen erscheinen revisionssicher im Audit-Log (`source: 'mcp'` / `'agent'`).
- [ ] Vollständige Unit- und Integrationstests für MCP-Tools, Berechtigungs-Guards und Secret-Redaction (`npm run check` grün).
