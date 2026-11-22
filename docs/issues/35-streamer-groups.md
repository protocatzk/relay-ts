## Ziel

Streamer sollen in frei definierbare **Gruppen** (z. B. *Gaming*, *Talk*, *Musik*, *Favoriten*, *Standard*) organisiert werden können. Über Gruppen können Streamer übersichtlich gefiltert, sortiert und zusammengefasst werden.

Zudem sollen Streamer, die über die **Discovery-Funktion** (`LivePageProvider`, `SearchProvider`, Zapper) entdeckt und ins System übernommen werden (`source: 'discovery'`), standardmäßig automatisch einer dedizierten Gruppe (z. B. `Discovery` oder konfigurierbar) zugeordnet werden, damit neu hinzugefügte Kanäle nicht mit den manuell gepflegten Stammkanälen vermischt werden.

---

## Anforderungen

### 1. Datenmodell & Schema
- Erweiterung des `StreamerFieldsSchema` / `StreamerSchema` in `src/core/config/schema.ts`:
  - `group: z.string().trim().max(64).default('')` (oder `'Allgemein'` / optional leer für ungeordnet).
  - Volle Abwärtskompatibilität für bestehende `streamers.yml`-Einträge ohne `group`.
- Anpassung der API-Schemas (`StreamerUpdateSchema`) und Typdefinitionen im Frontend (`Streamer` Interface in `src/web/src/types/index.ts`).

### 2. Automatische Discovery-Gruppe
- Wenn Streamer über `DiscoveryService.addStreamer()` (oder implizit via `queueNow` / `switchToStreamer`) neu angelegt werden, wird automatisch:
  - `group: 'Discovery'` (oder der Wert aus den Settings) gesetzt.
- Optional: Konfigurierbarer Standardgruppenname in den Discovery- oder App-Einstellungen (`discovery.default_group`).

### 3. UI & Dashboard
- **StreamersView (`StreamersView.vue`):**
  - Gruppen-Filterleiste (Chips / Tabs / Dropdown) oben in der Streamer-Liste: *Alle*, *Standard*, *Discovery*, sowie alle dynamisch vorhandenen Gruppen.
  - Option zur Gruppierung der Tabelle/Karten nach Gruppe (akkordeonartig ein-/ausklappbar mit Badge für Streamer-Anzahl).
  - Batch-Aktionen: Ausgewählte Streamer einer Gruppe zuweisen oder Gruppe umbenennen.
- **StreamerEditor (`StreamerEditor.vue`):**
  - Eingabefeld für Gruppe mit Autocomplete/Vorschlägen aller bereits existierenden Gruppennamen.
- **Live-Menü / Schnellwahl (`LiveMenu.vue` & Telegram `/streamer`):**
  - Möglichkeit, nach Gruppen zu filtern oder gruppiert darzustellen, um bei vielen Streamern die Übersicht zu behalten.

### 4. Optional: Playlist- & Regie-Integration
- Option, eine Gruppe als dynamische Quelle in Playlists oder Zeitplänen zu verwenden (z. B. "alle aktiven Streamer der Gruppe *Gaming* rotieren").

---

## Akzeptanzkriterien

1. Streamer können im Editor einer Gruppe zugewiesen werden.
2. In `StreamersView` können Streamer nach Gruppe gefiltert werden; Autocomplete schlägt bestehende Gruppen vor.
3. Über Discovery angelegte Streamer (`POST /api/discovery/streamers`) landen automatisch in der Gruppe `Discovery`.
4. Existierende Konfigurationen (`streamers.yml`) laden fehlerfrei ohne manuelle Migration.
5. Unit- und Integrationstests decken die Schema-Validierung und die Discovery-Gruppenzuweisung ab.
