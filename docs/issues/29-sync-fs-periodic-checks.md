## Ziel

Kleinere, belegte Performance-Baustellen in einem Rutsch entschärfen: blockierende Sync-FS-Zugriffe aus API-Pfaden entfernen, periodische Syscalls drosseln und unnötige Neuberechnungen in Hot-Paths vermeiden.

## Hintergrund

- **Sync-FS in API-Pfaden:**
  - `/api/recordings` ruft bei jedem Request `listRecordings()` mit `readdirSync` + `statSync` pro Datei auf (`src/core/recording/recording-controller.ts:58`).
  - Der Audit-Log schreibt jede Zeile per `appendFileSync` (`src/core/audit-log.ts:94`), `broadcast-store.ts` schreibt per `writeFileSync`.
  - Bei vielen Aufnahmen oder trägen Datenträgern blockiert das den Event-Loop; #48 fordert für die Remux-Jobs bereits asynchrone Ausführung — hier fehlt die Basis.
- **Periodische Syscalls:**
  - Der Status-Timer liest alle 2 s `recording.status().disk_warning` (`src/core/supervisor/supervisor.ts:457`). Falls `status()` je Aufruf `statfsSync` über `filesystemUsage()` ausführt, läuft ein Filesystem-Syscall im Sekundentakt, wo ein 15–30-s-Intervall reicht. (Zu verifizieren.)
- **Unnötige Neuberechnung:**
  - `OverlayRuntime.getPreviewEngine()` stringifiziert bei jedem Preview-Aufruf die kompletten Overlay-Settings zur Signaturerzeugung (`src/core/supervisor/overlay-runtime.ts`) — alle 5 s pro offenes Dashboard.
- **Preview-Puffer:**
  - `/api/preview.ts` puffert pro verbundenem Dashboard bis 8 MB (`MAX_BUFFERED_BYTES`). Pro Client korrekt begrenzt, summiert sich aber über mehrere offene Dashboards bei langsam lesenden Clients.
- **Unkoordinierte Timer:**
  - Delay-Tick (10 ms), Chat-Engine (~10,5 Hz), Logo-Engine, Chat-Pump (1 s), Status (2 s) laufen ungestaffelt; Wakeups bündeln sich zufällig. Reale Auswirkung gering — als Nebeneffekt von #53/#55 addressierbar.

## Umfang

- **Async-FS:**
  - `listRecordings()` und Call Sites auf `fs/promises` umstellen (`src/api/routes/recordings.ts`, `src/core/recording/recording-controller.ts`).
  - Audit-Log-Schreiben asynchron bzw. gepuffert/serialisiert umstellen (Reihenfolge der Einträge erhalten!); SQLite-artiges Batching nicht nötig, `appendFile`-Queue reicht.
  - `broadcast-store.ts`/andere Sync-Writer in Request-Pfaden prüfen und asynchronisieren, wo keine Invarianten dagegen sprechen (atomarer Rename-Ablauf muss erhalten bleiben).
  - `QueueController.setPlayback()` persistiert während Medienwiedergabe alle 10 s per Sync-Write (`src/core/supervisor/queue-controller.ts:301`, aufgerufen über den Status-Timer in `supervisor.ts:460`): asynchronisieren oder Dirty-Writes dedupen.
  - `OverlayManager.updateChat()` schreibt bei jeder Chat-Änderung per `writeFileAtomic` (Sync-Write + Rename, `src/core/overlays/overlay-manager.ts`). Im Canvas-Engine-Modus ist die Datei (`chat.txt`) gar nicht gebunden und der Write reine Verschwendung; der Guard prüft nur `config.enabled`, nicht `config.engine`. Write auf Drawtext-Engine beschränken bzw. asynchronisieren.
- **Drosselung:**
  - Filesystem-Check (`statfs`) auf max. 15–30 s cachen; Auslösen der `disk_warning`-Webhooks bleibt unmittelbar nach Check.
- **Signatur:**
  - Preview-Engine-Signatur über einen Versions-/Zählerstand (Settings-Versionszähler bei Update) statt `JSON.stringify` führen.
- **Timer-Staffelung (optional):**
  - Nach #53/#55: Start-Offset/Jitter, damit periodische Worker nicht im selben Tick aufwachen.
- **Preview-Puffer (optional):**
  - Nach pierwszy Verbindungsdruck prüfen, ob ein niedrigeres Per-Client-Limit (z. B. 2 MB) plus Disconnect-Cutoff genügt.

## Akzeptanzkriterien

- [ ] Kein `readFileSync`/`readdirSync`/`statSync`/`writeFileSync` mehr im Request-Pfad der Recordings-API; Audit-Log schreibt asynchron ohne Reihenfolgeverlust.
- [ ] Filesystem-Check läuft höchstens alle 15 s; `disk_warning`-Webhooks verhalten sich nachweislich unverändert.
- [ ] Preview-Engine-Signatur kommt ohne `JSON.stringify` der Settings aus; Verhalten (Rebuild nur bei Änderung) bleibt identisch.
- [ ] Bestehende Unit-/Integration-Tests bleiben grün; `npm run check` grün.
- [ ] Kein Timeout-/Reihenfolgewechsel im Audit-Log (nachweisbar per Test).
