## Ziel

Konfigurations- und Daten-Backups direkt über die System-/Diagnose-Oberfläche erstellen, als Archiv herunterladen und validiert wiederherstellen – analog zu `scripts/backup.sh` und `scripts/restore.sh`.

## Hintergrund

- Für native systemd-Deployments existieren bereits `scripts/backup.sh` und `scripts/restore.sh`, die `config/` und `data/` (ohne `sessions.json` und Laufzeit-Artefakte) sichern.
- Ohne SSH-Zugriff gibt es im Dashboard bisher keine Möglichkeit, vor größeren Änderungen ein Backup zu ziehen oder eine Konfiguration auf eine neue Instanz zu übertragen.

## Umfang

- **Backup-API:**
  - `POST /api/system/backup` erzeugt ein `.tar.gz`-Archiv im Memory/Temp-Stream (strikt ohne `data/sessions.json`, optional mit/ohne Secrets wie `youtube-auth.json`, über `AuditLog` protokolliert).
  - `POST /api/system/restore` (nur mit expliziter Bestätigung / TOTP falls aktiv) prüft Archiv-Inhalt (Whitelist erlaubter Pfade, kein Path Traversal / Symlinks), legt vorher automatisch ein lokales Rollback-Backup an und lädt Konfiguration neu.
- **UI:**
  - Bereich „Backup & Wiederherstellung" in `DiagnosticsView.vue` oder `SettingsView.vue` mit Download-Button und Upload-Dialog.

## Akzeptanzkriterien

- [ ] Backup enthält niemals `data/sessions.json` oder temporäre Overlay-/Logdateien.
- [ ] Restore lehnt manipulierte Archive (Symlinks, `..`, unbekannte Pfade) mit `400` ab.
- [ ] Alle Backup-/Restore-Aktionen erscheinen im Audit-Log.
- [ ] Tests für Archiv-Filterung und Pfad-Validierung; `npm run check` grün.
